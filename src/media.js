// Page-script entry point: tags media nodes and emits hook events for state sync.
(() => {
  // Marks exactly one media element as active for extension controls.
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

  // On first load, tag an already-playing media element so controls work immediately.
  if (document.querySelector("[mcx-media]") === null) {
    const $allMedia = Array.from(document.querySelectorAll("video, audio"));
    const $playing = $allMedia.find(($item) => !$item.paused && !$item.ended);
    if ($playing !== undefined) {
      setActiveMedia($playing);
      window.dispatchEvent(new Event("hook"));
    }
  }

  // Prevent patching media prototypes more than once per page.
  if (window.__mcxMediaPatched === true) {
    return;
  }

  window.__mcxMediaPatched = true;

  // Capture native playback starts even when sites bypass direct play() usage.
  document.addEventListener(
    "playing",
    (event) => {
      const $media = event.target;
      if (!($media instanceof HTMLMediaElement) || $media.ended) {
        return;
      }
      setActiveMedia($media);
      window.dispatchEvent(new Event("hook"));
    },
    true
  );

  // Intercept play/pause so newly active media is tagged and state is reported.
  ["play", "pause"].forEach((method) => {
    const originalMethod = HTMLMediaElement.prototype[method];
    // Wrapped method keeps original behavior but adds tagging + hook emission.
    HTMLMediaElement.prototype[method] = function () {
      const value = originalMethod.apply(this, arguments);

      if (this instanceof HTMLMediaElement && !this.ended) {
        if (!document.contains(this) && document.body !== null) {
          document.body.append(this);
        }
        setActiveMedia(this);
      }

      window.dispatchEvent(new Event("hook"));
      return value;
    };
  });
})();
