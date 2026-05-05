import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
// Import i18n config - this initializes i18n synchronously with initImmediate: false
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
