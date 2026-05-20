import Icons from "./icons.js";

let background;

const $main = document.querySelector("main");

const clampVolume = (value) => {
  const volume = Number(value);
  if (!Number.isFinite(volume)) {
    return 1;
  }
  return Math.max(0, Math.min(1, volume));
};

const clampDuration = (value) => {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) {
    return 0;
  }
  return duration;
};

const clampCurrentTime = (value, duration = 0) => {
  const currentTime = Number(value);
  if (!Number.isFinite(currentTime) || currentTime < 0) {
    return 0;
  }
  if (duration > 0) {
    return Math.min(currentTime, duration);
  }
  return currentTime;
};

const splitMediaTitle = (title, fallback) => {
  const normalizedTitle = String(title || "").trim();
  if (normalizedTitle.length === 0) {
    return {
      primary: String(fallback || "Unknown media"),
      secondary: "",
    };
  }

  const separators = [" - ", " | ", " \u2014 ", " \u00b7 "];
  for (const separator of separators) {
    const index = normalizedTitle.indexOf(separator);
    if (index > 0 && index < normalizedTitle.length - separator.length) {
      return {
        primary: normalizedTitle.slice(0, index).trim(),
        secondary: normalizedTitle.slice(index + separator.length).trim(),
      };
    }
  }

  return {
    primary: normalizedTitle,
    secondary: String(fallback || ""),
  };
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const mediaActionScript = (actionCode) => `(() => {
  const mediaScore = ($media) => {
    if (!($media instanceof HTMLMediaElement) || $media.ended) {
      return -1;
    }

    const rect = $media.getBoundingClientRect();
    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
    const playingBoost = $media.paused ? 0 : 1000000;
    const audibleBoost = $media.muted || $media.volume === 0 ? 0 : 100000;
    return playingBoost + audibleBoost + area;
  };

  const setActiveMedia = ($media) => {
    for (const $tagged of document.querySelectorAll("[mcx-media]")) {
      if ($tagged !== $media) {
        $tagged.toggleAttribute("mcx-media", false);
      }
    }
    if ($media.getAttribute("mcx-media") === null) {
      $media.toggleAttribute("mcx-media", true);
    }
  };

  const ensureMedia = () => {
    let $media = window.$media || document.querySelector("[mcx-media]");
    if (!$media || !document.contains($media) || $media.ended) {
      const $allMedia = Array.from(document.querySelectorAll("video, audio"));
      $media = $allMedia.sort(($a, $b) => mediaScore($b) - mediaScore($a))[0] || null;
    }
    if ($media === null) {
      return null;
    }

    setActiveMedia($media);

    if (!window.$media || window.$media !== $media) {
      void browser.runtime.sendMessage({
        type: "@hook",
        media: {
          paused: $media.paused,
          muted: $media.muted,
          volume: $media.volume,
          currentTime: $media.currentTime,
          duration: $media.duration,
        },
      });
    }
    window.$media = $media;
    return $media;
  };

  const $media = ensureMedia();
  if ($media === null) {
    return;
  }

  ${actionCode}
})();`;

const runMediaAction = async (tab, actionCode) => {
  const code = mediaActionScript(actionCode);
  const frameId = Number.isInteger(tab.frameId) ? tab.frameId : 0;

  try {
    await browser.tabs.executeScript(tab.id, {
      code,
      frameId,
      matchAboutBlank: true,
    });
    return;
  } catch {
    // Fallback to all frames for sites that move players between frames.
  }

  try {
    await browser.tabs.executeScript(tab.id, {
      code,
      allFrames: true,
      matchAboutBlank: true,
    });
  } catch {
    // Ignore if script injection is blocked in this tab.
  }
};

const $tab = (tab) => {
  const $ = document.createElement("div");
  $.className = "tab";
  $.dataset.tid = tab.id;

  const tabColor = Array.isArray(tab.color) ? tab.color.slice(0, 3) : [64, 125, 196];
  const accent = `rgb(${tabColor.join(",")})`;
  const isPaused = tab.media?.paused ?? true;
  const isMuted = tab.media?.muted ?? false;
  const volume = clampVolume(tab.media?.volume);
  const duration = clampDuration(tab.media?.duration);
  const currentTime = clampCurrentTime(tab.media?.currentTime, duration);
  const hasProgress = duration > 0;
  const hostname = tab.hostname || "Media";
  const titleParts = splitMediaTitle(tab.title, hostname);
  const thumbnailFallback = String(hostname).charAt(0).toUpperCase() || "?";

  $.innerHTML = `
  <div class="tab-thumbnail">
    ${tab.thumbnail ? `<img src="${tab.thumbnail}" alt="" />` : `<div class="tab-thumbnail-placeholder">${escapeHtml(thumbnailFallback)}</div>`}
  </div>
  <div class="tab-meta" style="--tab-accent: ${accent};">
    <div class="tab-meta-info-url">
      ${tab.favicon ? `<img src="${tab.favicon}" width="16" height="16" alt="" />` : `<span class="tab-favicon-placeholder"></span>`}
      <span>${escapeHtml(hostname)}</span>
    </div>
    <div class="tab-meta-info-title" title="${escapeHtml(titleParts.primary)}">
      <span>${escapeHtml(titleParts.primary)}</span>
    </div>
    <div class="tab-meta-info-subtitle" title="${escapeHtml(titleParts.secondary)}">
      <span>${escapeHtml(titleParts.secondary)}</span>
    </div>
    <button title="${isPaused ? "Play" : "Pause"}" class="control-playpause" aria-label="${isPaused ? "Play" : "Pause"}">
      ${isPaused ? Icons.play : Icons.pause}
    </button>
    <div class="tab-meta-volume">
      <input
        type="range"
        class="control-volume"
        min="0"
        max="1"
        step="0.01"
        value="${volume}"
        aria-label="Volume"
        orient="vertical"
      />
    </div>
    <div class="tab-meta-progress">
      <input
        type="range"
        class="control-progress"
        min="0"
        max="${hasProgress ? duration : 1}"
        step="0.1"
        value="${hasProgress ? currentTime : 0}"
        aria-label="Seek"
        ${hasProgress ? "" : "disabled"}
      />
    </div>
    <div class="tab-meta-controls">
      <button title="Previous track" class="control-previous" aria-label="Previous track">
        ${Icons.backward}
      </button>
      <button title="Back 10 seconds" class="control-seekback10" aria-label="Back 10 seconds">
        ${Icons.replay10}
      </button>
      <button title="${isMuted ? "Unmute" : "Mute"}" class="control-mute" aria-label="${isMuted ? "Unmute" : "Mute"}">
        ${isMuted ? Icons.muted : Icons.unmuted}
      </button>
      <button title="Forward 10 seconds" class="control-seekforward10" aria-label="Forward 10 seconds">
        ${Icons.forward10}
      </button>
      <button title="Next track" class="control-next" aria-label="Next track">
        ${Icons.forward}
      </button>
    </div>
  </div>
  `;

  const focusTab = () => {
    browser.tabs.update(tab.id, { active: true });
    browser.windows.update(tab.wid, { focused: true });
  };
  $.querySelector("div.tab-thumbnail").onclick = focusTab;
  $.querySelector("div.tab-meta-info-title").onclick = focusTab;
  $.querySelector("div.tab-meta-info-subtitle").onclick = focusTab;
  $.querySelector("button.control-playpause").onclick = () =>
    void runMediaAction(
      tab,
      `
        if ($media.paused) {
          $media.play();
        } else {
          $media.pause();
        }
      `
    );
  $.querySelector("button.control-previous").onclick = () => {
    void runMediaAction(
      tab,
      `
        const canUse = ($button) =>
          $button !== null &&
          $button !== undefined &&
          !$button.disabled &&
          $button.getAttribute("aria-disabled") !== "true";

        const clickPreviousButton = () => {
          const selectors = [
            "button.ytp-prev-button",
            ".ytp-prev-button",
            "ytmusic-player-bar tp-yt-paper-icon-button.previous-button",
            "ytmusic-player-bar .previous-button",
            "button[aria-label*='Previous']",
            "button[title*='Previous']",
            "button[aria-label*='Prev']",
            "a[aria-label*='Previous']",
            "a[rel='prev']",
            "[data-testid='previous-button']",
          ];

          for (const selector of selectors) {
            const $button = document.querySelector(selector);
            if (canUse($button)) {
              $button.click();
              return true;
            }
          }
          return false;
        };

        if (!clickPreviousButton()) {
          if ($media.currentTime > 5) {
            $media.currentTime = 0;
            return;
          }

          const eventInit = { bubbles: true, cancelable: true };
          document.dispatchEvent(new KeyboardEvent("keydown", { ...eventInit, key: "MediaTrackPrevious", code: "MediaTrackPrevious" }));
          document.dispatchEvent(new KeyboardEvent("keyup", { ...eventInit, key: "MediaTrackPrevious", code: "MediaTrackPrevious" }));
          document.dispatchEvent(new KeyboardEvent("keydown", { ...eventInit, key: "P", code: "KeyP", shiftKey: true }));
          document.dispatchEvent(new KeyboardEvent("keyup", { ...eventInit, key: "P", code: "KeyP", shiftKey: true }));
        }
      `
    );
  };
  $.querySelector("button.control-seekback10").onclick = () => {
    void runMediaAction(
      tab,
      `
        const nextTime = Math.max($media.currentTime - 10, 0);
        if (typeof $media.fastSeek === "function") {
          $media.fastSeek(nextTime);
        } else {
          $media.currentTime = nextTime;
        }
      `
    );
  };
  $.querySelector("button.control-seekforward10").onclick = () => {
    void runMediaAction(
      tab,
      `
        const nextTime = $media.currentTime + 10;
        if (typeof $media.fastSeek === "function") {
          $media.fastSeek(nextTime);
        } else {
          $media.currentTime = nextTime;
        }
      `
    );
  };
  $.querySelector("button.control-next").onclick = () => {
    void runMediaAction(
      tab,
      `
        const canUse = ($button) =>
          $button !== null &&
          $button !== undefined &&
          !$button.disabled &&
          $button.getAttribute("aria-disabled") !== "true";

        const clickNextButton = () => {
          const selectors = [
            "button.ytp-next-button",
            ".ytp-next-button",
            "ytmusic-player-bar tp-yt-paper-icon-button.next-button",
            "ytmusic-player-bar .next-button",
            "button[aria-label*='Next']",
            "button[title*='Next']",
            "button[aria-label*='Skip']",
            "a[aria-label*='Next']",
            "a[rel='next']",
            "[data-testid='next-button']",
          ];

          for (const selector of selectors) {
            const $button = document.querySelector(selector);
            if (canUse($button)) {
              $button.click();
              return true;
            }
          }
          return false;
        };

        if (!clickNextButton()) {
          const eventInit = { bubbles: true, cancelable: true };
          document.dispatchEvent(new KeyboardEvent("keydown", { ...eventInit, key: "MediaTrackNext", code: "MediaTrackNext" }));
          document.dispatchEvent(new KeyboardEvent("keyup", { ...eventInit, key: "MediaTrackNext", code: "MediaTrackNext" }));
          document.dispatchEvent(new KeyboardEvent("keydown", { ...eventInit, key: "N", code: "KeyN", shiftKey: true }));
          document.dispatchEvent(new KeyboardEvent("keyup", { ...eventInit, key: "N", code: "KeyN", shiftKey: true }));
        }
      `
    );
  };
  $.querySelector("button.control-mute").onclick = () => {
    void runMediaAction(
      tab,
      `
        $media.muted = !$media.muted;
      `
    );
  };
  $.querySelector("input.control-progress").oninput = (event) => {
    const max = clampDuration(event.target.max);
    const nextTime = clampCurrentTime(event.target.value, max);
    void runMediaAction(
      tab,
      `
        const duration = Number.isFinite($media.duration) && $media.duration > 0 ? $media.duration : ${max || 0};
        const current = Math.max(0, Math.min(${nextTime}, duration || ${nextTime}));
        if (typeof $media.fastSeek === "function") {
          $media.fastSeek(current);
        } else {
          $media.currentTime = current;
        }
      `
    );
  };
  $.querySelector("input.control-volume").oninput = (event) => {
    const volume = clampVolume(event.target.value);
    void runMediaAction(
      tab,
      `
        $media.volume = ${volume};
        if ($media.muted && ${volume} > 0) {
          $media.muted = false;
        }
      `
    );
  };
  return $;
};

window["add"] = async function (tab) {
  if ($main.querySelector(`div[data-tid="${tab.id}"]`) === null) {
    $main.prepend($tab(tab));
  }
};

window["del"] = async function (tid) {
  $main.querySelector(`div[data-tid="${tid}"]`)?.remove();
  if ($main.querySelectorAll("div.tab").length === 0) {
    window.close(); // close popup when the only tab is removed
  }
};

window["update"] = async function (tab) {
  $main.querySelector(`div[data-tid="${tab.id}"]`)?.replaceWith($tab(tab));
};

window["syncVolume"] = async function (tid, media) {
  const $tabItem = $main.querySelector(`div[data-tid="${tid}"]`);
  if ($tabItem === null) {
    return;
  }

  const muted = Boolean(media?.muted);
  const volume = clampVolume(media?.volume);
  const $mute = $tabItem.querySelector("button.control-mute");
  if ($mute !== null) {
    $mute.title = muted ? "Unmute" : "Mute";
    $mute.innerHTML = muted ? Icons.muted : Icons.unmuted;
  }

  const $volume = $tabItem.querySelector("input.control-volume");
  if ($volume !== null && document.activeElement !== $volume) {
    $volume.value = String(volume);
  }
};

window["syncProgress"] = async function (tid, media) {
  const $tabItem = $main.querySelector(`div[data-tid="${tid}"]`);
  if ($tabItem === null) {
    return;
  }

  const duration = clampDuration(media?.duration);
  const currentTime = clampCurrentTime(media?.currentTime, duration);
  const $progress = $tabItem.querySelector("input.control-progress");
  if ($progress === null) {
    return;
  }

  const hasProgress = duration > 0;
  $progress.disabled = !hasProgress;
  const nextMax = String(hasProgress ? duration : 1);
  if ($progress.max !== nextMax) {
    $progress.max = nextMax;
  }

  if (document.activeElement !== $progress) {
    $progress.value = String(hasProgress ? currentTime : 0);
  }
};

(async () => {
  background = await browser.runtime.getBackgroundPage();
  Array.from(background.__tabs__.values()).reverse().forEach(window["add"]);
})();
