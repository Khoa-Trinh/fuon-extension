// offscreen.js
let offscreenChunks = [];
let trackedBytes = 0; // Ensures strict number
const chunkSignatures = new Set();
let directSubmitLock = false;
let supabaseClient = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type !== "OFFSCREEN_RESET" && !request.fromBackground)
    return false;

  if (request.type === "OFFSCREEN_RESET") {
    offscreenChunks = [];
    trackedBytes = 0; // Hard reset to 0
    chunkSignatures.clear();
    directSubmitLock = false;
    console.log("[YT-Audio-Offscreen] 🧼 Memory tables explicitly cleared.");
    sendResponse({ success: true });
    return true;
  }

  if (request.type === "TRICKLE_TO_OFFSCREEN") {
    const rawData = request.chunk;
    if (!rawData || rawData.length === 0) return false;

    // 1. Signature generation with safety checks
    const len = rawData.length;
    const startByte = rawData[0] ?? 0;
    const endByte = rawData[len - 1] ?? 0;
    const sig = `${len}_${startByte}_${endByte}`;

    if (chunkSignatures.has(sig)) {
      console.log(`[YT-Audio-Offscreen] 🛑 Duplicate block dropped: ${sig}`);
      return false;
    }

    // 2. Add to processing queue
    chunkSignatures.add(sig);
    const u8 = new Uint8Array(rawData);
    offscreenChunks.push(u8);
    trackedBytes += u8.byteLength; // Ensure we always add a valid number

    console.log(
      `[YT-Audio-Offscreen] 📥 Part #${offscreenChunks.length} | Size: ${(len / 1024).toFixed(1)} KB | Pool: ${(trackedBytes / 1024 / 1024).toFixed(2)} MB`,
    );
    return false;
  }

  if (request.type === "TRIGGER_OFFSCREEN_SUBMIT") {
    if (directSubmitLock) return false;
    directSubmitLock = true;

    console.log(
      `[ROUTER-TRACE] 📥 Offscreen processing submit request. Identity Tab ID: ${request.tabId}`,
    );

    handleDirectCloudUpload(request)
      .then((res) => {
        directSubmitLock = false;
        console.log(
          `[ROUTER-TRACE] 🌐 Cloud sync done. Relaying confirmation for Tab ID: ${request.tabId}`,
        );
        chrome.runtime.sendMessage({
          type: "FROM_OFFSCREEN_UPLOAD_COMPLETE",
          tabId: request.tabId,
          success: true,
          result: res,
        });
      })
      .catch((err) => {
        directSubmitLock = false;
        console.error("[YT-Audio-Offscreen] ❌ Upload Pipeline Crash:", err);
        chrome.runtime.sendMessage({
          type: "FROM_OFFSCREEN_UPLOAD_COMPLETE",
          tabId: request.tabId,
          success: false,
          error: err.message,
        });
      });
    return false;
  }
});

async function handleDirectCloudUpload(request) {
  if (offscreenChunks.length === 0) throw new Error("No data captured.");

  const blob = new Blob(offscreenChunks, { type: request.mimeType });
  const { supabaseUrl, secretKey, bucketName } = request.config;

  if (!supabaseClient) {
    supabaseClient = supabase.createClient(supabaseUrl, secretKey);
  }

  const cleanString = (str) =>
    str
      .replace(/[^\x00-\x7F]/g, "")
      .replace(/[^a-zA-Z0-9\s-_]/g, "")
      .trim()
      .replace(/\s+/g, "_");
  const cleanTitle = cleanString(request.title);
  const folderPrefix = request.playlistTitle
    ? cleanString(request.playlistTitle)
    : "Single_Videos";

  const fileName = `${cleanTitle}-${Date.now()}.${request.extension}`;
  const filePath = `${folderPrefix}/${fileName}`;

  console.log(
    `[YT-Audio-Offscreen] Finalizing Assembly -> Total Chunks: ${offscreenChunks.length}, Absolute Weight: ${(blob.size / 1024 / 1024).toFixed(2)} MB`,
  );

  const { error: uploadError } = await supabaseClient.storage
    .from(bucketName)
    .upload(filePath, blob, { contentType: request.mimeType, upsert: true });

  if (uploadError) throw uploadError;

  const { data: urlData } = supabaseClient.storage
    .from(bucketName)
    .getPublicUrl(filePath);

  const { data: dbData, error: dbError } = await supabaseClient
    .from("tracks")
    .insert([
      {
        title: request.title,
        artist: request.artist || "Unknown Artist",
        playlist: request.playlistTitle || "None",
        duration_seconds: Math.round(request.duration || 0),
        file_name: fileName,
        stream_url: urlData.publicUrl,
      },
    ]);

  if (dbError) throw dbError;

  console.log(
    "[YT-Audio-Offscreen] Cloud transaction complete! Synchronized perfectly.",
  );

  return { fileName, size: blob.size, dbData };
}
