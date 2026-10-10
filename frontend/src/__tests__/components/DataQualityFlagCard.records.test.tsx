import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import DataQualityFlagCard from "../../components/DataQuality/DataQualityFlagCard";
import type { DataQualityFlag } from "../../types/dataQuality";

/**
 * The record checks (forgejo#282) as a German reader sees them: the question,
 * the records it names (each a link to where it is answered), the safe way to
 * answer — and never the "this version does not know this question" fallback.
 */

vi.mock("../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

const base = {
  id: "flag-1",
  status: "open" as const,
  createdAt: "2026-10-10T08:00:00.000Z",
  resolvedAt: null,
};

const flightSubject = (id: string, label: string) => ({
  entityType: "flight" as const,
  entityId: id,
  label,
  parentId: null,
  parentType: null,
  tripId: null,
});

function renderCard(flag: DataQualityFlag) {
  render(
    <MemoryRouter>
      <DataQualityFlagCard flag={flag} onResolve={() => {}} onDismiss={() => {}} />
    </MemoryRouter>
  );
  expect(screen.queryByText(/kennt diese Version/)).toBeNull();
  expect(
    screen.getByText("Am Eintrag wurde nichts geändert, und er zählt unverändert weiter.")
  ).toBeInTheDocument();
}

describe("DataQualityFlagCard — record checks", () => {
  it("asks about a duplicate and links the other copy, without offering to delete it", () => {
    renderCard({
      ...base,
      entityType: "flight",
      entityId: "mail",
      kind: "duplicate_candidate",
      subject: flightSubject("mail", "LH400 FRA → JFK"),
      details: {
        matchedOn: ["departureDay", "flightNumber", "route"],
        dataSource: "email_import",
        copies: [
          {
            entityType: "flight",
            entityId: "typed",
            label: "LH400 FRA → JFK",
            parentId: null,
            dataSource: "manual",
            createdAt: "2026-03-01T00:00:00.000Z",
          },
        ],
      },
    });
    expect(screen.getByText(/gleich sind: Reisetag, Flugnummer, Strecke/)).toBeInTheDocument();
    expect(screen.getByText("Dieser Eintrag: aus einer Mail")).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: "LH400 FRA → JFK" });
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/flights/mail", "/flights/typed"]);
    expect(screen.queryByRole("button", { name: /löschen/i })).toBeNull();
  });

  it("asks about two lodgings on one night and links the other stay through its lodging", () => {
    renderCard({
      ...base,
      entityType: "lodging_stay",
      entityId: "s2",
      kind: "chronology_conflict",
      subject: {
        entityType: "lodging_stay",
        entityId: "s2",
        label: "Hotel Napoli",
        parentId: "naples",
        parentType: "lodging",
        tripId: null,
      },
      details: {
        domain: "lodging_stay",
        conflictWith: {
          entityType: "lodging_stay",
          entityId: "s1",
          label: "Albergo Roma",
          parentId: "rome",
        },
        thisStart: "2026-06-12",
        thisEnd: "2026-06-14",
        otherStart: "2026-06-10",
        otherEnd: "2026-06-13",
        overlapMinutes: null,
        overlapNights: 1,
      },
    });
    expect(screen.getByText(/teilt sich 1 Nacht mit einem Aufenthalt/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Albergo Roma" })).toHaveAttribute(
      "href",
      "/lodging/rome?editStay=s1"
    );
    expect(screen.getByRole("link", { name: "Hotel Napoli" })).toHaveAttribute(
      "href",
      "/lodging/naples?editStay=s2"
    );
  });

  it("asks for a missing flight number and opens the flight's editor", () => {
    renderCard({
      ...base,
      entityType: "flight",
      entityId: "f1",
      kind: "flight_number_missing",
      subject: flightSubject("f1", "FRA → XQZ"),
      details: { airline: "Condor", status: "flown" },
    });
    expect(
      screen.getByText(
        "Für diesen Flug mit Condor ist keine Flugnummer gespeichert. Kennst du sie?"
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "FRA → XQZ" })).toHaveAttribute(
      "href",
      "/flights/f1?edit=1"
    );
  });

  it("names the unknown airport end", () => {
    renderCard({
      ...base,
      entityType: "flight",
      entityId: "f1",
      kind: "airport_unknown",
      subject: flightSubject("f1", "FRA → XQZ"),
      details: { endpoints: [{ side: "arrival", iata: "XQZ", icao: null, name: "Nowhere" }] },
    });
    expect(screen.getByText("Ankunft")).toBeInTheDocument();
    expect(screen.getByText("XQZ")).toBeInTheDocument();
  });

  it("asks for a trip's end, with the last entry's day as a hint", () => {
    renderCard({
      ...base,
      entityType: "trip",
      entityId: "t1",
      kind: "trip_end_missing",
      subject: {
        entityType: "trip",
        entityId: "t1",
        label: "Rundreise",
        parentId: null,
        parentType: null,
        tripId: "t1",
      },
      details: { startDay: "2026-01-05", lastEntryDay: "2026-01-20" },
    });
    expect(screen.getByText(/beginnt am .*, hat aber kein Ende/)).toBeInTheDocument();
    expect(screen.getByText(/Der letzte verknüpfte Eintrag endet am/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Rundreise" })).toHaveAttribute(
      "href",
      "/trips/t1?edit=1"
    );
  });

  it("lists entries outside the trip, each a link", () => {
    renderCard({
      ...base,
      entityType: "trip",
      entityId: "t1",
      kind: "trip_entries_outside",
      subject: {
        entityType: "trip",
        entityId: "t1",
        label: "Rundreise",
        parentId: null,
        parentType: null,
        tripId: "t1",
      },
      details: {
        startDay: "2026-03-09",
        endDay: "2026-03-15",
        entries: [
          {
            entityType: "bus_journey",
            entityId: "b1",
            label: "ZOB Berlin → Hamburg ZOB",
            parentId: null,
            firstDay: "2026-03-01",
            lastDay: "2026-03-01",
          },
        ],
      },
    });
    expect(screen.getByRole("link", { name: "ZOB Berlin → Hamburg ZOB" })).toHaveAttribute(
      "href",
      "/bus/b1"
    );
    expect(screen.getByRole("link", { name: "Rundreise" })).toHaveAttribute("href", "/trips/t1");
  });
});
