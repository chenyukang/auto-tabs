const SETTINGS_KEY = "settings";
const TAB_RECORDS_KEY = "tabRecords";

const DEFAULT_SETTINGS = {
  enabled: false,
  maxTabs: 12,
  protectPinned: true,
  excludeDomains: []
};

let queue = Promise.resolve();

function enqueue(task) {
  const run = queue.then(task, task);

  queue = run.catch((error) => {
    console.error("[Auto Tabs]", error);
  });

  return run;
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function normalizeDomainPattern(value) {
  if (value == null) {
    return "";
  }

  let normalized = String(value).trim().toLowerCase();

  if (!normalized) {
    return "";
  }

  if (normalized.includes("://")) {
    try {
      normalized = new URL(normalized).hostname.toLowerCase();
    } catch {
      return "";
    }
  } else {
    normalized = normalized.split(/[/?#:]/, 1)[0];
  }

  if (normalized.startsWith("*.")) {
    const suffix = normalized.slice(2).replace(/^\.+|\.+$/g, "");

    if (!suffix || suffix.includes("*")) {
      return "";
    }

    return `*.${suffix}`;
  }

  normalized = normalized.replace(/^\.+|\.+$/g, "");

  if (!normalized || normalized.includes("*")) {
    return "";
  }

  return normalized;
}

function sanitizeExcludeDomains(value) {
  const rawItems = Array.isArray(value)
    ? value
    : String(value || "").split(/[\s,;]+/);
  const uniquePatterns = new Set();

  rawItems.forEach((item) => {
    const pattern = normalizeDomainPattern(item);

    if (pattern) {
      uniquePatterns.add(pattern);
    }
  });

  return [...uniquePatterns];
}

function getHostnameFromTab(tab) {
  const tabUrl = tab?.pendingUrl || tab?.url;

  if (!tabUrl) {
    return "";
  }

  try {
    return new URL(tabUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function matchesDomainPattern(hostname, pattern) {
  if (!hostname || !pattern) {
    return false;
  }

  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(2);
    return hostname.endsWith(`.${suffix}`);
  }

  return hostname === pattern;
}

function isExcludedTab(tab, settings) {
  const hostname = getHostnameFromTab(tab);

  return settings.excludeDomains.some((pattern) =>
    matchesDomainPattern(hostname, pattern)
  );
}

function sanitizeSettings(settings = {}) {
  const maxTabs = Number.parseInt(settings.maxTabs, 10);

  return {
    enabled:
      typeof settings.enabled === "boolean"
        ? settings.enabled
        : DEFAULT_SETTINGS.enabled,
    maxTabs: Number.isFinite(maxTabs)
      ? Math.min(Math.max(maxTabs, 1), 1000)
      : DEFAULT_SETTINGS.maxTabs,
    protectPinned:
      typeof settings.protectPinned === "boolean"
        ? settings.protectPinned
        : DEFAULT_SETTINGS.protectPinned,
    excludeDomains: sanitizeExcludeDomains(settings.excludeDomains)
  };
}

async function getSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return sanitizeSettings(stored[SETTINGS_KEY]);
}

async function saveSettings(settings) {
  const sanitized = sanitizeSettings(settings);
  await chrome.storage.local.set({ [SETTINGS_KEY]: sanitized });
  return sanitized;
}

async function ensureSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);

  if (!stored[SETTINGS_KEY]) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
    return DEFAULT_SETTINGS;
  }

  const sanitized = sanitizeSettings(stored[SETTINGS_KEY]);
  await chrome.storage.local.set({ [SETTINGS_KEY]: sanitized });
  return sanitized;
}

async function getTabRecords() {
  const stored = await chrome.storage.local.get(TAB_RECORDS_KEY);
  const records = stored[TAB_RECORDS_KEY];
  return records && typeof records === "object" ? records : {};
}

async function saveTabRecords(records) {
  await chrome.storage.local.set({ [TAB_RECORDS_KEY]: records });
}

function isManagedTab(tab, settings) {
  if (!tab || typeof tab.id !== "number") {
    return false;
  }

  if (settings.protectPinned && tab.pinned) {
    return false;
  }

  if (isExcludedTab(tab, settings)) {
    return false;
  }

  return true;
}

async function syncKnownTabs() {
  const tabs = await chrome.tabs.query({});
  const records = await getTabRecords();
  const liveTabIds = new Set(tabs.map((tab) => String(tab.id)));
  let changed = false;

  for (const tabId of Object.keys(records)) {
    if (!liveTabIds.has(tabId)) {
      delete records[tabId];
      changed = true;
    }
  }

  const tabsByLikelyAge = [...tabs].sort((a, b) => a.id - b.id);
  const now = Date.now();

  tabsByLikelyAge.forEach((tab, index) => {
    const tabId = String(tab.id);

    if (!records[tabId]) {
      records[tabId] = {
        createdAt: now - (tabsByLikelyAge.length - index) * 1000
      };
      changed = true;
    }
  });

  if (changed) {
    await saveTabRecords(records);
  }

  return { tabs, records };
}

async function recordCreatedTab(tab) {
  if (!tab || typeof tab.id !== "number") {
    return;
  }

  const records = await getTabRecords();

  records[String(tab.id)] = {
    createdAt: Date.now()
  };

  await saveTabRecords(records);
}

async function forgetTab(tabId) {
  const records = await getTabRecords();
  const key = String(tabId);

  if (records[key]) {
    delete records[key];
    await saveTabRecords(records);
  }
}

async function replaceTabRecord(addedTabId, removedTabId) {
  const records = await getTabRecords();
  const removedKey = String(removedTabId);
  const addedKey = String(addedTabId);

  records[addedKey] = records[removedKey] || { createdAt: Date.now() };
  delete records[removedKey];

  await saveTabRecords(records);
}

async function enforceLimit(options = {}) {
  const settings = await getSettings();

  if (!settings.enabled) {
    return { closed: 0 };
  }

  const { tabs, records } = await syncKnownTabs();
  const managedTabs = tabs.filter((tab) => isManagedTab(tab, settings));
  const overflow = managedTabs.length - settings.maxTabs;

  if (overflow <= 0) {
    return { closed: 0 };
  }

  const keepTabId = options.keepTabId == null ? null : String(options.keepTabId);
  const candidates = managedTabs
    .filter((tab) => String(tab.id) !== keepTabId)
    .map((tab) => ({
      tab,
      createdAt: records[String(tab.id)]?.createdAt || 0
    }))
    .sort((a, b) => a.createdAt - b.createdAt || a.tab.id - b.tab.id);

  const tabsToClose = candidates.slice(0, overflow).map(({ tab }) => tab.id);
  const closedTabIds = [];

  for (const tabId of tabsToClose) {
    try {
      await chrome.tabs.remove(tabId);
      closedTabIds.push(tabId);
    } catch (error) {
      console.warn(`[Auto Tabs] Failed to close tab ${tabId}`, error);
    }
  }

  if (closedTabIds.length > 0) {
    const latestRecords = await getTabRecords();

    closedTabIds.forEach((tabId) => {
      delete latestRecords[String(tabId)];
    });

    await saveTabRecords(latestRecords);
  }

  return { closed: closedTabIds.length };
}

async function getState() {
  const settings = await getSettings();
  const { tabs } = await syncKnownTabs();
  const managedCount = tabs.filter((tab) => isManagedTab(tab, settings)).length;
  const excludedCount = tabs.filter((tab) => isExcludedTab(tab, settings)).length;

  return {
    settings,
    managedCount,
    excludedCount,
    totalCount: tabs.length
  };
}

async function handleCreatedTab(tab) {
  await recordCreatedTab(tab);

  const settings = await getSettings();

  if (!settings.enabled) {
    return;
  }

  if (settings.excludeDomains.length === 0) {
    await enforceLimit({ keepTabId: tab.id });
    return;
  }

  if (getHostnameFromTab(tab)) {
    await enforceLimit({ keepTabId: tab.id });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  enqueue(async () => {
    await ensureSettings();
    await syncKnownTabs();
    await enforceLimit();
  });
});

chrome.runtime.onStartup.addListener(() => {
  enqueue(async () => {
    await ensureSettings();
    await syncKnownTabs();
    await enforceLimit();
  });
});

chrome.tabs.onCreated.addListener((tab) => {
  enqueue(() => handleCreatedTab(tab));
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== "loading") {
    return;
  }

  enqueue(async () => {
    const settings = await getSettings();

    if (!settings.enabled) {
      return;
    }

    if (!getHostnameFromTab(tab)) {
      return;
    }

    await enforceLimit({ keepTabId: tabId });
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  enqueue(() => forgetTab(tabId));
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  enqueue(() => replaceTabRecord(addedTabId, removedTabId));
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[SETTINGS_KEY]) {
    enqueue(() => enforceLimit());
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "get-state") {
    enqueue(getState)
      .then((state) => sendResponse({ ok: true, state }))
      .catch((error) => sendResponse({ ok: false, error: getErrorMessage(error) }));
    return true;
  }

  if (message?.type === "save-settings") {
    enqueue(async () => {
      await saveSettings(message.settings);
      await enforceLimit();
      return getState();
    })
      .then((state) => sendResponse({ ok: true, state }))
      .catch((error) => sendResponse({ ok: false, error: getErrorMessage(error) }));
    return true;
  }

  return false;
});

enqueue(async () => {
  await ensureSettings();
  await syncKnownTabs();
});
