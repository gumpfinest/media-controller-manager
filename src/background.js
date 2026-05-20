// Stores tracked media tabs and their latest known media state.
window.__tabs__ = new Map();
// Remembers recently navigated-away tracked tabs so paused media can re-register.
window.__pendingNavigationTimers__ = new Map();

function clearPendingNavigation(tid) {
  const timer = window.__pendingNavigationTimers__.get(tid);
  if (timer !== undefined) {
    clearTimeout(timer);
    window.__pendingNavigationTimers__.delete(tid);
  }
}

function markPendingNavigation(tid, ttlMs = 15000) {
  clearPendingNavigation(tid);
  const timer = setTimeout(() => {
    window.__pendingNavigationTimers__.delete(tid);
  }, ttlMs);
  window.__pendingNavigationTimers__.set(tid, timer);
}

function hasPendingNavigation(tid) {
  return window.__pendingNavigationTimers__.has(tid);
}

// Tries to inject probe scripts into one tab; restricted pages are skipped silently.
async function injectProbeScript(tid) {
  try {
    await browser.tabs.executeScript(tid, {
      file: "inject.js",
      allFrames: true,
      matchAboutBlank: true,
    });
  } catch {
    // Some browser pages/frames (about:, addons, etc.) reject script injection.
    try {
      await browser.tabs.executeScript(tid, { file: "inject.js" });
    } catch {
      // Skip restricted tabs that cannot host extension scripts.
    }
  }
}

// Calls a named method on every open popup window.
function applyPopupViews(func, args) {
  // Broadcast a UI update to every currently opened popup instance.
  const views = browser.extension.getViews({ type: "popup" });
  for (const view of views) {
    view[func].apply(view, args);
  }
}

// Converts any input to a safe volume in the 0..1 range.
function normalizeVolume(value) {
  const volume = Number(value);
  if (!Number.isFinite(volume)) {
    return 1;
  }
  return Math.max(0, Math.min(1, volume));
}

// Converts duration values to a non-negative finite number.
function normalizeDuration(value) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) {
    return 0;
  }
  return duration;
}

// Converts current time values to a valid position within duration bounds.
function normalizeCurrentTime(value, duration = 0) {
  const currentTime = Number(value);
  if (!Number.isFinite(currentTime) || currentTime < 0) {
    return 0;
  }
  if (duration > 0) {
    return Math.min(currentTime, duration);
  }
  return currentTime;
}

// Merges partial media updates with previous values into one consistent state object.
function mergeMediaState(previous, incoming = {}) {
  // Merge partial event payloads with previous state while preserving valid bounds.
  const base = previous ?? {};
  const duration = normalizeDuration(incoming.duration ?? base.duration);
  return {
    paused: Boolean(incoming.paused ?? base.paused ?? true),
    muted: Boolean(incoming.muted ?? base.muted ?? false),
    volume: normalizeVolume(incoming.volume ?? base.volume),
    duration,
    currentTime: normalizeCurrentTime(incoming.currentTime ?? base.currentTime, duration),
  };
}

// Executes in-tab code to read the best current media candidate and return its state.
async function readMediaSnapshot(tid) {
  // Ask the tab for the most relevant media element and read its current state.
  const [media] = await browser.tabs.executeScript(tid, {
    code: `(() => {
      let $media = document.querySelector("[mcx-media]");
      if ($media === null) {
        const $allMedia = Array.from(document.querySelectorAll("video, audio"));
        $media =
          $allMedia.find(($item) => !$item.paused && !$item.ended) ||
          $allMedia.find(($item) => !$item.ended) ||
          $allMedia[0] ||
          null;
        if ($media !== null && $media.getAttribute("mcx-media") === null) {
          $media.toggleAttribute("mcx-media", true);
        }
      }

      if ($media === null) {
        return null;
      }

      return {
        paused: $media.paused,
        muted: $media.muted,
        volume: $media.volume,
        currentTime: $media.currentTime,
        duration: $media.duration,
      };
    })();`,
  });
  return media ?? null;
}

// Progress-only events update the seek slider without recreating full card state.
const MEDIA_PROGRESS_EVENTS = new Set(["timeupdate", "durationchange", "loadedmetadata", "seeking", "seeked"]);

// Builds the extension-side tab model from browser tab metadata.
async function init(tab) {
  // Build metadata used by popup cards (title, icon, thumbnail, accent color).
  if (typeof tab === "number") {
    tab = await browser.tabs.get(tab);
  }
  const url = new URL(tab.url);
  // Prefer platform-specific artwork when available, otherwise fall back to OpenGraph image.
  const thumbnail = await (async () => {
    if (url.hostname.match(/^(www|music)\.youtube\.com$/)) {
      const vid = tab.url.match(/\/(?:watch\?v=|embed\/|shorts\/)([A-Za-z0-9_-]{11})/)[1];
      return `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
    }
    return (
      await browser.tabs.executeScript(tab.id, {
        code: `document.querySelector("meta[property='og:image']")?.getAttribute("content");`,
      })
    )[0];
  })();
  // Sample the first pixel of artwork/favicon to derive a card accent color.
  const color = await (async (src) => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        canvas.width = image.width;
        canvas.height = image.height;
        context.drawImage(image, 0, 0, 1, 1);
        resolve(context.getImageData(0, 0, 1, 1).data);
        // returns [r, g, b, a]
      };
      image.src = src;
    });
  })(thumbnail || tab.favIconUrl);
  return {
    id: tab.id,
    wid: tab.windowId,
    media: null,
    frameId: 0,
    title: tab.title,
    favicon: tab.favIconUrl,
    hostname: url.hostname,
    thumbnail: thumbnail,
    color: color,
  };
}

// Starts tracking one tab and wires page scripts/state into popup UI.
async function register(tid) {
  // Start tracking a tab, inject page scripts, then populate initial media state.
  if (window.__tabs__.has(tid)) {
    return;
  }

  clearPendingNavigation(tid);

  const tab = await init(tid);
  window.__tabs__.set(tid, tab);
  await browser.browserAction.enable();
  await browser.browserAction.setBadgeText({
    text: String(window.__tabs__.size),
  });
  await injectProbeScript(tid);

  const trackedTab = window.__tabs__.get(tid);
  if (trackedTab === undefined) {
    return;
  }

  try {
    const media = await readMediaSnapshot(tid);
    if (media !== null) {
      trackedTab.media = mergeMediaState(trackedTab.media, media);
    }
  } catch (error) {
    console.warn("Unable to read initial media snapshot", error);
  }

  applyPopupViews("add", [trackedTab]);
}

// Stops tracking one tab and tears down related UI/listeners.
async function unregister(tid) {
  // Stop tracking a tab and notify popup/page scripts to clean up listeners.
  window.__tabs__.delete(tid);
  applyPopupViews("del", [tid]);
  const size = window.__tabs__.size;
  size === 0 && (await browser.browserAction.disable());
  await browser.browserAction.setBadgeText({
    text: size > 0 ? String(size) : null,
  });
  try {
    await browser.tabs.sendMessage(tid, "@unhook");
  } catch {
    // Tab may be gone or have no listener anymore.
  }
}

// Toolbar starts disabled until at least one media tab is tracked.
browser.browserAction.disable();
browser.browserAction.setBadgeTextColor({ color: "white" });
browser.browserAction.setBadgeBackgroundColor({ color: "gray" });

// Probe existing completed tabs on startup; tabs register themselves via @hook messages.
browser.tabs.query({ status: "complete" }).then(async (tabs) => {
  for (const { id } of tabs) {
    await injectProbeScript(id);
  }
});

// Probe tabs once they become audible; registration occurs on valid @hook payloads.
browser.tabs.onUpdated.addListener(
  async (tid, { audible }) => {
    if (audible === true) {
      await injectProbeScript(tid);
    }
  },
  { properties: ["audible"] }
);

// Re-register on navigation so metadata/media references are refreshed.
browser.tabs.onUpdated.addListener(
  async (tid, changeInfo) => {
    if (changeInfo.status === "loading" && window.__tabs__.has(tid)) {
      markPendingNavigation(tid);
      await unregister(tid);
    }

    if (changeInfo.status === "complete") {
      await injectProbeScript(tid);
    }
  },
  { properties: ["status"] }
);

// Keep popup title in sync with tab title changes.
browser.tabs.onUpdated.addListener(
  async (tid, { title }) => {
    if (window.__tabs__.has(tid)) {
      window.__tabs__.get(tid).title = title;
      applyPopupViews("update", [window.__tabs__.get(tid)]);
    }
  },
  { properties: ["title"] }
);

// Drop suspended tabs from tracking until they become active/audible again.
browser.tabs.onUpdated.addListener(
  async (tid, { discarded }) => {
    if (discarded && window.__tabs__.has(tid)) {
      clearPendingNavigation(tid);
      await unregister(tid);
    }
  },
  { properties: ["discarded"] }
);

// Remove tracking when tab closes.
browser.tabs.onRemoved.addListener(async (tid) => {
  clearPendingNavigation(tid);
  if (window.__tabs__.has(tid)) {
    await unregister(tid);
  }
});

// Handles state updates from content scripts and applies the lightest possible popup refresh.
browser.runtime.onMessage.addListener(async (message, sender) => {
  // Route page media events into stored state and update popup efficiently.
  const tid = sender.tab?.id;
  const frameId = Number.isInteger(sender.frameId) ? sender.frameId : 0;
  if (typeof tid !== "number") {
    return;
  }

  if (message.type === "@hook" && !window.__tabs__.has(tid)) {
    const tabInfo = await browser.tabs.get(tid);
    if (tabInfo.audible || hasPendingNavigation(tid)) {
      await register(tid);
    } else {
      return;
    }
  }

  const tab = window.__tabs__.get(tid);
  if (tab === undefined) {
    return;
  }

  if (message.type === "@hook") {
    tab.frameId = frameId;
    tab.media = mergeMediaState(tab.media, message.media);
    try {
      await browser.tabs.executeScript(tid, { file: "hook.js", frameId, matchAboutBlank: true });
    } catch {
      // Frame may no longer exist after in-page player navigation.
    }
    applyPopupViews("update", [tab]);
  } else if (message.type === "play" || message.type === "pause") {
    tab.frameId = frameId;
    const paused = message.type === "play" ? false : true;
    tab.media = mergeMediaState(tab.media, { ...message, paused });
    applyPopupViews("update", [tab]);
  } else if (message.type === "volumechange") {
    tab.frameId = frameId;
    tab.media = mergeMediaState(tab.media, message);
    applyPopupViews("syncVolume", [tid, tab.media]);
  } else if (MEDIA_PROGRESS_EVENTS.has(message.type)) {
    tab.frameId = frameId;
    tab.media = mergeMediaState(tab.media, message);
    applyPopupViews("syncProgress", [tid, tab.media]);
  } else return;
});
