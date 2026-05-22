// bridge.js
(function () {
  if (window.__ytAudioBridgeInitialized) return;
  window.__ytAudioBridgeInitialized = true;

  const DEBUG_TAG = "%c[YT-Audio-Bridge]";
  const DEBUG_STYLE = "color: #f59e0b; font-weight: bold;";

  console.log(
    `${DEBUG_TAG} MediaSource Harvester Active (Continuous Mode)`,
    DEBUG_STYLE,
  );

  let detectedMimeType = "";
  let isHarvesting = false;
  let lastChunkReceivedAt = 0;

  const originalAddSourceBuffer = MediaSource.prototype.addSourceBuffer;
  MediaSource.prototype.addSourceBuffer = function (mimeType) {
    const sourceBuffer = originalAddSourceBuffer.call(this, mimeType);
    if (mimeType.includes("audio")) {
      console.log(
        `${DEBUG_TAG} ⭐ Track Intercepted: ${mimeType}`,
        DEBUG_STYLE,
      );
      sourceBuffer.__isAudioStream = true;
      detectedMimeType = mimeType;
      broadcastFormat();
    }
    return sourceBuffer;
  };

  const originalAppendBuffer = SourceBuffer.prototype.appendBuffer;
  SourceBuffer.prototype.appendBuffer = function (buffer) {
    if (this.__isAudioStream) {
      try {
        let rawData = buffer;
        if (ArrayBuffer.isView(buffer)) {
          rawData = buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength,
          );
        }
        const chunk = new Uint8Array(rawData);
        const video = document.querySelector("video");

        if (isHarvesting) {
          lastChunkReceivedAt = Date.now();
        }

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

  async function runSeekProbe(duration, title) {
    const video = document.querySelector("video");
    if (!video) return;

    isHarvesting = true;
    lastChunkReceivedAt = Date.now();

    const originalTime = video.currentTime;
    const isPaused = video.paused;

    if (video.paused) {
      try {
        await video.play();
      } catch (e) {}
    }

    let currentStep = 0;
    const stepSize = 10;

    while (currentStep < duration) {
      video.currentTime = currentStep;
      await new Promise((resolve) => setTimeout(resolve, 180));
      currentStep += stepSize;
    }

    console.log(`${DEBUG_TAG} ⏳ Draining network pipeline...`, DEBUG_STYLE);
    let idleWindow = 2000; // Complete 2-second safe drain window
    while (Date.now() - lastChunkReceivedAt < idleWindow) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    isHarvesting = false;

    video.currentTime = originalTime;
    if (isPaused) video.pause();

    console.log(
      `${DEBUG_TAG} ✅ Complete track harvesting finished!`,
      DEBUG_STYLE,
    );

    window.postMessage(
      {
        source: "yt-audio-bridge",
        type: "HARVEST_COMPLETE",
        title: title,
      },
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

  window.addEventListener("message", (event) => {
    if (
      event.source === window &&
      event.data &&
      event.data.source === "yt-audio-content"
    ) {
      if (event.data.type === "REQ_CURRENT_FORMAT") broadcastFormat();
      if (event.data.type === "TRIGGER_HARVEST")
        runSeekProbe(event.data.duration, event.data.title);
    }
  });

  setInterval(broadcastFormat, 3000);
})();
