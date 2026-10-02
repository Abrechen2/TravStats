import { describe, it, expect } from "vitest";
import { createInstance } from "i18next";

import deRoadtrips from "../../../i18n/resources/de/roadtrips.json";
import enRoadtrips from "../../../i18n/resources/en/roadtrips.json";
import { SAVE_STATUSES } from "../useStationAutosave";

/**
 * forgejo#164 — while the autosave waited for its pause the editor's status
 * line read the raw key "editor.status.pending": the page renders
 * `roadtrips:editor.status.${status}` for every status the hook can report,
 * and `pending` was the one without copy. The list of statuses is read from
 * the hook itself, so a status added there without its sentence fails here.
 */
const instance = createInstance();
void instance.init({
  lng: "de",
  fallbackLng: false,
  resources: { de: { roadtrips: deRoadtrips }, en: { roadtrips: enRoadtrips } },
});

describe("every autosave status has copy (forgejo#164)", () => {
  it.each(SAVE_STATUSES.flatMap((status) => [["de", status] as const, ["en", status] as const]))(
    "%s: %s",
    (lng, status) => {
      const key = `roadtrips:editor.status.${status}`;
      expect(instance.exists(key, { lng })).toBe(true);
      expect(instance.getFixedT(lng)(key)).not.toContain("editor.status");
    }
  );
});
