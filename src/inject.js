// Content-script entry point: connects page hook events to background state updates.
(() => {
  // Scores media candidates so the popup controls the most likely primary player.
  const mediaScore = ($media) => {
    if (!($media instanceof HTMLMediaElement) || $media.ended) {
      return -1;
    }

    const rect = $media.getBoundingClientRect();
    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
    const playingBoost = $media.paused ? 0 : 1_000_000;
    const audibleBoost = $media.muted || $media.volume === 0 ? 0 : 100_000;
    return playingBoost + audibleBoost + area;
  };

  // Ensures there is only one active tagged media element at a time.
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

  // Resolve the media element we should track for this page.
  const resolveMedia = () => {
    let $media = document.querySelector("[mcx-media]");
    const $allMedia = Array.from(document.querySelectorAll("video, audio"));
    if ($media === null || !document.contains($media) || $media.ended) {
      $media = $allMedia.sort(($a, $b) => mediaScore($b) - mediaScore($a))[0] ?? null;
    }

    if ($media !== null) {
      setActiveMedia($media);
    }

    return $media;
  };

  // Push the current media state to background whenever a hook event fires.
  const sendHookState = async () => {
    const $media = resolveMedia();
    if ($media === null) {
      return;
    }
    await browser.runtime.sendMessage({
      type: "@hook",
      media: {
        paused: $media.paused,
        muted: $media.muted,
        volume: $media.volume,
        currentTime: $media.currentTime,
        duration: $media.duration,
      },
    });
  };

  // Re-inject the page script on each registration, but avoid duplicate nodes/listeners.
  let $script = document.querySelector("script#mcx-inject");
  if ($script === null) {
    window.addEventListener("hook", sendHookState);
  } else {
    $script.remove();
    $script = undefined;
  }
  $script = document.createElement("script");
  $script.id = "mcx-inject";
  $script.src = browser.runtime.getURL("media.js");
  document.head.appendChild($script);

  // Push immediate state for already-tagged media so popup can initialize controls correctly.
  void sendHookState();
})();
