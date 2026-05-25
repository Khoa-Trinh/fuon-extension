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
  let isUploading = false;

  // 🤖 CONTROL LOCK STAGING PARAMS
  let isNavigationSettling = false;
  let isHarvestingActive = false;

  function getChannelName() {
    const el =
      document.querySelector("#channel-name #text a") ||
      document.querySelector("ytd-channel-name #text") ||
      document.querySelector(".ytd-channel-name #text");
    return el ? el.innerText.trim() : "Unknown Publisher";
  }

  // 1. UI Tree Nodes Construction
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

  // 🔄 INTERNAL RUNTIME NOTIFICATION LISTENER LAYER
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log(
      `[ROUTER-TRACE] 📥 Content script received runtime message type: ${message.type}`,
    );

    if (message.type === "UPLOAD_PIPELINE_COMPLETE") {
      console.log(
        "[AUTOMATOR-TRACE] Success! Tab matched completion token:",
        message,
      );

      isUploading = false;
      isHarvestingActive = false;

      if (message.success) {
        chrome.storage.local.get(["playlist_automator_active"], (checkData) => {
          if (checkData.playlist_automator_active) {
            const hasNextTrack = executeFullPageNavigation();
            if (!hasNextTrack) {
              console.warn(
                "[AUTOMATOR-TRACE] 🏁 End of playlist or track nodes missing. Halting automation loop.",
              );
              chrome.storage.local.set(
                { playlist_automator_active: false },
                () => {
                  renderInner();
                },
              );
            }
          } else {
            console.log(
              "[YT-Audio] Walkthrough complete. Automation flag is set to false.",
            );
            renderInner();
          }
        });
      } else {
        console.warn(
          "[AUTOMATOR-TRACE] ❌ Async transaction reported failure metrics status:",
          message.error,
        );
        chrome.storage.local.set({ playlist_automator_active: false }, () => {
          renderInner();
        });
      }
    }
  });

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
      executeUploadPipeline(event.data.title, event.data.artist);
    }
  });

  let globalUploadBtnReference = null;

  function renderInner() {
    chrome.storage.local.get(["playlist_automator_active"], (storeData) => {
      const isAutoActive = !!storeData.playlist_automator_active;
      contentArea.innerHTML = "";

      if (activeTab === "config") {
        renderConfig();
        return;
      }

      if (activeTab === "download") {
        const title = document.createElement("div");
        title.innerText = videoTitle;
        title.style.cssText =
          "font-size:13px; font-weight:600; color:#fafafa; margin-bottom:16px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; opacity:0.8;";
        contentArea.appendChild(title);

        const isStaticPlaylistPage =
          window.location.pathname.includes("/playlist");

        if (isAutoActive && !isStaticPlaylistPage) {
          const killSwitchBtn = document.createElement("button");
          killSwitchBtn.innerHTML = `<span>🛑 Stop Automation (Finishes Current Track)</span>`;
          killSwitchBtn.style.cssText = `width:100%; padding:11px 12px; margin-bottom:16px; background:#b91c1c; color:#fafafa; border:1px solid #f87171; border-radius:6px; cursor:pointer; font-size:12px; font-weight:600; text-align:center; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.2); transition:all 0.2s;`;

          killSwitchBtn.onclick = (e) => {
            e.stopPropagation();
            console.warn(
              "[AUTOMATOR-TRACE] 🛑 Manual UI kill switch button clicked.",
            );
            isUploading = false;
            isHarvestingActive = false;
            chrome.storage.local.set(
              { playlist_automator_active: false },
              () => {
                renderInner();
              },
            );
          };
          contentArea.appendChild(killSwitchBtn);
        } else if (
          !isAutoActive &&
          (isHarvestingActive || isUploading) &&
          !isStaticPlaylistPage
        ) {
          const haltingStatus = document.createElement("div");
          haltingStatus.innerHTML = `<span>⚠️ Halting playlist progression once active upload completes...</span>`;
          haltingStatus.style.cssText = `width:100%; padding:10px 12px; margin-bottom:16px; background:#27272a; color:#a1a1aa; border:1px solid #3f3f46; border-radius:6px; font-size:11px; font-weight:500; text-align:center; box-sizing:border-box;`;
          contentArea.appendChild(haltingStatus);
        }

        if (isStaticPlaylistPage) {
          const startPlaylistBtn = document.createElement("button");
          startPlaylistBtn.innerHTML = `<span style="opacity:0.9">▶ Harvest Full Playlist</span>`;
          startPlaylistBtn.style.cssText = `width:100%; padding:12px; background:#10b981; color:#09090b; border:none; border-radius:6px; cursor:pointer; font-size:12px; font-weight:600; text-align:center; transition: all 0.2s;`;

          startPlaylistBtn.onclick = () => {
            startPlaylistBtn.innerText = "PARSING VIEWPORT NODES...";
            const trackLinks = Array.from(
              document.querySelectorAll(
                "ytd-playlist-video-renderer a#video-title, ytd-playlist-video-renderer a#thumbnail, ytd-playlist-video-list-renderer a, a[href*='/watch?v='][href*='list=']",
              ),
            );
            const targetTrack = trackLinks.find(
              (el) => el.href && (el.offsetWidth > 0 || el.offsetHeight > 0),
            );

            if (targetTrack && targetTrack.href) {
              chrome.storage.local.set(
                { playlist_automator_active: true },
                () => {
                  window.location.href = targetTrack.href;
                },
              );
            } else {
              const fallbackPlayBtn = document.querySelector(
                "a[href*='/watch?v='][href*='index=1'], ytd-playlist-header-renderer a[href*='/watch?v=']",
              );
              if (fallbackPlayBtn && fallbackPlayBtn.href) {
                chrome.storage.local.set(
                  { playlist_automator_active: true },
                  () => {
                    window.location.href = fallbackPlayBtn.href;
                  },
                );
              } else {
                startPlaylistBtn.innerText =
                  "No readable track anchors found ❌";
              }
            }
          };
          contentArea.appendChild(startPlaylistBtn);
          return;
        }

        const keys = Object.keys(detectedFormats);
        if (keys.length === 0 || isNavigationSettling) {
          contentArea.innerHTML += `<div style="text-align:center; padding-top:40px; color:#71717a; font-size:13px; line-height:1.6;">${
            isNavigationSettling
              ? "Stabilizing layout media buffers...<br/>Aligning tracking head array vectors."
              : "Waiting for media engine validation...<br/>Start playback to sync."
          }</div>`;
          return;
        }

        keys.forEach((key) => {
          const info = detectedFormats[key];
          const btn = document.createElement("button");
          btn.style.cssText = `width:100%; padding:10px 12px; margin-bottom:8px; background:#18181b; color:#fafafa; border:1px solid #27272a; border-radius:6px; font-size:12px; font-weight:500; text-align:left; transition:all 0.2s;`;

          if (isUploading) {
            btn.innerHTML = `<span style="opacity:0.6">FINALIZING CLOUD UPLOAD...</span>`;
            btn.disabled = true;
          } else if (isHarvestingActive) {
            btn.innerHTML = `<span style="opacity:0.6">HARVESTING TIMELINE...</span>`;
            btn.disabled = true;
          } else {
            btn.innerHTML = `<span style="opacity:0.9">Harvest & Upload (${info.extension.toUpperCase()})</span>`;
            btn.disabled = false;
            btn.style.cursor = "pointer";
            btn.onclick = () => triggerTrackHarvest(btn);
          }
          contentArea.appendChild(btn);
        });

        if (
          isAutoActive &&
          keys.length > 0 &&
          !isUploading &&
          !isNavigationSettling &&
          !isHarvestingActive
        ) {
          const firstBtn = contentArea.querySelector("button");
          if (firstBtn && !firstBtn.disabled) triggerTrackHarvest(firstBtn);
        }
      }
    });
  }

  function triggerTrackHarvest(targetButtonElement) {
    if (isHarvestingActive) return;
    isHarvestingActive = true;

    const videoEl = document.querySelector("video");
    if (!videoEl || isNaN(videoEl.duration)) {
      isHarvestingActive = false;
      return;
    }

    const capturedTitle = document.title;
    const capturedArtist = getChannelName();
    globalUploadBtnReference = targetButtonElement;

    renderInner();

    window.postMessage(
      {
        source: "yt-audio-content",
        type: "TRIGGER_HARVEST",
        duration: videoEl.duration,
        title: capturedTitle,
        artist: capturedArtist,
      },
      "*",
    );
  }

  async function executeUploadPipeline(capturedTitle, capturedArtist) {
    if (isUploading) return;
    isUploading = true;

    if (globalUploadBtnReference) {
      globalUploadBtnReference.innerText = "FINALIZING CLOUD UPLOAD...";
    }
    renderInner();

    const videoEl = document.querySelector("video");
    const duration = videoEl ? videoEl.duration : 0;

    const cfg = await chrome.storage.local.get([
      "supabaseUrl",
      "publishableKey",
      "secretKey",
      "bucketName",
    ]);
    const activeInfo = detectedFormats[Object.keys(detectedFormats)[0]];

    const urlParams = new URLSearchParams(window.location.search);
    const isInsidePlaylist = urlParams.has("list");
    let activePlaylistTitle = "";

    if (isInsidePlaylist) {
      const playlistHeader = document.querySelector(
        "ytd-playlist-panel-renderer #inline-title-text, " +
          "ytd-playlist-panel-renderer .title-container yt-formatted-string, " +
          "ytd-playlist-panel-renderer #header-description h3, " +
          "ytd-playlist-panel-renderer #title-text a, " +
          "ytd-playlist-panel-renderer #title-text, " +
          "ytd-playlist-panel-renderer h4#inline-title-text",
      );
      if (playlistHeader) {
        activePlaylistTitle = (
          playlistHeader.textContent || playlistHeader.innerText
        ).trim();
        activePlaylistTitle = activePlaylistTitle.replace(
          /\s*\(\d+\/\d+\)\s*$/,
          "",
        );
      } else {
        activePlaylistTitle = "Untitled_Playlist";
      }
    }

    chrome.runtime.sendMessage({
      type: "TRIGGER_OFFSCREEN_SUBMIT",
      title: capturedTitle,
      artist: capturedArtist,
      playlistTitle: activePlaylistTitle,
      duration: duration,
      extension: activeInfo.extension,
      mimeType: activeInfo.mimeType,
      config: cfg,
    });
  }

  function executeFullPageNavigation() {
    console.log(
      "[YT-Audio] Scanning sidebar playlist renderers grid layout arrays...",
    );
    const allItems = Array.from(
      document.querySelectorAll("ytd-playlist-panel-video-renderer"),
    );

    const urlParams = new URLSearchParams(window.location.search);
    const currentVidId = urlParams.get("v");

    if (!currentVidId) {
      console.error(
        "[AUTOMATOR-TRACE] ❌ Unable to extract active video parameter ID from page URL context window.",
      );
      return false;
    }

    const activeIndex = allItems.findIndex((el) => {
      const anchor = el.querySelector("a[href*='v=']");
      if (!anchor) return false;
      const itemUrlParams = new URLSearchParams(
        new URL(anchor.href, window.location.origin).search,
      );
      return itemUrlParams.get("v") === currentVidId;
    });

    if (activeIndex === -1 || activeIndex >= allItems.length - 1) {
      console.warn(
        "[AUTOMATOR-TRACE] 🏁 Terminal list item reached or current track index not found in sidebar list view.",
      );
      return false;
    }

    const nextItem = allItems[activeIndex + 1];
    const targetAnchorLink = nextItem.querySelector(
      "a#thumbnail, a.ytd-playlist-panel-video-renderer, a[href*='v=']",
    );

    if (!targetAnchorLink || !targetAnchorLink.href) {
      console.error(
        "[AUTOMATOR-TRACE] Found next row item, but could not resolve target navigation string anchor properties.",
      );
      return false;
    }

    console.log(
      "[YT-Audio] Success! Navigation point resolved. Redirecting window to next playlist track:",
      targetAnchorLink.href,
    );
    window.location.href = targetAnchorLink.href;
    return true;
  }

  function renderConfig() {
    const fields = [
      { id: "supabaseUrl", l: "Supabase URL", type: "text" },
      { id: "publishableKey", l: "Anon Key", type: "password" },
      { id: "secretKey", l: "Secret Key (Service Role)", type: "password" },
      { id: "bucketName", l: "Bucket Name", type: "text" },
    ];

    chrome.storage.local.get(
      fields.map((f) => f.id),
      (data) => {
        fields.forEach((f) => {
          const wrapper = document.createElement("div");
          wrapper.style.marginBottom = "12px";

          const label = document.createElement("label");
          label.innerText = f.l;
          label.style.cssText =
            "display:block; font-size:11px; color:#a1a1aa; margin-bottom:4px; font-weight:500;";

          const input = document.createElement("input");
          input.type = f.type;
          input.value = data[f.id] || "";
          input.style.cssText =
            "width:100%; background:#18181b; border:1px solid #27272a; color:#fafafa; padding:8px 10px; border-radius:6px; font-size:12px; box-sizing:border-box; outline:none; transition: border 0.2s;";

          input.onfocus = () => {
            input.style.borderColor = "#3f3f46";
          };
          input.onblur = () => {
            input.style.borderColor = "#27272a";
          };
          input.oninput = (e) => {
            chrome.storage.local.set({ [f.id]: e.target.value });
          };

          wrapper.appendChild(label);
          wrapper.appendChild(input);
          contentArea.appendChild(wrapper);
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
    const isInsidePlaylist = urlParams.has("list");
    const isStaticList = window.location.pathname.includes("/playlist");

    if (!videoId && !isStaticList) return;
    if (videoId && videoId === currentVideoId) return;

    console.log(
      `[YT-Audio] Context re-anchored. Flushing runtime architectures.`,
    );
    currentVideoId = videoId || "STATIC_LIST_VIEW";

    isNavigationSettling = true;
    isHarvestingActive = false;
    detectedFormats = {};
    videoTitle = "Loading...";

    if (isInsidePlaylist || isStaticList) {
      console.log(
        "[AUTOMATOR-TRACE] Playlist token matched inside URL window scope. Setting active auto flag to TRUE.",
      );
      chrome.storage.local.set({ playlist_automator_active: true }, () => {
        renderInner();
      });
    } else {
      console.log(
        "[AUTOMATOR-TRACE] Arrived at a standalone video page. Dropping active auto flag to FALSE.",
      );
      chrome.storage.local.set({ playlist_automator_active: false }, () => {
        renderInner();
      });
    }

    window.postMessage(
      { source: "yt-audio-content", type: "RESET_BRIDGE_STREAM" },
      "*",
    );

    // ⚡ INSTANT WARM-UP TRIGGER: Wake up offscreen.js immediately on page click to catch early headers
    chrome.runtime.sendMessage({ type: "PREPARE_AND_RESET_OFFSCREEN" });

    if (isStaticList) {
      isNavigationSettling = false;
      pollVideoTitle();
      return;
    }

    let checkAttempts = 0;
    const maxAttempts = 30;

    const autoSettleInterval = setInterval(() => {
      const videoEl = document.querySelector("video");
      const keys = Object.keys(detectedFormats);
      checkAttempts++;

      // 🔥 OPTIMIZATION: Released gates immediately when layout formats sync
      if (videoEl && keys.length > 0) {
        clearInterval(autoSettleInterval);
        console.log(
          "[YT-Audio] New track instance media layers normalized perfectly. Releasing gates.",
        );
        isNavigationSettling = false;
        pollVideoTitle();
        return;
      }

      if (checkAttempts >= maxAttempts) {
        clearInterval(autoSettleInterval);
        console.warn(
          "[YT-Audio] Media stream structural alignment lookup synchronization timeout reached.",
        );
        isNavigationSettling = false;
        pollVideoTitle();
      }
    }, 200); // Faster polling rate
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
