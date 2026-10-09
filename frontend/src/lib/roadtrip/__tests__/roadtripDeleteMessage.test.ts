import { describe, expect, it } from "vitest";
import { createInstance } from "i18next";

import deRoadtrips from "../../../i18n/resources/de/roadtrips.json";
import enRoadtrips from "../../../i18n/resources/en/roadtrips.json";
import deCommon from "../../../i18n/resources/de/common.json";
import enCommon from "../../../i18n/resources/en/common.json";
import type { RoadtripDetail, RoadtripStation } from "../../../types/roadtrip";
import { roadtripDeleteMessage } from "../roadtripDeleteMessage";

const i18n = createInstance();
void i18n.init({
  lng: "de",
  fallbackLng: false,
  resources: {
    de: { roadtrips: deRoadtrips, common: deCommon },
    en: { roadtrips: enRoadtrips, common: enCommon },
  },
});

const station = (id: string, over: Partial<RoadtripStation> = {}): RoadtripStation => ({
  id,
  title: id,
  lat: 60,
  lon: 5,
  startDate: null,
  endDate: null,
  notes: null,
  order: 0,
  state: "free",
  lodgingStayId: null,
  stay: null,
  ...over,
});

const detail = (over: Partial<RoadtripDetail> = {}): RoadtripDetail => ({
  roadtrip: { id: "rt", name: "Fjorde" } as never,
  countries: [],
  trip: { id: "t", name: "Norwegen 2026" },
  startDate: null,
  endDate: null,
  nights: {} as never,
  stations: [
    station("Bergen", { photoCount: 2 }),
    station("bend", { state: "via" }),
    station("Lom", {
      state: "stay",
      stay: { lodgingName: "Camping Lom" } as never,
      photoCount: 1,
    }),
  ],
  legs: [{ id: "l1" }, { id: "l2" }] as never,
  tours: [{ id: "x", name: "Galdhøpiggen" } as never],
  routingAvailable: false,
  expenses: [{ id: "e1" }, { id: "e2" }] as never,
  costs: {} as never,
  ...over,
});

/** forgejo#250: what goes, how much of it, and what stays — by name. */
describe("roadtripDeleteMessage", () => {
  it("names what goes with its counts, where the costs go, and what stays", () => {
    const text = roadtripDeleteMessage(i18n.getFixedT("de"), detail());
    expect(text).toBe(
      [
        "„Fjorde“ wird gelöscht – mit 2 Stationen, 2 Etappen, allen Aufzeichnungen der Strecke. Das lässt sich nicht rückgängig machen.",
        "Die 2 erfassten Ausgaben gehen an die Reise „Norwegen 2026“.",
        "Erhalten bleiben: die Reise „Norwegen 2026“, die Unterkunft „Camping Lom“ mit ihren Aufenthalten, die Tagestour „Galdhøpiggen“ (ohne Station), 3 Fotos bei ihrer Reise",
      ].join("\n")
    );
  });

  it("says less, never something false, for a roadtrip with nothing on it", () => {
    const text = roadtripDeleteMessage(
      i18n.getFixedT("en"),
      detail({ trip: null, stations: [], legs: [], tours: [], expenses: [] })
    );
    expect(text).toBe("“Fjorde” will be deleted. This cannot be undone.");
  });
});
