import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { api } from "../../../../lib/api/client";
import { useAuthStore } from "../../../../store/authStore";
import type { User } from "../../../../types";
import type { TimeMigrationReport as Report } from "../../../../types/timeMigrationDraft";
import TimeMigrationReport from "../TimeMigrationReport";

/**
 * The time-migration report (ADR 0002, plan Phase 3b), in the German an admin
 * reads. The report is what the owner signs off before a promotion, so the
 * failure paths matter as much as the happy one: a report that could not be
 * loaded, or that arrived in a shape this build cannot read, must SAY so — a
 * row of zeros there reads as "nothing left unresolved", the known bug class
 * ("Nullen über Fehlermeldung").
 */

vi.mock("../../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

const REPORT: Report = {
  status: "done",
  ranAt: "2026-09-27T08:15:00.000Z",
  counts: [
    {
      table: "flight",
      rule: "legacy_fake_utc",
      reason: null,
      outcome: "converted",
      count: 41,
    },
    { table: "flight", rule: "utc_kept", reason: null, outcome: "kept", count: 120 },
    {
      table: "place_visit",
      rule: "precision_unknown",
      reason: "writer_unknown",
      outcome: "unresolved",
      count: 4,
    },
    {
      table: "cruise_stop",
      rule: "a_rule_from_a_newer_server",
      reason: "sea_day",
      outcome: "unresolved",
      count: 1,
    },
  ],
  unresolved: [
    {
      table: "place_visit",
      entityId: "v1",
      parentId: "p1",
      field: "visitedAt",
      reason: "writer_unknown",
      flagId: "flag-1",
      flagKind: "time_precision_unknown",
      label: "Wartburg",
      ownerId: "admin-1",
      ownerUsername: "admin",
    },
    {
      table: "cruise_stop",
      entityId: "s9",
      parentId: "c3",
      field: "arrivalTime",
      reason: "sea_day",
      flagId: "flag-2",
      flagKind: "time_zone_unresolved",
      label: "Seetag",
      ownerId: "user-2",
      ownerUsername: "alex",
    },
  ],
  unresolvedTotal: 5,
};

function answer(data: unknown) {
  return vi.spyOn(api, "get").mockResolvedValue({ data } as never);
}

function renderReport() {
  return render(
    <MemoryRouter>
      <TimeMigrationReport />
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

  it("states what was converted, what was kept and what was left, in words", async () => {
    answer(REPORT);
    renderReport();

    expect(
      await screen.findByText("41 Werte wurden umgerechnet und in die neuen Spalten geschrieben.")
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "120 Werte waren schon richtig gespeichert; ergänzt wurden nur Zeitzone und Genauigkeit."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "5 Werte wurden nicht umgestellt – nichts wurde geraten. Jeder steht als Frage im Posteingang seines Besitzers."
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Die ursprünglichen Spalten wurden nicht verändert/)
    ).toBeInTheDocument();
  });

  it("names tables, rules and reasons in German, and an unknown rule as unknown", async () => {
    answer(REPORT);
    renderReport();

    const table = await screen.findByRole("table");
    expect(
      within(table).getByText("Ortszeit, die als UTC gespeichert war – umgerechnet")
    ).toBeInTheDocument();
    expect(within(table).getAllByText("Ortsbesuch").length).toBeGreaterThan(0);
    expect(
      within(table).getByText("Nicht feststellbar, wer den Wert geschrieben hat")
    ).toBeInTheDocument();
    // A code this build has no copy for stays visible and says what it is.
    expect(within(table).getByText("unbekannt (a_rule_from_a_newer_server)")).toBeInTheDocument();
  });

  it("links the admin's own unresolved row to its editor, and names the owner of anyone else's", async () => {
    answer(REPORT);
    renderReport();

    const fix = await screen.findByRole("link", { name: "Ergänzen" });
    expect(fix).toHaveAttribute("href", "/places/p1?editVisit=v1");
    expect(screen.getByText("im Posteingang von alex")).toBeInTheDocument();
    // Capped list: says how many are shown of how many exist.
    expect(screen.getByText("2 von 5 angezeigt.")).toBeInTheDocument();
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
    expect(screen.queryByText("Nicht umgestellt")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.queryByText(/status code/)).not.toBeInTheDocument();
  });

  it("refuses to render an answer of the wrong shape as a clean report", async () => {
    // A server whose report is shaped differently — here an older draft with
    // flat totals — must not become "0 converted, 0 unresolved".
    answer({ converted: 41, unresolved: 5 });
    renderReport();

    expect(await screen.findByText(/Die Antwort des Servers hat eine Form/)).toBeInTheDocument();
    expect(screen.queryByText("Umgerechnet")).not.toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("tells an admin without the endpoint that this server does not know the migration yet", async () => {
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

  it("says the migration has not run yet, instead of a table of nothing", async () => {
    answer({
      ...REPORT,
      status: "not_run",
      ranAt: null,
      counts: [],
      unresolved: [],
      unresolvedTotal: 0,
    });
    renderReport();

    expect(
      await screen.findByText(/Die Umstellung ist auf dieser Instanz noch nicht gelaufen/)
    ).toBeInTheDocument();
    expect(screen.queryByText("Umgerechnet")).not.toBeInTheDocument();
  });

  it("reads an enveloped answer the same as a bare one", async () => {
    answer({ success: true, data: REPORT });
    renderReport();
    expect(await screen.findByText("2 von 5 angezeigt.")).toBeInTheDocument();
  });
});
