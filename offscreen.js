// offscreen.js
let offscreenChunks = [];
let trackedBytes = 0;
const chunkSignatures = new Set();
let directSubmitLock = false;
let supabaseClient = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 🛡️ FILTER GATES: Ignore direct cross-talk broadcasts from content.js
  if (request.type !== "OFFSCREEN_RESET" && !request.fromBackground)
    return false;

  if (request.type === "OFFSCREEN_RESET") {
    offscreenChunks = [];
    trackedBytes = 0;
    chunkSignatures.clear();
    directSubmitLock = false;
    console.log("[YT-Audio-Offscreen] 🧼 Memory tables flushed completely.");
    return false;
  }

  if (request.type === "TRICKLE_TO_OFFSCREEN") {
    const rawData = request.chunk;
    const len = rawData.length;
    if (len === 0) return false;
    if (offscreenChunks.length > 0 && len < 300) return false;

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
      `[YT-Audio-Offscreen] 📥 Captured Part #${offscreenChunks.length} | Size: ${(len / 1024).toFixed(1)} KB`,
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
        artist: request.artist || "Unknown Publisher",
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

  offscreenChunks = [];
  chunkSignatures.clear();
  return { fileName, size: blob.size, dbData };
}
