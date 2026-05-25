// background.js
let creatingDocPromise = null;

async function setupOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;

  if (creatingDocPromise) {
    await creatingDocPromise;
    return;
  }

  creatingDocPromise = chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["BLOBS"],
    justification: "Handling audio stream blobs for cloud storage upload.",
  });

  try {
    await creatingDocPromise;
  } catch (error) {
    if (!error.message.includes("Only a single offscreen document")) {
      console.error(
        "[YT-Audio-Background] Offscreen window environment mount crash:",
        error,
      );
    }
  } finally {
    creatingDocPromise = null;
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 🔥 CRITICAL FIX: Synchronously capture target tab ID right at the entry threshold
  const currentSourceTabId = sender.tab ? sender.tab.id : null;

  if (request.type === "FROM_OFFSCREEN_UPLOAD_COMPLETE") {
    if (request.tabId) {
      chrome.tabs.sendMessage(request.tabId, {
        type: "UPLOAD_PIPELINE_COMPLETE",
        success: request.success,
        result: request.result,
        error: request.error,
      });
    }
    return false;
  }

  // Handle messages coming down from content scripts safely
  if (currentSourceTabId) {
    if (request.type === "PREPARE_AND_RESET_OFFSCREEN") {
      setupOffscreen().then(() => {
        chrome.runtime.sendMessage({ type: "OFFSCREEN_RESET" });
        sendResponse({ success: true });
      });
      return true;
    }

    if (request.type === "TRICKLE_TO_OFFSCREEN") {
      setupOffscreen().then(() => {
        chrome.runtime.sendMessage(request);
      });
      return false;
    }

    if (request.type === "TRIGGER_OFFSCREEN_SUBMIT") {
      setupOffscreen().then(() => {
        // Apply the synchronously preserved historical reference parameters
        request.tabId = currentSourceTabId;
        chrome.runtime.sendMessage(request);
      });
      return false;
    }
  }
});
