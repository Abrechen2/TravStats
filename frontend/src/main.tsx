import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
// MapLibre's stylesheet is what gives DOM overlays (<Marker>, Popup) their
// `position: absolute` anchoring. Without it a lone marker happens to sit
// roughly right (static flow at the container's top-left plus MapLibre's
// transform), which masked the missing import until a map rendered MANY
// markers and they stacked down the page as block elements.
import "maplibre-gl/dist/maplibre-gl.css";
// Must run before any map mounts — see the file for the silent failure it prevents.
import "./lib/maplibreWorker";
// Must run before React does: `beforeinstallprompt` fires once and early, and
// a listener registered when a component mounts never hears it.
import "./lib/installPrompt";
// Before React mounts: a reload that recovered from a stale build carries a
// cache-busting param, removed again here; and from now on a missing chunk
// reloads once instead of leaving the view broken. See lib/staleBundle.ts.
import { installStaleBundleRecovery, stripStaleReloadParam } from "./lib/staleBundle";
// MapLibre 6 removed `map.transform`, which @deck.gl/mapbox reads every frame.
// See the file for what it restores and when to delete it.
import { installMapLibreTransformBridge } from "./lib/maplibreTransformBridge";

// Import i18n config - this initializes i18n synchronously with initAsync: false
import "./i18n/config";
import { I18nextProvider } from "react-i18next";
import i18n from "./i18n/config";

// Runs before any map mounts: @deck.gl/mapbox reads `map.transform` on every
// frame and MapLibre 6 no longer has it.
installMapLibreTransformBridge();

// From here on a missing chunk is this bundle's to handle, not the static
// boot guard's (public/boot-guard.js), which must not touch a live root.
document.documentElement.setAttribute("data-ts-booted", "1");
stripStaleReloadParam();
installStaleBundleRecovery();

// TravStats is dark-only (BRAND.md §1.1). The `dark` class is hardcoded
// here before React mounts so any CSS scoped to `html.dark` applies on
// first paint without flash.
if (typeof document !== "undefined") {
  document.documentElement.classList.add("dark");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nextProvider i18n={i18n}>
      <App />
    </I18nextProvider>
  </React.StrictMode>
);
