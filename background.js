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
  // 🔄 Handle return journey message deliveries
  if (request.type === "FROM_OFFSCREEN_UPLOAD_COMPLETE") {
    console.log(
      `[ROUTER-TRACE] 🔄 Background caught complete notice from offscreen. Targeting Tab ID: ${request.tabId}`,
    );

    if (request.tabId) {
      chrome.tabs.sendMessage(
        request.tabId,
        {
          type: "UPLOAD_PIPELINE_COMPLETE",
          success: request.success,
          result: request.result,
          error: request.error,
        },
        () => {
          if (chrome.runtime.lastError) {
            console.error(
              `[ROUTER-TRACE] ❌ Dispatch failed to Tab ${request.tabId}:`,
              chrome.runtime.lastError.message,
            );
          } else {
            console.log(
              `[ROUTER-TRACE] ✅ Dispatch successful to Tab ${request.tabId}`,
            );
          }
        },
      );
    }
    return false;
  }

  // Guard Rail: Only intercept primary message pushes originating from content tabs
  if (!sender.tab) return false;

  const currentSourceTabId = sender.tab.id;

  if (request.type === "PREPARE_AND_RESET_OFFSCREEN") {
    setupOffscreen().then(() => {
      chrome.runtime.sendMessage({ type: "OFFSCREEN_RESET" });
      sendResponse({ success: true });
    });
    return true;
  }

  if (
    request.type === "TRICKLE_TO_OFFSCREEN" ||
    request.type === "TRIGGER_OFFSCREEN_SUBMIT"
  ) {
    setupOffscreen().then(() => {
      request.tabId = currentSourceTabId;
      request.fromBackground = true; // 🔥 Set authentication flag
      chrome.runtime.sendMessage(request);
    });
    return false;
  }
});
