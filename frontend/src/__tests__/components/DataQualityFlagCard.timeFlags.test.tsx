import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import DataQualityFlagCard from "../../components/DataQuality/DataQualityFlagCard";
import type { DataQualityFlag } from "../../types/dataQuality";
import type {
  TimeFlagEntityType,
  TimeFlagKind,
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
  label = "Eintrag"
): DataQualityFlag {
  return {
    id: `flag-${kind}-${entityType}`,
    entityType,
    entityId: "row-1",
    status: "open",
    createdAt: "2026-09-27T08:00:00.000Z",
    resolvedAt: null,
    kind,
    subject: { entityType, entityId: "row-1", label, parentId },
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
