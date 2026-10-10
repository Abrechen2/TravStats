/*
 * TravStats boot guard — the one piece of the app that is NOT part of a build.
 *
 * Why it exists: a tab holding an index.html from a previous build (a cache,
 * an edge that kept it for hours) asks for `/assets/index-<oldhash>.js`. That
 * file is gone after an update, the module never runs, and the reader gets a
 * blank page — `src/lib/staleBundle.ts` cannot help, because it is INSIDE the
 * module that failed to load.
 *
 * So this file is deliberately outside the build: unhashed, same-origin
 * (`script-src 'self'` allows it, no inline script, CSP unchanged), served
 * `no-cache` by nginx-combined.conf, and loaded with a plain classic
 * `<script src>` BEFORE the module entry in index.html. It listens, in the
 * capture phase, for a script or stylesheet of this origin failing to load,
 * and answers exactly like staleBundle.ts: one automatic reload to a
 * cache-busted URL, at most once per RELOAD_WINDOW_MS (shared sessionStorage
 * marker, so the two cannot reload twice between them), and after that a
 * plain DE/EN sentence with a reload button instead of an empty page.
 *
 * Keep it ES5-ish and dependency-free: it must run in any browser that could
 * be holding an old page. The three constants below are mirrored in
 * src/lib/staleBundle.ts; a test fails when they drift.
 */
(function (win) {
  "use strict";

  var STALE_RELOAD_KEY = "ts.staleBundle.reloadedAt";
  var STALE_RELOAD_PARAM = "ts-reload";
  var RELOAD_WINDOW_MS = 5 * 60 * 1000;

  var COPY = {
    de: {
      title: "Eine neue Version ist da",
      message:
        "TravStats wurde aktualisiert. Dieser Browser hatte noch die alte Version geladen, deren Dateien es nicht mehr gibt. Ein Neuladen holt die aktuelle Version.",
      reload: "Neu laden",
    },
    en: {
      title: "A new version is available",
      message:
        "TravStats was updated. This browser still had the old version, whose files no longer exist. Reloading fetches the current version.",
      reload: "Reload",
    },
  };

  var handled = false;

  function language() {
    try {
      var stored = win.localStorage.getItem("settings-storage");
      if (stored) {
        var parsed = JSON.parse(stored);
        var lang = parsed && parsed.state && parsed.state.display && parsed.state.display.language;
        if (lang === "de" || lang === "en") return lang;
      }
    } catch (e) {
      // Unreadable storage: fall through to the browser's language.
    }
    var nav = (win.navigator && win.navigator.language) || "";
    return nav.toLowerCase().indexOf("de") === 0 ? "de" : "en";
  }

  function cacheBustedUrl(stamp) {
    var url = new win.URL(win.location.href);
    url.searchParams.set(STALE_RELOAD_PARAM, String(stamp));
    return url.toString();
  }

  /** True when it navigated; false when the guard held (or storage is missing). */
  function tryReload() {
    var storage;
    try {
      storage = win.sessionStorage;
      var now = Date.now();
      var last = Number(storage.getItem(STALE_RELOAD_KEY));
      if (isFinite(last) && last > 0 && now - last < RELOAD_WINDOW_MS) return false;
      storage.setItem(STALE_RELOAD_KEY, String(now));
      win.location.replace(cacheBustedUrl(now));
      return true;
    } catch (e) {
      // Without storage nothing could stop a loop: never reload automatically.
      return false;
    }
  }

  function showNotice() {
    var doc = win.document;
    var copy = COPY[language()];
    var host = doc.getElementById("root") || doc.body;
    if (!host) return;
    while (host.firstChild) host.removeChild(host.firstChild);

    var box = doc.createElement("div");
    box.setAttribute("role", "alert");
    box.setAttribute("data-boot-guard", "stale");
    box.style.cssText =
      "max-width:32rem;margin:15vh auto;padding:28px;border-radius:16px;" +
      "border:1px solid #2a3038;background:#14181e;color:#e8e6e1;" +
      "font:16px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif";

    var h = doc.createElement("h1");
    h.textContent = copy.title;
    h.style.cssText = "font-size:22px;margin:0 0 10px";
    var p = doc.createElement("p");
    p.textContent = copy.message;
    p.style.cssText = "margin:0 0 20px";
    var button = doc.createElement("button");
    button.type = "button";
    button.textContent = copy.reload;
    button.style.cssText =
      "width:100%;height:46px;border:0;border-radius:12px;background:#efa947;" +
      "color:#14181e;font-weight:700;font-size:16px;cursor:pointer";
    button.addEventListener("click", function () {
      var now = Date.now();
      try {
        win.sessionStorage.setItem(STALE_RELOAD_KEY, String(now));
      } catch (e) {
        // The reload still happens.
      }
      win.location.replace(cacheBustedUrl(now));
    });

    box.appendChild(h);
    box.appendChild(p);
    box.appendChild(button);
    host.appendChild(box);
  }

  /** A script, module preload or stylesheet of THIS origin that failed to load. */
  function isOwnBundleFailure(target) {
    if (!target || !target.tagName) return false;
    var tag = String(target.tagName).toUpperCase();
    var url = "";
    if (tag === "SCRIPT") url = target.src;
    else if (tag === "LINK") {
      var rel = String(target.rel || "").toLowerCase();
      if (rel !== "stylesheet" && rel !== "modulepreload") return false;
      url = target.href;
    } else return false;
    if (!url) return false;
    try {
      return new win.URL(url, win.location.href).origin === win.location.origin;
    } catch (e) {
      return false;
    }
  }

  /**
   * Once the app's entry module has run, a failing chunk is the app's own
   * business (staleBundle.ts and ErrorBoundary): this guard must not wipe a
   * root React is rendering into. main.tsx sets the marker first thing.
   */
  function booted() {
    var el = win.document && win.document.documentElement;
    return !!(el && el.getAttribute("data-ts-booted") === "1");
  }

  function onError(event) {
    if (handled || booted() || !isOwnBundleFailure(event && event.target)) return;
    handled = true;
    if (tryReload()) return;
    var doc = win.document;
    if (doc.readyState === "loading") {
      doc.addEventListener("DOMContentLoaded", showNotice);
    } else {
      showNotice();
    }
  }

  // Capture phase: a resource's load error does not bubble, but it does pass
  // through window on the way down.
  win.addEventListener("error", onError, true);
})(window);
