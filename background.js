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
  // 🛡️ THE GUARD RAIL: If the message originates internally (no tab), ignore it to break recursive loops
  if (!sender.tab) return false;

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
      // Safely target the message down to the offscreen worker document window context
      chrome.runtime.sendMessage(request, (response) => {
        sendResponse(response);
      });
    });
    return true;
  }
});
