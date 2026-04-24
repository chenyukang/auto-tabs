const enabledInput = document.querySelector("#enabled");
const maxTabsInput = document.querySelector("#maxTabs");
const protectPinnedInput = document.querySelector("#protectPinned");
const excludeDomainsInput = document.querySelector("#excludeDomains");
const saveButton = document.querySelector("#save");
const statusElement = document.querySelector("#status");

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function applyState(state) {
  enabledInput.checked = state.settings.enabled;
  maxTabsInput.value = state.settings.maxTabs;
  protectPinnedInput.checked = state.settings.protectPinned;
  excludeDomainsInput.value = state.settings.excludeDomains.join("\n");
  updateStatus(state);
}

function updateStatus(state) {
  const managedText = state.settings.protectPinned
    ? "Managed tabs"
    : "Tabs";
  const prefix = state.settings.enabled ? "" : "Paused. ";
  const excludeText = state.settings.excludeDomains.length
    ? ` Excluded tabs: ${state.excludedCount}.`
    : "";

  statusElement.textContent = `${prefix}${managedText}: ${state.managedCount} / ${state.settings.maxTabs}. Total tabs: ${state.totalCount}.${excludeText}`;
}

function readSettings() {
  return {
    enabled: enabledInput.checked,
    maxTabs: maxTabsInput.value,
    protectPinned: protectPinnedInput.checked,
    excludeDomains: excludeDomainsInput.value
  };
}

async function loadState() {
  const response = await sendMessage({ type: "get-state" });

  if (!response?.ok) {
    throw new Error(response?.error || "Failed to load settings");
  }

  applyState(response.state);
}

async function saveState() {
  saveButton.disabled = true;
  statusElement.textContent = "Saving...";

  try {
    const response = await sendMessage({
      type: "save-settings",
      settings: readSettings()
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Failed to save settings");
    }

    applyState(response.state);
    statusElement.textContent = `Saved. ${statusElement.textContent}`;
  } catch (error) {
    statusElement.textContent = error.message;
  } finally {
    saveButton.disabled = false;
  }
}

saveButton.addEventListener("click", saveState);

document.addEventListener("DOMContentLoaded", () => {
  loadState().catch((error) => {
    statusElement.textContent = error.message;
  });
});
