// offscreen.js
let offscreenChunks = [];
let trackedBytes = 0;
const chunkSignatures = new Set();
let directSubmitLock = false;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "OFFSCREEN_RESET") {
    offscreenChunks = [];
    trackedBytes = 0;
    chunkSignatures.clear();
    directSubmitLock = false;
    console.log("[YT-Audio-Offscreen] Buffers flushed.");
    return false;
  }

  if (request.type === "TRICKLE_TO_OFFSCREEN") {
    const rawData = request.chunk;
    const len = rawData.length;
    const meta = request.metadata || { size: len, playheadTime: 0 };

    if (len === 0) return false;

    // Header Integrity Lock (Keep only the first 266-byte block)
    if (offscreenChunks.length > 0 && len < 300) {
      console.log(
        `[YT-Audio-Offscreen] 🛡️ Filtered redundant header re-fetch (${len} bytes).`,
      );
      return false;
    }

    let byteSum = 0;
    let step = Math.max(1, Math.floor(len / 10));
    for (let i = 0; i < len; i += step) {
      byteSum += rawData[i];
    }

    const uniqueSignature = `${len}_${byteSum}_${rawData[0]}_${rawData[len - 1]}`;

    if (chunkSignatures.has(uniqueSignature)) return false;

    chunkSignatures.add(uniqueSignature);
    const u8 = new Uint8Array(rawData);
    offscreenChunks.push(u8);
    trackedBytes += u8.byteLength;

    console.log(
      `[YT-Audio-Offscreen] 📥 Part #${offscreenChunks.length} | Size: ${(meta.size / 1024).toFixed(1)} KB | Playhead: ${meta.playheadTime.toFixed(1)}s | Total: ${(trackedBytes / 1024 / 1024).toFixed(2)} MB`,
    );
    return false;
  }

  if (request.type === "TRIGGER_OFFSCREEN_SUBMIT") {
    if (directSubmitLock) {
      console.log("[YT-Audio-Offscreen] 🛡️ Duplicate call blocked.");
      return false;
    }
    directSubmitLock = true;

    handleDirectCloudUpload(request)
      .then((res) => {
        directSubmitLock = false;
        sendResponse({ success: true, result: res });
      })
      .catch((err) => {
        directSubmitLock = false;
        console.error(
          "[YT-Audio-Offscreen] ❌ CRITICAL CLOUD UPLOAD FAILURE:",
          err,
        );
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }
});

async function handleDirectCloudUpload(request) {
  if (offscreenChunks.length === 0) throw new Error("No data captured.");

  const blob = new Blob(offscreenChunks, { type: request.mimeType });
  console.log(
    `[YT-Audio-Offscreen] Finalizing Assembly -> Total Chunks: ${offscreenChunks.length}, Absolute Weight: ${(blob.size / 1024 / 1024).toFixed(2)} MB`,
  );

  const { supabaseUrl, publishableKey, secretKey, bucketName } = request.config;
  const filename = `${request.title.replace(/[\\/:*?"<>|]/g, "_")}_${Date.now()}.${request.extension}`;
  const uploadUrl = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/${bucketName}/${filename}`;

  console.log(
    `[YT-Audio-Offscreen] Firing storage fetch call payload to: ${uploadUrl}`,
  );

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      Authorization: `Bearer ${secretKey.trim()}`,
      "Content-Type": request.mimeType,
    },
    body: blob,
  });

  if (!response.ok) {
    const errData = await uploadRes.json();
    throw new Error(errData.message || `Supabase error: ${response.status}`);
  }

  console.log(
    "[YT-Audio-Offscreen] Cloud transaction complete! File synchronized perfectly.",
  );

  offscreenChunks = [];
  chunkSignatures.clear();
  return { filename, size: blob.size }; // Fixed: correct variable scoping layout reference
}
