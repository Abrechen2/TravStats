import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { api } from "../../../../lib/api/client";
import { useAuthStore } from "../../../../store/authStore";
import type { User } from "../../../../types";
import type { TimeMigrationReport as Report } from "../../../../types/timeMigration";
import TimeMigrationReport from "../TimeMigrationReport";

/**
 * The time-migration report (ADR 0002, plan Phase 3b), in the German an admin
 * reads. The report is what the owner signs off before a promotion, so the
 * failure paths matter as much as the happy one: a report that could not be
 * loaded, that has not run yet, or that arrived in a shape this build cannot
 * read must SAY so — a row of zeros there reads as "nothing left open", the
 * known bug class ("Nullen über Fehlermeldung").
 */

vi.mock("../../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

const EMPTY_TABLE = { converted: 0, open: 0, alreadyFilled: 0, rules: [], reasons: [] };

const REPORT: Report = {
  backfill: {
    state: "completed",
    completedAt: "2026-09-27T08:15:00.000Z",
    lastError: null,
    tzdata: "2025b",
  },
  tables: [
    {
      table: "flights",
      converted: 41,
      open: 1,
      alreadyFilled: 3,
      rules: [
        { rule: "flight.fake_utc", status: "resolved", count: 41 },
        { rule: "flight.fake_utc", status: "open", count: 1 },
      ],
      reasons: [{ reason: "no_position", count: 1 }],
    },
    {
      table: "place_visits",
      converted: 10,
      open: 4,
      alreadyFilled: 0,
      rules: [{ rule: "visit.writer_unknown", status: "open", count: 4 }],
      reasons: [{ reason: "writer_unknown", count: 4 }],
    },
    { table: "cruise_stops", ...EMPTY_TABLE },
  ],
  unchanged: [
    { domain: "country_days", why: "utc_by_decision" },
    { domain: "tours", why: "already_dates" },
  ],
  flags: {
    open: 5,
    resolved: 2,
    dismissed: 1,
    byKind: [{ kind: "time_precision_unknown", open: 4 }],
  },
  openRows: [
    {
      table: "place_visits",
      rowId: "v1",
      userId: "admin-1",
      column: "visited_at",
      rule: "visit.writer_unknown",
      reason: "writer_unknown",
      legacyValue: "2024-05-02T14:30:00.000Z",
      newValue: null,
      zone: "Europe/Berlin",
      entityType: "place_visit",
      parentType: "place",
      parentId: "p1",
      tripId: null,
      flagId: "flag-v1",
      kind: "time_precision_unknown",
    },
    {
      table: "flights",
      rowId: "f9",
      userId: "user-2",
      column: "departure",
      rule: "flight.fake_utc",
      reason: "no_position",
      legacyValue: "2019-03-01T06:00:00.000Z",
      newValue: null,
      zone: null,
      entityType: "flight",
      parentType: null,
      parentId: null,
      tripId: null,
      flagId: "flag-f9",
      kind: "time_zone_unresolved",
    },
    {
      table: "flights",
      rowId: "f10",
      userId: "gone-user",
      column: "arrival",
      rule: "flight.fake_utc",
      reason: "no_position",
      legacyValue: null,
      newValue: null,
      zone: null,
      entityType: "flight",
      parentType: null,
      parentId: null,
      tripId: null,
      flagId: null,
      kind: "time_zone_unresolved",
    },
  ],
  openRowsTruncated: true,
};

const USERS = [
  { id: "admin-1", username: "admin" },
  { id: "user-2", username: "alex" },
];

function answer(data: unknown) {
  return vi.spyOn(api, "get").mockResolvedValue({ data } as never);
}

function renderReport() {
  return render(
    <MemoryRouter>
      <TimeMigrationReport users={USERS} />
    </MemoryRouter>
  );
}

describe("time-migration report — what the admin reads", () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { id: "admin-1", username: "admin" } as User });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("states what was converted, what was already new, what is open — in words", async () => {
    answer(REPORT);
    renderReport();

    expect(
      await screen.findByText(
        "51 Einträge wurden umgerechnet; die neuen Werte stehen in eigenen Spalten."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "3 Einträge hatten die neuen Werte schon (neu angelegt oder aus der Demo) und blieben unverändert."
      )
    ).toBeInTheDocument();
    expect(screen.getByText(/^5 Einträge wurden nicht vollständig umgestellt/)).toBeInTheDocument();
    expect(
      screen.getByText(
        "Fragen im Posteingang: 5 offen · 2 als korrigiert gemeldet · 1 als richtig bestätigt"
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Die ursprünglichen Spalten wurden nicht verändert/)
    ).toBeInTheDocument();
    // What the backfill deliberately never touches is said, not left out.
    expect(
      screen.getByText(/Ländertage \(bewusst UTC-Tage\) · Touren \(schon reine Tagesdaten\)/)
    ).toBeInTheDocument();
    expect(screen.getByText(/Zeitzonendaten 2025b/)).toBeInTheDocument();
  });

  it("counts per table, per reason, and lists the rules by their code", async () => {
    answer(REPORT);
    renderReport();

    const byTable = await screen.findByRole("table", { name: "Nach Tabelle" });
    expect(within(byTable).getByText("Flüge")).toBeInTheDocument();
    // A measured zero is listed, not dropped: a missing table reads as "not looked at".
    expect(within(byTable).getByText("Kreuzfahrt-Halte")).toBeInTheDocument();

    const byReason = screen.getByRole("table", { name: "Offen nach Grund" });
    expect(
      within(byReason).getByText("Nicht feststellbar, ob Web oder App die Zeit geschrieben hat")
    ).toBeInTheDocument();
    expect(within(byReason).getByText("Keine Position (fehlt oder 0, 0)")).toBeInTheDocument();
    expect(screen.getAllByText("flight.fake_utc").length).toBe(2);
  });

  it("opens the admin's own row in its editor, and names the owner of anyone else's row", async () => {
    answer(REPORT);
    renderReport();

    // Straight to the visit's editor on its place - not just to the inbox.
    expect(await screen.findByRole("link", { name: "Im Editor öffnen" })).toHaveAttribute(
      "href",
      "/places/p1?editVisit=v1"
    );
    // The row raised a question, so the inbox is offered too.
    expect(screen.getByRole("link", { name: "Im Posteingang beantworten" })).toHaveAttribute(
      "href",
      "/pending-updates"
    );
    // Another account's records are not the admin's to open.
    expect(screen.getAllByRole("link", { name: "Im Editor öffnen" })).toHaveLength(1);
    expect(screen.getByText("im Posteingang von alex")).toBeInTheDocument();
    expect(screen.getByText("Konto nicht zuzuordnen")).toBeInTheDocument();
    expect(
      screen.getByText("Nicht alle offenen Angaben sind aufgelistet – die Zahlen oben zählen alle.")
    ).toBeInTheDocument();
  });

  it("sends a visit with no zone to its place, and a tour's own point to the tour editor", async () => {
    const own = { userId: "admin-1", legacyValue: null, newValue: null, zone: null, flagId: null };
    answer({
      ...REPORT,
      openRows: [
        {
          ...own,
          table: "place_visits",
          rowId: "v2",
          column: "visited_at",
          rule: "visit.no_zone",
          reason: "no_position",
          entityType: "place_visit",
          parentType: "place",
          parentId: "p2",
          tripId: null,
          kind: "time_zone_unresolved",
        },
        {
          ...own,
          table: "trip_stops",
          rowId: "s1",
          column: "start_date",
          rule: "trip_stop.no_zone",
          reason: "no_position",
          entityType: "trip_stop",
          parentType: "tour",
          parentId: "tour-1",
          tripId: "t1",
          kind: "time_zone_unresolved",
        },
      ],
      openRowsTruncated: false,
    });
    renderReport();

    const links = await screen.findAllByRole("link", { name: "Im Editor öffnen" });
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/places/p2?edit=1",
      "/trips/t1/route/tour-1",
    ]);
    // No question was raised for these rows: no inbox link to a question that is not there.
    expect(screen.queryByRole("link", { name: "Im Posteingang beantworten" })).toBeNull();
  });

  it("reads a reason code this build does not know as 'other' instead of failing the report", async () => {
    answer({
      ...REPORT,
      tables: [
        {
          ...REPORT.tables[0],
          reasons: [{ reason: "a_reason_from_a_newer_server", count: 1 }],
        },
      ],
      openRows: [
        { ...REPORT.openRows[1], reason: "a_reason_from_a_newer_server" },
        // The server sends null for a ledger reason it does not know itself.
        { ...REPORT.openRows[2], reason: null, kind: null },
      ],
    });
    renderReport();

    // The report is there - the numbers are not thrown away for one word.
    expect(await screen.findByText(/Einträge wurden umgerechnet/)).toBeInTheDocument();
    const byReason = screen.getByRole("table", { name: "Offen nach Grund" });
    expect(
      within(byReason).getByText("ein Grund, den diese Version noch nicht kennt")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Abfahrt\/Abflug · ein Grund, den diese Version noch nicht kennt/)
    ).toBeInTheDocument();
    expect(screen.getByText(/· ohne Grund/)).toBeInTheDocument();
    expect(screen.queryByText(/Die Antwort des Servers hat eine Form/)).toBeNull();
  });

  it("says the report could not be loaded — and shows no zeros", async () => {
    vi.spyOn(api, "get").mockRejectedValue({
      isAxiosError: true,
      message: "Request failed with status code 500",
      response: { status: 500, data: { error: "Internal Server Error" } },
    });
    renderReport();

    expect(await screen.findByText("Der Bericht konnte nicht geladen werden.")).toBeInTheDocument();
    expect(screen.getByText(/Das heißt nicht, dass nichts umgestellt wurde/)).toBeInTheDocument();
    expect(screen.queryByText("Offen")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.queryByText(/status code/)).not.toBeInTheDocument();
  });

  it("refuses to render an answer of the wrong shape as a clean report", async () => {
    // An older draft of the shape, with flat totals, must not become "0 open".
    answer({ status: "done", counts: [], unresolved: [], unresolvedTotal: 0 });
    renderReport();

    expect(await screen.findByText(/Die Antwort des Servers hat eine Form/)).toBeInTheDocument();
    expect(screen.queryByText("Umgerechnet")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("tells an admin on a server without the endpoint that it does not know the migration yet", async () => {
    vi.spyOn(api, "get").mockRejectedValue({
      isAxiosError: true,
      response: { status: 404, data: { error: "Not Found" } },
    });
    renderReport();

    expect(
      await screen.findByText(
        "Dieser Server kennt die Umstellung auf das neue Zeitmodell noch nicht."
      )
    ).toBeInTheDocument();
  });

  it("says the migration has not run yet, instead of a table of zeros", async () => {
    answer({
      ...REPORT,
      backfill: { state: "pending", completedAt: null, lastError: null, tzdata: null },
      tables: [{ table: "flights", ...EMPTY_TABLE }],
      openRows: [],
      openRowsTruncated: false,
    });
    renderReport();

    expect(
      await screen.findByText(/Die Umstellung ist auf dieser Instanz noch nicht gelaufen/)
    ).toBeInTheDocument();
    expect(screen.queryByText("Umgerechnet")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("says why a failed run stopped, in words", async () => {
    answer({
      ...REPORT,
      backfill: {
        state: "failed",
        completedAt: null,
        lastError: "TIMEZONE_LOOKUP_UNAVAILABLE",
        tzdata: "2025b",
      },
    });
    renderReport();

    expect(
      await screen.findByText(
        /Die Umstellung ist abgebrochen: Die Zeitzonen-Suche war nicht verfügbar\./
      )
    ).toBeInTheDocument();
  });

  it("shows a failure code this build does not know as unknown, with the code", async () => {
    answer({
      ...REPORT,
      backfill: { state: "failed", completedAt: null, lastError: "DISK_FULL", tzdata: null },
    });
    renderReport();

    expect(await screen.findByText(/abgebrochen: unbekannt \(DISK_FULL\)/)).toBeInTheDocument();
  });
});
