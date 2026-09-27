import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import DataQualityFlagCard from "../../components/DataQuality/DataQualityFlagCard";
import type { DataQualityFlag, TimeValueFlagDetails } from "../../types/dataQuality";

/**
 * The two time flags the time-model migration raises (ADR 0002, plan Phase
 * 3b), as a German reader sees them in the inbox. The card's job is to send
 * the user to the ONE editor that can fill the gap — a flight's editor, a
 * cruise's stops, one trip stop, a place (zone) or a visit (time of day) — and
 * to say so when there is nowhere to go, rather than draw a dead link.
 */

vi.mock("../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

function timeFlag(
  kind: "time_zone_unresolved" | "time_precision_unknown",
  entityType: "flight" | "cruise_stop" | "trip_stop" | "place_visit",
  details: Partial<TimeValueFlagDetails> = {},
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
    subject: { entityType, entityId: "row-1", label },
    details: { field: "departure", reason: "no_zone", parentId: null, localDay: null, ...details },
  };
}

function renderCard(flag: DataQualityFlag) {
  return render(
    <MemoryRouter>
      <DataQualityFlagCard flag={flag} onResolve={() => {}} onDismiss={() => {}} />
    </MemoryRouter>
  );
}

describe("time flags in the inbox", () => {
  it("asks for the zone of a flight and opens the flight's editor", () => {
    renderCard(timeFlag("time_zone_unresolved", "flight", {}, "LH 2462"));

    expect(screen.getByText("Zeitzone unbekannt")).toBeInTheDocument();
    expect(screen.getByText(/Für diese Zeit ließ sich keine Zeitzone finden/)).toBeInTheDocument();
    expect(screen.getByText("Abflug")).toBeInTheDocument();
    expect(screen.getByText("Keine Zeitzone auffindbar")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Flug bearbeiten" })).toHaveAttribute(
      "href",
      "/flights/row-1?edit=1"
    );
    // The subject's name reaches the same editor.
    expect(screen.getByRole("link", { name: "LH 2462" })).toHaveAttribute(
      "href",
      "/flights/row-1?edit=1"
    );
    // Not the two-sided wording of the other kinds: there is nothing to weigh.
    expect(screen.queryByText(/Keiner der beiden Werte/)).not.toBeInTheDocument();
    expect(screen.getByText(/Am Eintrag wurde nichts geändert/)).toBeInTheDocument();
  });

  it("sends a place visit with no zone to the PLACE editor, and one with no time to the visit", () => {
    const { unmount } = renderCard(
      timeFlag("time_zone_unresolved", "place_visit", { parentId: "p1", field: "visitedAt" })
    );
    expect(screen.getByRole("link", { name: "Ort bearbeiten" })).toHaveAttribute(
      "href",
      "/places/p1?edit=1"
    );
    unmount();

    renderCard(
      timeFlag("time_precision_unknown", "place_visit", {
        parentId: "p1",
        field: "visitedAt",
        reason: "writer_unknown",
      })
    );
    expect(screen.getByText("Uhrzeit unbekannt")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Besuch bearbeiten" })).toHaveAttribute(
      "href",
      "/places/p1?editVisit=row-1"
    );
  });

  it("opens one trip stop on the timeline, and a cruise stop in the cruise editor", () => {
    const { unmount } = renderCard(
      timeFlag("time_zone_unresolved", "trip_stop", { parentId: "t1", field: "startDate" })
    );
    expect(screen.getByRole("link", { name: "Halt bearbeiten" })).toHaveAttribute(
      "href",
      "/trips/t1?tab=timeline&editStop=row-1"
    );
    unmount();

    renderCard(
      timeFlag("time_zone_unresolved", "cruise_stop", {
        parentId: "c1",
        field: "arrivalTime",
        reason: "sea_day",
      })
    );
    expect(screen.getByRole("link", { name: "Kreuzfahrt bearbeiten" })).toHaveAttribute(
      "href",
      "/cruises/c1?edit=1"
    );
    expect(screen.getByText("Seetag – kein Ort")).toBeInTheDocument();
  });

  it("says there is nowhere to edit a stop whose parent is unknown, instead of a dead link", () => {
    renderCard(timeFlag("time_zone_unresolved", "cruise_stop", { parentId: null }));

    expect(
      screen.getByText(/Der Eintrag, über den sich das bearbeiten ließe, ist nicht mehr auffindbar/)
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Kreuzfahrt bearbeiten" })).not.toBeInTheDocument();
  });

  it("shows the kept day as the calendar day it is, whatever the viewer's zone", () => {
    // Formatted from "YYYY-MM-DD" in UTC: a viewer west of UTC must not see
    // the day before (the odd-zone CI runs this under UTC−3:30 and UTC+14).
    renderCard(
      timeFlag("time_precision_unknown", "place_visit", {
        parentId: "p1",
        localDay: "2024-05-02",
        field: "visitedAt",
      })
    );
    expect(screen.getByText("02.05.2024")).toBeInTheDocument();
  });

  it("names a reason this build does not know as unknown, with its code", () => {
    renderCard(timeFlag("time_zone_unresolved", "flight", { reason: "a_newer_reason" }));
    expect(screen.getByText("unbekannt (a_newer_reason)")).toBeInTheDocument();
  });
});
