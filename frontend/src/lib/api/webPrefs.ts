import { api } from "./client";
import type { WebPrefsPutResult, WebPrefsState, WebPrefsTransport } from "../webPrefs/webPrefsSync";

/**
 * `/settings/web-prefs` (forgejo#200) — the web app's synced display
 * preferences. Bare-family router: the body is the resource itself. Not
 * `/app-settings`, which is the Companion's blob and replaced whole on PUT.
 */
export const webPrefsApi: WebPrefsTransport = {
  get: async () => (await api.get<WebPrefsState>("/settings/web-prefs")).data,
  put: async (sections) =>
    (await api.put<WebPrefsPutResult>("/settings/web-prefs", { sections })).data,
};
