// background.js
console.log("[YT-Audio] Background Worker Active (Lifecycle Mode)");

let creating;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "PREPARE_AND_RESET_OFFSCREEN") {
    setupOffscreenDocument().then(async () => {
      // Give the offscreen canvas context 150ms to mount cleanly
      await new Promise((resolve) => setTimeout(resolve, 150));
      chrome.runtime.sendMessage({ type: "OFFSCREEN_RESET" });
      sendResponse({ success: true });
    });
    return true; // Lock asynchronous port
  }
  // Removed duplicate mirror intercepts for TRICKLE and SUBMIT tasks
});

async function setupOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL("offscreen.html");
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl],
  });
  if (existingContexts.length > 0) return;
  if (creating) {
    await creating;
  } else {
    creating = chrome.offscreen.createDocument({
      url: offscreenUrl,
      reasons: ["BLOBS"],
      justification: "Maintain unbroken media reassembly lines safely.",
    });
    await creating;
    creating = null;
  }
}
