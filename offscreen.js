// offscreen.js
let offscreenChunks = [];
let trackedBytes = 0;
const chunkSignatures = new Set();
let directSubmitLock = false;
let supabaseClient = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type !== "OFFSCREEN_RESET" && !request.fromBackground)
    return false;

  if (request.type === "OFFSCREEN_RESET") {
    offscreenChunks = [];
    trackedBytes = 0;
    chunkSignatures.clear();
    directSubmitLock = false;
    console.log(
      "[YT-Audio-Offscreen] 🧼 Memory tables cleared by Navigation Reset.",
    );
    sendResponse({ success: true });
    return true;
  }

  if (request.type === "TRICKLE_TO_OFFSCREEN") {
    const rawData = request.chunk;
    const len = rawData.length;
    const meta = request.metadata || {};

    if (len === 0) return false;

    // 🧼 ATOMIC RESET: If the bridge sends the resetSession flag, everything dies here first.
    if (meta.resetSession) {
      offscreenChunks = [];
      trackedBytes = 0;
      chunkSignatures.clear();
      directSubmitLock = false;
      console.log(
        "%c[YT-Audio-Offscreen] 🧼 ATOMIC RESET: Memory cleared by Header Packet.",
        "color: #a855f7; font-weight: bold;",
      );
    }

    // 🛡️ DATA-DRIVEN RESET GATEWAY (Fallback): Intercept 'ftyp' magic bytes
    const isStructuralHeader =
      len > 8 &&
      rawData[4] === 0x66 &&
      rawData[5] === 0x74 &&
      rawData[6] === 0x79 &&
      rawData[7] === 0x70;
    if (isStructuralHeader && !meta.resetSession) {
      offscreenChunks = [];
      trackedBytes = 0;
      chunkSignatures.clear();
      directSubmitLock = false;
      console.log(
        "%c[YT-Audio-Offscreen] 🧼 Magic 'ftyp' container box caught. Flushing old tables.",
        "color: #a855f7; font-weight: bold;",
      );
    }

    // 👑 HEADER PRIORITIZATION: If it's a HEADER, it MUST be index 0
    if (meta.streamType === "HEADER") {
      offscreenChunks.unshift(new Uint8Array(rawData));
      console.log("[YT-Audio-Offscreen] 👑 Header forced to index 0.");
      // We don't return false here so we can still track bytes/signatures for the header
    }

    // Filter structural redundant header duplicates safely
    if (offscreenChunks.length > 1 && len < 300) {
      console.log(
        `[YT-Audio-Offscreen] 🛑 Block discarded: Fragment size is too small (${len} B).`,
      );
      return false;
    }

    // 🧠 RIGOROUS DUPLICATE DETECTION CHECKSUM MATRIX
    let byteSum = 0;
    let step = Math.max(1, Math.floor(len / 20));
    for (let i = 0; i < len; i += step) {
      byteSum += rawData[i];
    }
    const mid = Math.floor(len / 2);
    const uniqueSignature = `${len}_${byteSum}_${rawData[0]}_${rawData[mid]}_${rawData[len - 1]}`;

    if (chunkSignatures.has(uniqueSignature)) {
      console.log(
        `%c[YT-Audio-Offscreen] 🛑 Duplicate block dropped -> Origin: ${meta.streamType || "LIVE"} | Size: ${(len / 1024).toFixed(1)} KB | Playhead: ${meta.playheadTime?.toFixed(2)}s`,
        "color: #ef4444; font-weight: bold;",
      );
      return false;
    }

    chunkSignatures.add(uniqueSignature);

    // If it wasn't unshifted as a header, push it as a regular chunk
    if (meta.streamType !== "HEADER") {
      offscreenChunks.push(new Uint8Array(rawData));
    }

    trackedBytes += len;

    console.log(
      `%c[YT-Audio-Offscreen] 📥 Part #${offscreenChunks.length} Stored Safely | Origin: ${meta.streamType || "LIVE"} | Size: ${(len / 1024).toFixed(1)} KB | Playhead: ${meta.playheadTime?.toFixed(2)}s | Pool Weight: ${(trackedBytes / 1024 / 1024).toFixed(2)} MB`,
      meta.streamType === "PRELOADED_CACHE"
        ? "color: #71717a;"
        : "color: #38bdf8;",
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

  return { fileName, size: blob.size, dbData };
}
