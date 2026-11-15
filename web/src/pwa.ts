// PWA plumbing, ported from the Voice2QR approach:
// - the app version is stamped into version.json and the service worker
//   cache name at build time;
// - on load, version.json is probed (no-store); if it disagrees with the
//   running code, reload exactly once;
// - cache cleanup only ever touches `minimapprint-` caches, because
//   Cache Storage is shared per origin, not per service-worker scope.

declare const __APP_VERSION__: string;

export const APP_VERSION = __APP_VERSION__;

export async function initPwa(): Promise<void> {
  const versionEl = document.getElementById("version");
  if (versionEl) versionEl.textContent = APP_VERSION;

  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.register(
        `${import.meta.env.BASE_URL}sw.js`,
      );
    } catch {
      // PWA is a progressive enhancement; the app works without it.
    }
  }

  try {
    const res = await fetch(`${import.meta.env.BASE_URL}version.json`, {
      cache: "no-store",
    });
    if (!res.ok) return;
    const data = (await res.json()) as { version?: string };
    if (data.version && data.version !== APP_VERSION) {
      const KEY = "minimapprint-reloaded-for";
      if (sessionStorage.getItem(KEY) !== data.version) {
        sessionStorage.setItem(KEY, data.version);
        location.reload();
      }
    }
  } catch {
    // Offline or not deployed yet: nothing to check.
  }
}
