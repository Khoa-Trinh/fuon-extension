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
        const playhead = video ? video.currentTime : 0;

        if (isStructuralHeader) {
          window.__currentTrackInitHeader = chunk;
          console.log(
            `${DEBUG_TAG} 👑 Session Container Initialization Header Cached safely. Size: ${chunk.byteLength} B`,
            "color: #a855f7; font-weight: bold;",
          );
        }

        const streamType = isHarvesting ? "HARVEST_LIVE" : "PASSIVE_PRELOAD";
        console.log(
          `%c[YT-Audio-Bridge] 📦 Raw Append Buffer | Size: ${chunk.byteLength} B | Playhead: ${playhead.toFixed(2)}s | Engine: ${streamType}`,
          isHarvesting ? "color: #38bdf8;" : "color: #71717a;",
        );

        if (!isHarvesting) {
          if (passivePreloadCache.length < 200) {
            passivePreloadCache.push({ chunk, playheadTime: playhead });
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
              playheadTime: playhead,
              streamType: "HARVEST_LIVE",
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

    console.log(`${DEBUG_TAG} 🚀 Dispatching Preload Cache to Offscreen...`);
    // 1. Send Header + Cache immediately
    if (window.__currentTrackInitHeader) {
      window.postMessage(
        {
          source: "yt-audio-bridge",
          type: "AUDIO_CHUNK",
          chunk: window.__currentTrackInitHeader,
          metadata: {
            size: window.__currentTrackInitHeader.byteLength,
            playheadTime: 0.0,
            streamType: "HEADER",
          },
        },
        "*",
      );
    }

    // 2. Dump Cache with explicit Await Logic
    if (passivePreloadCache.length > 0) {
      console.log(
        `${DEBUG_TAG} ⚡ Flushing ${passivePreloadCache.length} cached blocks...`,
      );
      for (const item of passivePreloadCache) {
        const isHeaderDup =
          item.chunk[4] === 0x66 &&
          item.chunk[5] === 0x74 &&
          item.chunk[6] === 0x79 &&
          item.chunk[7] === 0x70;
        if (isHeaderDup) continue;

        window.postMessage(
          {
            source: "yt-audio-bridge",
            type: "AUDIO_CHUNK",
            chunk: item.chunk,
            metadata: {
              size: item.chunk.byteLength,
              playheadTime: item.playheadTime,
              streamType: "PRELOADED_CACHE",
            },
          },
          "*",
        );

        // Wait for the browser message loop to actually dispatch this
        await new Promise((r) => setTimeout(r, 20));
      }
      passivePreloadCache = [];
      // Give the offscreen worker an extra 200ms to clear its event queue before scrubbing starts
      await new Promise((r) => setTimeout(r, 200));
    }

    isHarvesting = true;
    lastChunkReceivedAt = Date.now();

    // 2. Scrub timeline from end of cache to duration
    let currentStep = 30;
    const stepSize = 10;
    const safeEndBoundary = duration - 2.0;

    while (currentStep < safeEndBoundary) {
      video.currentTime = currentStep;
      console.log(
        `${DEBUG_TAG} 🗺️ Scrubbing layout tracking head -> Target: ${currentStep.toFixed(1)}s / ${duration.toFixed(1)}s`,
      );
      await new Promise((resolve) => setTimeout(resolve, 400));
      currentStep += stepSize;
    }

    isHarvesting = false;
    try {
      video.pause();
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
        // The cache belongs to the video context, not the UI state.
        window.__currentTrackInitHeader = null;
        broadcastFormat();
      }
    }
  });

  setInterval(broadcastFormat, 3000);
})();
