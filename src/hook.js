// Page-script entry point: binds media element events to runtime messages.
(() => {
  // Removes all known listeners from a media element.
  const removeMediaListeners = ($media) => {
    if (!($media instanceof HTMLMediaElement)) {
      return;
    }
    for (const [type, listener] of Object.entries(window.listeners ?? {})) {
      $media.removeEventListener(type, listener);
    }
  };

  // Attaches all known listeners to a media element.
  const addMediaListeners = ($media) => {
    if (!($media instanceof HTMLMediaElement)) {
      return;
    }
    for (const [type, listener] of Object.entries(window.listeners ?? {})) {
      $media.addEventListener(type, listener);
    }
  };

  // Build reusable listeners once; each listener publishes a full media snapshot.
  if (window.listeners === undefined) {
    window.listeners = {};
    ["play", "pause", "volumechange", "timeupdate", "durationchange", "loadedmetadata", "seeking", "seeked"].forEach((type) => {
      if (!(type in window.listeners))
        // Event callback sends current media values so background has a full snapshot.
        window.listeners[type] = async () => {
          if (!(window.$media instanceof HTMLMediaElement)) {
            return;
          }
          const message = {
            type,
            paused: window.$media.paused,
            muted: window.$media.muted,
            volume: window.$media.volume,
            currentTime: window.$media.currentTime,
            duration: window.$media.duration,
          };
          await browser.runtime.sendMessage(message);
        };
    });
  }

  // Re-bind listeners whenever the active tagged media element changes.
  const $nextMedia = document.querySelector("[mcx-media]");
  if ($nextMedia instanceof HTMLMediaElement && window.$media !== $nextMedia) {
    removeMediaListeners(window.$media);
    window.$media = $nextMedia;
    addMediaListeners(window.$media);
  }

  if (window.__mcxUnhookListenerInstalled !== true) {
    window.__mcxUnhookListenerInstalled = true;

    // Background asks for cleanup when tab is unregistered.
    browser.runtime.onMessage.addListener((message) => {
      if (message === "@unhook") {
        removeMediaListeners(window.$media);
        for (const $media of document.querySelectorAll("[mcx-media]")) {
          $media.toggleAttribute("mcx-media", false);
        }
        window.$media = undefined;
      }
    });
  }
})();
