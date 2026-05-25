// bridge.js
(function () {
  if (window.__ytAudioBridgeInitialized) return;
  window.__ytAudioBridgeInitialized = true;

  const DEBUG_TAG = "%c[YT-Audio-Bridge]";
  const DEBUG_STYLE = "color: #f59e0b; font-weight: bold;";

  const activeAudioBuffers = new Set();
  let isHarvesting = false;
  let lastChunkReceivedAt = 0;
  let passivePreloadCache = [];
  window.__currentTrackInitHeader = null;
  let detectedMimeType = "";

  console.log(
    `${DEBUG_TAG} 🚀 Injection timing status: DOCUMENT_START verified. Overriding MediaSource...`,
    DEBUG_STYLE,
  );

  // 🛡️ AUDIO PROFILE LOCK: Force fallback to M4A/AAC format over Opus
  const originalIsTypeSupported = MediaSource.isTypeSupported;
  MediaSource.isTypeSupported = function (mimeType) {
    if (
      mimeType.includes("audio") &&
      (mimeType.includes("webm") || mimeType.includes("opus"))
    ) {
      console.log(
        `${DEBUG_TAG} 🛑 Denied layout codec mapping request for: ${mimeType} (Forcing M4A/AAC fallback)`,
        "color: #ef4444;",
      );
      return false;
    }
    return originalIsTypeSupported.call(this, mimeType);
  };

  const originalCanPlayType = HTMLMediaElement.prototype.canPlayType;
  HTMLMediaElement.prototype.canPlayType = function (mimeType) {
    if (
      mimeType.includes("audio") &&
      (mimeType.includes("webm") || mimeType.includes("opus"))
    ) {
      return "";
    }
    return originalCanPlayType.call(this, mimeType);
  };

  const originalAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
  MediaSource.prototype.addSourceBuffer = function (mimeType) {
    const sourceBuffer = originalAddSourceBuffer.call(this, mimeType);
    if (mimeType.includes("audio")) {
      console.log(
        `${DEBUG_TAG} ⭐ Captured structural target initialization codec stream: ${mimeType}`,
        "color: #10b981; font-weight: bold;",
      );
      sourceBuffer.__isAudioStream = true;
      activeAudioBuffers.add(sourceBuffer);
      detectedMimeType = mimeType;
      broadcastFormat();
    }
    return sourceBuffer;
  };

  const originalAppendBuffer = SourceBuffer.prototype.appendBuffer;
  SourceBuffer.prototype.appendBuffer = function (buffer) {
    if (this.__isAudioStream) {
      try {
        const chunk = new Uint8Array(buffer);
        const isStructuralHeader =
          chunk[4] === 0x66 &&
          chunk[5] === 0x74 &&
          chunk[6] === 0x79 &&
          chunk[7] === 0x70;
        const video = document.querySelector("video");

        if (isStructuralHeader) {
          window.__currentTrackInitHeader = chunk;
          console.log(
            `${DEBUG_TAG} 👑 Session Container Initialization Header Cached safely.`,
            "color: #a855f7; font-weight: bold;",
          );
        }

        // Live Telemetry Log added back
        console.log(
          `%c[YT-Audio-Bridge] 📦 Captured Block | Size: ${chunk.byteLength} B | Playhead: ${video ? video.currentTime.toFixed(2) : "0"}s | State: ${isHarvesting ? "HARVEST_LIVE" : "PASSIVE_CACHE"}`,
          isHarvesting ? "color: #38bdf8;" : "color: #71717a;",
        );

        if (!isHarvesting) {
          if (passivePreloadCache.length < 60) {
            passivePreloadCache.push({
              chunk,
              playheadTime: video ? video.currentTime : 0,
            });
          }
          return originalAppendBuffer.apply(this, arguments);
        }

        lastChunkReceivedAt = Date.now();
        window.postMessage(
          {
            source: "yt-audio-bridge",
            type: "AUDIO_CHUNK",
            chunk: chunk,
            metadata: {
              size: chunk.byteLength,
              playheadTime: video ? video.currentTime : 0,
            },
          },
          "*",
        );
      } catch (e) {
        console.error("Chunk capture error", e);
      }
    }
    return originalAppendBuffer.apply(this, arguments);
  };

  async function runSeekProbe(duration, title, artist) {
    const video = document.querySelector("video");
    if (!video) return;

    // 🚨 STAGE 1: Deterministically clear out the backend before flushes run
    window.postMessage(
      { source: "yt-audio-bridge", type: "HARVEST_START" },
      "*",
    );
    await new Promise((resolve) => setTimeout(resolve, 150)); // Sync buffer delay

    console.log(`${DEBUG_TAG} 🔄 Starting timeline sweep probe for: ${title}`);

    // Flush passive cache straight down the pipeline
    if (passivePreloadCache.length > 0) {
      console.log(
        `${DEBUG_TAG} ⚡ Flushing ${passivePreloadCache.length} passive preloader cache frames...`,
      );
      passivePreloadCache.forEach((item) => {
        window.postMessage(
          {
            source: "yt-audio-bridge",
            type: "AUDIO_CHUNK",
            chunk: item.chunk,
            metadata: {
              size: item.chunk.byteLength,
              playheadTime: item.playheadTime,
            },
          },
          "*",
        );
      });
      passivePreloadCache = [];
    }

    isHarvesting = true;
    lastChunkReceivedAt = Date.now();

    for (const sb of activeAudioBuffers) {
      try {
        if (sb && sb.buffered.length > 0) {
          sb.remove(0, 100000);
          await new Promise((resolve) =>
            sb.addEventListener("updateend", resolve, { once: true }),
          );
        }
      } catch (err) {}
    }

    if (window.__currentTrackInitHeader) {
      window.postMessage(
        {
          source: "yt-audio-bridge",
          type: "AUDIO_CHUNK",
          chunk: window.__currentTrackInitHeader,
          metadata: {
            size: window.__currentTrackInitHeader.byteLength,
            playheadTime: 0.0,
          },
        },
        "*",
      );
    }

    video.currentTime = 0.001;
    await new Promise((resolve) => setTimeout(resolve, 400));

    let currentStep = 10;
    const stepSize = 10;
    const safeEndBoundary = duration - 5.0;

    while (currentStep < safeEndBoundary) {
      video.currentTime = currentStep;
      await new Promise((resolve) => setTimeout(resolve, 400));
      currentStep += stepSize;
    }

    isHarvesting = false;
    try {
      video.pause();
      video.currentTime = 0;
    } catch (e) {}

    let idleWindow = 2000;
    while (Date.now() - lastChunkReceivedAt < idleWindow) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    window.postMessage(
      { source: "yt-audio-bridge", type: "HARVEST_COMPLETE", title, artist },
      "*",
    );
  }

  function broadcastFormat() {
    if (!detectedMimeType) return;
    window.postMessage(
      {
        source: "yt-audio-bridge",
        type: "AUDIO_TYPE_DETECTED",
        mimeType: detectedMimeType,
      },
      "*",
    );
  }

  window.addEventListener("message", (e) => {
    if (e.data?.source === "yt-audio-content") {
      if (e.data.type === "REQ_CURRENT_FORMAT") broadcastFormat();
      if (e.data.type === "TRIGGER_HARVEST")
        runSeekProbe(e.data.duration, e.data.title, e.data.artist);
      if (e.data.type === "RESET_BRIDGE_STREAM") {
        isHarvesting = false;
        passivePreloadCache = [];
        window.__currentTrackInitHeader = null;
        broadcastFormat();
      }
    }
  });

  setInterval(broadcastFormat, 3000);
})();
