// content.js
if (window.__ytAudioContentInitialized) {
  console.log(
    "[YT-Audio-DEBUG] UI core context already mounted. Skipping re-initialization.",
  );
} else {
  window.__ytAudioContentInitialized = true;
  console.log("[YT-Audio-DEBUG] UI Script Initializing...");

  let videoTitle = document.title;
  let detectedFormats = {};
  let activeTab = "download";
  let currentVideoId = "";
  let isUploading = false; // Rigid state execution lock

  // 1. UI Construction
  const container = document.createElement("div");
  container.id = "yt-audio-container";
  container.style.cssText = `position: fixed; bottom: 24px; right: 24px; z-index: 999999; width: 48px; height: 48px; background-color: #09090b; border: 1px solid #27272a; border-radius: 24px; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.5); transition: all 0.4s; overflow: hidden; cursor: pointer; font-family: ui-sans-serif, system-ui, sans-serif; color: #fafafa;`;

  const icon = document.createElement("div");
  icon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>`;
  icon.style.cssText = `width: 48px; height: 48px; display: flex; justify-content: center; align-items: center; transition: opacity 0.2s;`;

  const content = document.createElement("div");
  content.style.cssText = `width: 320px; height: 400px; opacity: 0; transition: opacity 0.3s ease 0.1s; display: flex; flex-direction: column; pointer-events: none;`;

  const tabHeader = document.createElement("div");
  tabHeader.style.cssText =
    "display:flex; padding:8px 12px; background:#09090b; gap:4px; border-bottom: 1px solid #27272a;";

  const createTab = (id, label) => {
    const t = document.createElement("div");
    t.innerText = label;
    t.style.cssText = `flex:1; padding:6px 12px; text-align:center; cursor:pointer; font-size:12px; font-weight:500; border-radius:6px; transition: all 0.2s; color: #71717a;`;
    t.onclick = (e) => {
      e.stopPropagation();
      switchTab(id);
    };
    return t;
  };

  const tabDl = createTab("download", "Harvest & Upload");
  const tabCfg = createTab("config", "Settings");
  tabHeader.appendChild(tabDl);
  tabHeader.appendChild(tabCfg);

  const contentArea = document.createElement("div");
  contentArea.style.cssText =
    "padding:16px; overflow-y:auto; flex:1; background:#09090b;";

  const switchTab = (id) => {
    activeTab = id;
    const activeStyle = { color: "#fafafa", background: "#27272a" };
    const inactiveStyle = { color: "#71717a", background: "transparent" };
    Object.assign(tabDl.style, id === "download" ? activeStyle : inactiveStyle);
    Object.assign(tabCfg.style, id === "config" ? activeStyle : inactiveStyle);
    renderInner();
  };

  content.appendChild(tabHeader);
  content.appendChild(contentArea);
  container.appendChild(icon);
  container.appendChild(content);
  document.body.appendChild(container);

  container.onmouseenter = () => {
    container.style.width = "320px";
    container.style.height = "400px";
    container.style.borderRadius = "12px";
    icon.style.opacity = "0";
    content.style.opacity = "1";
    content.style.pointerEvents = "auto";
    switchTab(activeTab);
    askBridgeForFormat();
  };

  container.onmouseleave = () => {
    container.style.width = "48px";
    container.style.height = "48px";
    container.style.borderRadius = "24px";
    icon.style.opacity = "1";
    content.style.opacity = "0";
    content.style.pointerEvents = "none";
  };

  function askBridgeForFormat() {
    window.postMessage(
      { source: "yt-audio-content", type: "REQ_CURRENT_FORMAT" },
      "*",
    );
  }

  window.addEventListener("message", (event) => {
    if (
      event.source !== window ||
      !event.data ||
      event.data.source !== "yt-audio-bridge"
    )
      return;

    if (event.data.type === "AUDIO_TYPE_DETECTED") {
      const mime = event.data.mimeType;
      const id = mime.includes("mp4") ? "140" : "251";

      if (!detectedFormats[id]) {
        console.log(
          `%c[YT-Audio-DEBUG] Target channel synced: ${mime}`,
          "color: #10b981; font-weight: bold;",
        );
        detectedFormats[id] = {
          mimeType: mime,
          extension: mime.includes("mp4") ? "m4a" : "webm",
        };
        renderInner();
      }
    }

    if (event.data.type === "AUDIO_CHUNK") {
      chrome.runtime.sendMessage({
        type: "TRICKLE_TO_OFFSCREEN",
        chunk: Array.from(event.data.chunk),
        metadata: event.data.metadata,
      });
    }

    if (event.data.type === "HARVEST_COMPLETE") {
      executeUploadPipeline(event.data.title);
    }
  });

  let globalUploadBtnReference = null;

  function renderInner() {
    contentArea.innerHTML = "";
    if (activeTab === "download") {
      const title = document.createElement("div");
      title.innerText = videoTitle;
      title.style.cssText =
        "font-size:13px; font-weight:600; color:#fafafa; margin-bottom:16px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; opacity:0.8;";
      contentArea.appendChild(title);

      const keys = Object.keys(detectedFormats);
      if (keys.length === 0) {
        contentArea.innerHTML += `<div style="text-align:center; padding-top:60px; color:#71717a; font-size:13px; line-height:1.6;">Waiting for media engine validation...<br/>Start playback to sync.</div>`;
        return;
      }

      keys.forEach((key) => {
        const info = detectedFormats[key];
        const btn = document.createElement("button");
        btn.innerHTML = `<span style="opacity:0.9">Harvest & Upload (${info.extension.toUpperCase()})</span> <span style="font-size:10px; opacity:0.4;">FAST</span>`;
        btn.style.cssText = `width:100%; padding:10px 12px; margin-bottom:8px; background:#18181b; color:#fafafa; border:1px solid #27272a; border-radius:6px; cursor:pointer; font-size:12px; font-weight:500; text-align:left; transition:all 0.2s;`;

        btn.onclick = async () => {
          const videoEl = document.querySelector("video");
          if (!videoEl || isNaN(videoEl.duration)) return;

          // LOCK THE TITLE at the exact moment of click
          const capturedTitle = document.title;

          globalUploadBtnReference = btn;
          btn.disabled = true;
          btn.innerText = "HARVESTING TIMELINE...";
          btn.style.opacity = "0.5";

          window.postMessage(
            {
              source: "yt-audio-content",
              type: "TRIGGER_HARVEST",
              duration: videoEl.duration,
              title: capturedTitle,
            },
            "*",
          );
        };
        contentArea.appendChild(btn);
      });
    } else {
      renderConfig();
    }
  }

  async function executeUploadPipeline(capturedTitle) {
    if (!globalUploadBtnReference || isUploading) return;
    isUploading = true;
    globalUploadBtnReference.innerText = "FINALIZING CLOUD UPLOAD...";

    const cfg = await chrome.storage.local.get([
      "supabaseUrl",
      "publishableKey",
      "secretKey",
      "bucketName",
    ]);
    const activeInfo = detectedFormats[Object.keys(detectedFormats)[0]];

    chrome.runtime.sendMessage(
      {
        type: "TRIGGER_OFFSCREEN_SUBMIT",
        title: capturedTitle,
        extension: activeInfo.extension,
        mimeType: activeInfo.mimeType,
        config: cfg,
      },
      (r) => {
        isUploading = false;
        if (r && r.success) {
          globalUploadBtnReference.innerHTML = "Success! Saved ✅";
          globalUploadBtnReference.style.borderColor = "#10b981";
          setTimeout(() => {
            globalUploadBtnReference.disabled = false;
            renderInner();
          }, 2000);
        } else {
          globalUploadBtnReference.innerHTML = "Upload Failed ❌";
          globalUploadBtnReference.style.borderColor = "#ef4444";
          globalUploadBtnReference.disabled = false;
        }
      },
    );
  }

  function renderConfig() {
    const fields = [
      { id: "supabaseUrl", l: "Supabase URL" },
      { id: "publishableKey", l: "Anon Key" },
      { id: "secretKey", l: "Secret Key" },
      { id: "bucketName", l: "Bucket Name" },
    ];
    chrome.storage.local.get(
      fields.map((f) => f.id),
      (data) => {
        fields.forEach((f) => {
          const l = document.createElement("label");
          l.innerText = f.l;
          l.style.cssText =
            "display:block; font-size:11px; color:#a1a1aa; margin-bottom:4px;";
          const i = document.createElement("input");
          i.type = f.id.includes("Key") ? "password" : "text";
          i.value = data[f.id] || "";
          i.style.cssText =
            "width:100%; background:#09090b; border:1px solid #27272a; color:#fafafa; padding:8px 10px; border-radius:6px; margin-bottom:12px; font-size:12px; box-sizing:border-box;";
          i.onchange = (e) =>
            chrome.storage.local.set({ [f.id]: e.target.value });
          contentArea.appendChild(l);
          contentArea.appendChild(i);
        });
      },
    );
  }

  function pollVideoTitle(attempts = 0) {
    const rawTitle = document.title;
    const titleNode = document.querySelector(
      "ytd-watch-metadata h1 yt-formatted-string",
    );
    const structuralTitle = titleNode ? titleNode.innerText : "";
    if (
      (rawTitle === "YouTube" ||
        rawTitle === "Loading..." ||
        (structuralTitle && !rawTitle.includes(structuralTitle))) &&
      attempts < 10
    ) {
      setTimeout(() => pollVideoTitle(attempts + 1), 200);
      return;
    }
    videoTitle = rawTitle;
    renderInner();
    askBridgeForFormat();
  }

  function handleNavigationReset() {
    const urlParams = new URLSearchParams(window.location.search);
    const videoId = urlParams.get("v");
    if (!videoId || videoId === currentVideoId) return;
    console.log(
      `[YT-Audio] New video entry confirmed (${videoId}). Resetting memory layers.`,
    );
    currentVideoId = videoId;
    chrome.runtime.sendMessage({ type: "PREPARE_AND_RESET_OFFSCREEN" });
    videoTitle = "Loading...";
    detectedFormats = {};
    renderInner();
    pollVideoTitle();
  }

  window.addEventListener("yt-navigate-finish", handleNavigationReset);
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      handleNavigationReset();
    }
  }).observe(document, { subtree: true, childList: true });

  handleNavigationReset();
}
