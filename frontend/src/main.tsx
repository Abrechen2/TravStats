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
// Import i18n config - this initializes i18n synchronously with initAsync: false
import "./i18n/config";
import { I18nextProvider } from "react-i18next";
import i18n from "./i18n/config";

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
