import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import DataQualityFlagCard from "../../components/DataQuality/DataQualityFlagCard";
import { useSettingsStore } from "../../store/settingsStore";
import type { DataQualityFlag } from "../../types/dataQuality";
import type {
  TimeFlagEntityType,
  TimeFlagKind,
  TimeParentType,
  TimeQuestionDetails,
} from "../../types/timeMigration";

/**
 * The time questions the time-model migration raises (ADR 0002, plan Phase
 * 3b), as a German reader sees them in the inbox. The card's job is to send
 * the user to the ONE editor that can fill the gap — a flight's editor, a
 * cruise's stops, one trip stop or journal entry, a stay, a place (zone) or a
 * visit (time of day) — and to say so when there is nowhere to go, rather
 * than draw a dead link.
 */

vi.mock("../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

type Field = TimeQuestionDetails["fields"][number];

function timeFlag(
  kind: TimeFlagKind,
  entityType: TimeFlagEntityType,
  parentId: string | null,
  field: Partial<Field> = {},
  label = "Eintrag",
  link: { parentType?: TimeParentType | null; tripId?: string | null } = {}
): DataQualityFlag {
  return {
    id: `flag-${kind}-${entityType}`,
    entityType,
    entityId: "row-1",
    status: "open",
    createdAt: "2026-09-27T08:00:00.000Z",
    resolvedAt: null,
    kind,
    subject: {
      entityType,
      entityId: "row-1",
      label,
      parentId,
      parentType: link.parentType ?? null,
      tripId: link.tripId ?? null,
    },
    details: {
      table: "flights",
      fields: [
        {
          column: "departure",
          reason: "no_position",
          legacyValue: null,
          keptValue: null,
          zone: null,
          ...field,
        },
      ],
    },
  };
}

function renderCard(flag: DataQualityFlag) {
  return render(
    <MemoryRouter>
      <DataQualityFlagCard flag={flag} onResolve={() => {}} onDismiss={() => {}} />
    </MemoryRouter>
  );
}

const editorLink = (name: string) => screen.getByRole("link", { name });

describe("time questions in the inbox", () => {
  it("asks for the zone of a flight and opens the flight's editor", () => {
    renderCard(
      timeFlag(
        "time_zone_unresolved",
        "flight",
        null,
        { legacyValue: "2019-03-01T06:00:00.000Z" },
        "LH 2462 MUC → CPH"
      )
    );

    expect(screen.getByText("Zeitzone unbekannt")).toBeInTheDocument();
    expect(screen.getByText(/Für diese Zeit ließ sich keine Zeitzone finden/)).toBeInTheDocument();
    expect(screen.getByText("Abfahrt/Abflug")).toBeInTheDocument();
    expect(screen.getByText("Keine Position (fehlt oder 0, 0)")).toBeInTheDocument();
    // The stored digits, labelled as having no zone — not re-read in the viewer's.
    expect(screen.getByText("Gespeichert (ohne Zeitzone)")).toBeInTheDocument();
    expect(screen.getByText("01.03.2019 06:00")).toBeInTheDocument();
    expect(editorLink("Flug bearbeiten")).toHaveAttribute("href", "/flights/row-1?edit=1");
    // The subject's name reaches the same editor.
    expect(editorLink("LH 2462 MUC → CPH")).toHaveAttribute("href", "/flights/row-1?edit=1");
    // Not the two-sided wording of the other kinds: there is nothing to weigh.
    expect(screen.queryByText(/Keiner der beiden Werte/)).not.toBeInTheDocument();
    expect(screen.getByText(/Am Eintrag wurde nichts geändert/)).toBeInTheDocument();
  });

  it("sends a visit with no zone to the PLACE editor, and one with no time to the visit", () => {
    const { unmount } = renderCard(
      timeFlag("time_zone_unresolved", "place_visit", "p1", { column: "visited_at" })
    );
    expect(editorLink("Ort bearbeiten")).toHaveAttribute("href", "/places/p1?edit=1");
    unmount();

    renderCard(
      timeFlag("time_precision_unknown", "place_visit", "p1", {
        column: "visited_at",
        reason: "writer_unknown",
        keptValue: "2024-05-02",
      })
    );
    expect(screen.getByText("Uhrzeit unbekannt")).toBeInTheDocument();
    expect(editorLink("Besuch bearbeiten")).toHaveAttribute("href", "/places/p1?editVisit=row-1");
    // A kept day is the calendar day it is, whatever the viewer's zone (the
    // odd-zone CI runs this under UTC−3:30 and UTC+14).
    expect(screen.getByText("02.05.2024")).toBeInTheDocument();
  });

  it.each([
    ["trip_stop", "t1", "Halt bearbeiten", "/trips/t1?tab=timeline&editStop=row-1"],
    ["trip_journal_entry", "t1", "Eintrag bearbeiten", "/trips/t1?tab=timeline&editJournal=row-1"],
    ["cruise_stop", "c1", "Kreuzfahrt bearbeiten", "/cruises/c1?edit=1"],
    ["lodging_stay", "l1", "Aufenthalt bearbeiten", "/lodging/l1?editStay=row-1"],
    ["rail_journey", null, "Bahnfahrt bearbeiten", "/rail/row-1?edit=1"],
    ["trip", null, "Reise bearbeiten", "/trips/row-1?edit=1"],
    ["profile", null, "Profil bearbeiten", "/settings/account"],
  ] as const)("a %s opens its editor", (entityType, parentId, action, href) => {
    renderCard(timeFlag("time_zone_unresolved", entityType, parentId));
    expect(editorLink(action)).toHaveAttribute("href", href);
  });

  it("opens a tour's own point in the tour editor - inside its trip, or standalone", () => {
    const { unmount } = renderCard(
      timeFlag("time_zone_unresolved", "trip_stop", "tour-1", {}, "Aussichtspunkt", {
        parentType: "tour",
        tripId: "t1",
      })
    );
    expect(editorLink("Halt bearbeiten")).toHaveAttribute("href", "/trips/t1/route/tour-1");
    unmount();

    renderCard(
      timeFlag("time_zone_unresolved", "trip_stop", "tour-1", {}, "Aussichtspunkt", {
        parentType: "tour",
        tripId: null,
      })
    );
    expect(editorLink("Halt bearbeiten")).toHaveAttribute("href", "/tours/tour-1");
  });

  it("opens a stop and a journal entry on the trip the server names", () => {
    const { unmount } = renderCard(
      timeFlag("time_zone_unresolved", "trip_stop", "t1", {}, "Glencoe", {
        parentType: "trip",
        tripId: "t1",
      })
    );
    expect(editorLink("Halt bearbeiten")).toHaveAttribute(
      "href",
      "/trips/t1?tab=timeline&editStop=row-1"
    );
    unmount();
    renderCard(
      timeFlag("time_day_ambiguous", "trip_journal_entry", "t1", {}, "Tag 3", {
        parentType: "trip",
        tripId: "t1",
      })
    );
    expect(editorLink("Eintrag bearbeiten")).toHaveAttribute(
      "href",
      "/trips/t1?tab=timeline&editJournal=row-1"
    );
  });

  it("asks about an uncertain day, and shows the kept day in the place's zone", () => {
    renderCard(
      timeFlag("time_day_ambiguous", "lodging_stay", "l1", {
        column: "check_in",
        reason: "day_anchor_ambiguous",
        legacyValue: "2024-05-12T11:00:00.000Z",
        keptValue: "2024-05-12T22:00:00.000Z",
        zone: "Pacific/Auckland",
      })
    );
    expect(screen.getByText("Tag nicht eindeutig")).toBeInTheDocument();
    expect(
      screen.getByText("Nicht eindeutig, welcher Kalendertag gemeint ist")
    ).toBeInTheDocument();
    // 22:00 UTC is 10:00 the next morning in Auckland (NZST, +12).
    expect(screen.getByText("13.05.2024 10:00 (Pacific/Auckland)")).toBeInTheDocument();
  });

  it("says there is nowhere to edit a stop whose parent is unknown, instead of a dead link", () => {
    renderCard(timeFlag("time_zone_unresolved", "cruise_stop", null));

    expect(
      screen.getByText(/Der Eintrag, über den sich das bearbeiten ließe, ist nicht mehr auffindbar/)
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Kreuzfahrt bearbeiten" })).not.toBeInTheDocument();
  });

  it("names a reason this build does not know as unknown, and an unknown column plainly", () => {
    renderCard(
      timeFlag("time_zone_unresolved", "flight", null, {
        reason: "a_newer_reason" as Field["reason"],
        column: "some_new_column",
      })
    );
    expect(screen.getByText("unbekannt (a_newer_reason)")).toBeInTheDocument();
    expect(screen.getByText("Zeitangabe")).toBeInTheDocument();
    expect(screen.queryByText("some_new_column")).not.toBeInTheDocument();
  });
});

/**
 * Measured on a copy of the Beta server's data after 2.7.0-beta.16 ran its
 * backfill: the inbox showed a date-only flight's kept value with a clock
 * ("31.03.2009 22:00 (America/New_York)") under a sentence saying the stored
 * day was kept; and a visit whose time of day is unknown as "12.05.2024 00:00",
 * a clock nobody entered.
 *
 * forgejo#273: the kept DAY is the one the flight page shows — the local day of
 * the stored instant in the row's zone (`timesDto.ts`), because a date-only
 * flight is written as a local wall clock through that zone. The case is the
 * shared contract vector's (`shared/time/dateOnlyFlights.json`), the same one
 * the backend's DTO test reads back as 10 May.
 */
const VECTORS = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../shared/time/dateOnlyFlights.json"), "utf8")
) as { cases: Array<{ id: string; zone: string; day: string; stored: string }> };
const FRA_MIDNIGHT = VECTORS.cases.find((c) => c.id === "fra-cruise-import-midnight")!;

describe("the kept value of a time question reads as what the record shows", () => {
  it("shows a date-only flight's kept day as the flight page does — its local day, without a clock", () => {
    // Stored 22:00Z on 9 May; the flight page shows 10.05.2026.
    renderCard(
      timeFlag("time_day_ambiguous", "flight", null, {
        column: "departure",
        reason: "date_only_day_differs",
        legacyValue: FRA_MIDNIGHT.stored,
        keptValue: FRA_MIDNIGHT.stored,
        zone: FRA_MIDNIGHT.zone,
      })
    );
    expect(FRA_MIDNIGHT.day).toBe("2026-05-10");
    expect(screen.getByText("10.05.2026")).toBeInTheDocument();
    expect(screen.queryByText("09.05.2026")).not.toBeInTheDocument();
  });

  it("falls back to the stored date for a date-only flight with no zone", () => {
    renderCard(
      timeFlag("time_day_ambiguous", "flight", null, {
        column: "departure",
        reason: "date_only_day_differs",
        legacyValue: FRA_MIDNIGHT.stored,
        keptValue: FRA_MIDNIGHT.stored,
        zone: null,
      })
    );
    expect(screen.getAllByText(/09\.05\.2026/).length).toBeGreaterThan(0);
    expect(screen.queryByText("10.05.2026")).not.toBeInTheDocument();
  });

  it("shows a visit whose time of day is unknown as its day in the place's zone", () => {
    renderCard(
      timeFlag("time_precision_unknown", "place_visit", "p1", {
        column: "visited_at",
        reason: "writer_unknown",
        legacyValue: "2024-05-12T10:00:00.000Z",
        keptValue: "2024-05-11T22:00:00.000Z",
        zone: "Europe/Madrid",
      })
    );
    expect(screen.getByText("12.05.2024 (Europe/Madrid)")).toBeInTheDocument();
    expect(screen.queryByText(/00:00 \(Europe\/Madrid\)/)).not.toBeInTheDocument();
  });

  it("shows an unclassified flight time as its local day only", () => {
    renderCard(
      timeFlag("time_precision_unknown", "flight", null, {
        column: "arrival",
        reason: "semantics_unknown",
        legacyValue: "2026-04-16T20:30:00.000Z",
        keptValue: "2026-04-16T20:30:00.000Z",
        zone: "Europe/Madrid",
      })
    );
    expect(screen.getByText("16.04.2026 (Europe/Madrid)")).toBeInTheDocument();
    expect(screen.queryByText(/22:30/)).not.toBeInTheDocument();
  });
});

describe("a time question about a domain the reader switched off", () => {
  // The suite-wide store mock (__tests__/setup.ts) hands every selector one
  // shared state object; these cases set the reader's domains on it and take
  // them off again.
  const state = useSettingsStore.getState() as unknown as Record<string, unknown>;
  const setDomains = (enabledDomains: string[]) =>
    Object.assign(state, { enabledDomains, enabledDomainsLoaded: true });
  afterEach(() => {
    delete state.enabledDomains;
    delete state.enabledDomainsLoaded;
  });

  it("says the domain is off and where to switch it on, instead of a link to a closed page", () => {
    setDomains(["flight"]);
    renderCard(
      timeFlag("time_precision_unknown", "place_visit", "p1", {
        column: "visited_at",
        reason: "writer_unknown",
        keptValue: "2024-05-11T22:00:00.000Z",
        zone: "Europe/Madrid",
      })
    );
    expect(screen.queryByRole("link", { name: "Besuch bearbeiten" })).not.toBeInTheDocument();
    expect(screen.getByText(/Der Bereich „Orte“ ist ausgeschaltet/)).toBeInTheDocument();
    expect(editorLink("Bereiche einstellen")).toHaveAttribute("href", "/settings#modules");
  });

  it("keeps the editor link while the domain is on", () => {
    setDomains(["flight", "poi"]);
    renderCard(
      timeFlag("time_precision_unknown", "place_visit", "p1", {
        column: "visited_at",
        reason: "writer_unknown",
      })
    );
    expect(editorLink("Besuch bearbeiten")).toHaveAttribute("href", "/places/p1?editVisit=row-1");
  });
});
