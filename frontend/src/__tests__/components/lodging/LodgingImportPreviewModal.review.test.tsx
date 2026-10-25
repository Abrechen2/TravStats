import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LodgingImportPreviewModal } from "../../../components/lodging/LodgingImportPreviewModal";
import type { LodgingImportPreviewRow } from "../../../types/lodgingImport";
import { LODGING_IMPORT_LIMITS } from "../../../shared/lodgingImportLimits";

/**
 * The five findings of the Codex review of the preview-clarity branch
 * (2026-10-25), each from the reader's side: what the dialog lets through
 * must be what the commit accepts, and what it says must be what will happen.
 * Real German and English copy, as in the `.copy` suite.
 */
const locale = vi.hoisted(() => ({ current: "de" as "de" | "en" }));
vi.mock("../../../hooks/useTranslation", async () => {
  const { localeUseTranslationNs } = await import("../../helpers/localeT");
  return {
    useTranslation: (ns?: string | string[]) => localeUseTranslationNs(locale.current, ns),
  };
});

const HOUSE_ID = "8b4c1f8e-2f0d-4a59-9a3e-6d2f7c1b0a11";
const STAY_ID = "1d9a6f0c-1111-4b2a-8c3d-222222222222";

const fresh = (sourceRowIndex: number, name: string): LodgingImportPreviewRow => ({
  sourceRowIndex,
  lodging: { name, city: "Basel", lat: 47.5, lon: 7.6 },
  stay: { checkIn: "2026-11-02", checkOut: "2026-11-04" },
  flags: [],
  dedupeHint: "none",
  matchedLodgingId: null,
  matchedLodgingName: null,
  matchedStayId: null,
  action: "create",
});

/** A stay for a stored house, guessed by name and city. */
const matched: LodgingImportPreviewRow = {
  sourceRowIndex: 0,
  lodging: { name: "Mercure Zürich City", city: "Zürich" },
  stay: { checkIn: "2026-11-02", checkOut: "2026-11-04" },
  flags: [],
  dedupeHint: "lodging_name_city",
  lodgingDedupeHint: "lodging_name_city",
  lodgingOptions: [],
  matchedLodgingId: HOUSE_ID,
  matchedLodgingName: "Mercure Zürich City",
  matchedLodgingCity: "Zürich",
  matchIsGuess: true,
  matchedStayId: null,
  matchedStay: null,
  action: "needs_input",
};

function renderRows(
  rows: LodgingImportPreviewRow[],
  onCommit = vi.fn().mockResolvedValue(undefined)
): ReturnType<typeof vi.fn> {
  render(
    <LodgingImportPreviewModal
      rows={rows}
      summary={{ newRows: 0, alreadyPresent: 0, needsInput: 1, changedRows: 0 }}
      onCommit={onCommit}
      onCancel={vi.fn()}
    />
  );
  return onCommit;
}

const choose = (index: number, value: string): void => {
  fireEvent.change(screen.getByTestId(`lodging-import-action-${index}`), { target: { value } });
};
const type = (testId: string, value: string): void => {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
};
const commitButton = (): HTMLElement => screen.getByTestId("lodging-import-commit");
const optionLabels = (index: number): string[] =>
  within(screen.getByTestId(`lodging-import-action-${index}`))
    .getAllByRole("option")
    .map((o) => o.textContent ?? "");

beforeEach(() => {
  locale.current = "de";
});

describe("1 — a skipped row sends nothing it will not use", () => {
  it("drops the edited fields of a skipped row, however invalid they were left", async () => {
    const onCommit = renderRows([fresh(0, "Inn"), fresh(1, "Other Inn")]);
    // Row 0 is broken beyond what the commit schema accepts, then skipped.
    type("lodging-import-name-0", "");
    type("lodging-import-checkin-0", "");
    choose(0, "skip");
    expect(commitButton()).toBeEnabled();

    fireEvent.click(commitButton());
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    const skipped = onCommit.mock.calls[0][0].find(
      (r: { sourceRowIndex: number }) => r.sourceRowIndex === 0
    );
    expect(skipped).toEqual({
      sourceRowIndex: 0,
      action: "skip",
      matchedLodgingId: null,
      matchedStayId: null,
      lodging: null,
      lodgingName: null,
      stay: null,
    });
  });
});

describe("2 — the dialog holds what the commit schema refuses", () => {
  const L = LODGING_IMPORT_LIMITS;

  it("a name longer than the commit allows, counted after trimming", () => {
    renderRows([fresh(0, "Inn")]);
    type("lodging-import-name-0", `  ${"x".repeat(L.nameMaxLength)}  `);
    expect(commitButton()).toBeEnabled();

    type("lodging-import-name-0", "x".repeat(L.nameMaxLength + 1));
    expect(screen.getByTestId("lodging-import-blocker-name_too_long-0")).toHaveTextContent(
      `Name zu lang (höchstens ${L.nameMaxLength} Zeichen).`
    );
    expect(commitButton()).toBeDisabled();
  });

  it("a city longer than the commit allows", () => {
    renderRows([fresh(0, "Inn")]);
    type("lodging-import-city-0", "x".repeat(L.cityMaxLength + 1));
    expect(screen.getByTestId("lodging-import-blocker-city_too_long-0")).toHaveTextContent(
      `Ort zu lang (höchstens ${L.cityMaxLength} Zeichen).`
    );
    expect(commitButton()).toBeDisabled();
  });

  it("a negative price", () => {
    renderRows([
      {
        ...fresh(0, "Inn"),
        stay: { checkIn: "2026-11-02", checkOut: "2026-11-04", currency: "EUR" },
      },
    ]);
    type("lodging-import-price-0", "-5");
    expect(screen.getByTestId("lodging-import-blocker-negative_price-0")).toHaveTextContent(
      "Preis darf nicht negativ sein."
    );
    expect(commitButton()).toBeDisabled();
    type("lodging-import-price-0", "0");
    expect(commitButton()).toBeEnabled();
  });

  it("a stay longer than the commit allows, and exactly the limit passes", () => {
    renderRows([fresh(0, "Inn")]);
    type("lodging-import-checkin-0", "2026-01-01");
    // 2026-01-01 + 3650 nights = 2035-12-30.
    type("lodging-import-checkout-0", "2035-12-30");
    expect(commitButton()).toBeEnabled();
    type("lodging-import-checkout-0", "2035-12-31");
    expect(screen.getByTestId("lodging-import-blocker-stay_too_long-0")).toHaveTextContent(
      `Aufenthalt zu lang (höchstens ${L.maxStayNights} Nächte).`
    );
    expect(commitButton()).toBeDisabled();
  });

  it("says the same in English", () => {
    locale.current = "en";
    renderRows([fresh(0, "Inn")]);
    type("lodging-import-name-0", "x".repeat(L.nameMaxLength + 1));
    expect(screen.getByTestId("lodging-import-blocker-name_too_long-0")).toHaveTextContent(
      `Name too long (at most ${L.nameMaxLength} characters).`
    );
    type("lodging-import-name-0", "Inn");
    type("lodging-import-city-0", "x".repeat(L.cityMaxLength + 1));
    expect(screen.getByTestId("lodging-import-blocker-city_too_long-0")).toHaveTextContent(
      `City too long (at most ${L.cityMaxLength} characters).`
    );
  });

  it("a skipped row holds nothing back", () => {
    renderRows([fresh(0, "Inn")]);
    type("lodging-import-name-0", "x".repeat(L.nameMaxLength + 1));
    choose(0, "skip");
    expect(commitButton()).toBeEnabled();
  });
});

describe("3 — choosing one of several houses checks that house's stays", () => {
  const BERN = "0b9e3a52-1a1a-4c4c-9d9d-000000000001";
  const CHUR = "0b9e3a52-1a1a-4c4c-9d9d-000000000002";
  const ambiguous: LodgingImportPreviewRow = {
    ...fresh(0, "Hotel Post"),
    lodging: { name: "Hotel Post" },
    stay: { checkIn: "2026-07-10", checkOut: "2026-07-13" },
    flags: ["ambiguous_lodging_name", "missing_coordinates"],
    dedupeHint: "lodging_name_only",
    lodgingDedupeHint: "lodging_name_only",
    lodgingOptions: [
      {
        id: BERN,
        name: "Hotel Post",
        city: "Bern",
        stays: [
          {
            id: STAY_ID,
            checkIn: "2026-07-10",
            checkOut: "2026-07-12",
            datePrecision: "DAY",
            nights: 2,
            href: `/lodging/${BERN}`,
          },
        ],
      },
      { id: CHUR, name: "Hotel Post", city: "Chur", stays: [] },
    ],
    action: "needs_input",
  };
  const pick = (id: string): void => {
    fireEvent.change(screen.getByTestId("lodging-import-choose-lodging-0"), {
      target: { value: id },
    });
  };

  it("names the stay already on file under the chosen house", () => {
    renderRows([ambiguous]);
    pick(BERN);
    expect(screen.getByTestId("lodging-import-stay-hint-0")).toHaveTextContent(
      "Möglicher vorhandener Aufenthalt mit gleicher Anreise."
    );
    expect(screen.getByTestId("lodging-import-matched-stay-0")).toHaveTextContent(
      "10.07.2026 – 12.07.2026"
    );
    expect(optionLabels(0)).toContain("Weiteren Aufenthalt anlegen");
    expect(optionLabels(0)).not.toContain("Aufenthalt hinzufügen");
  });

  it("takes back a 'create' given before the house was known, so the reader decides", () => {
    renderRows([ambiguous]);
    fireEvent.click(screen.getByTestId("lodging-import-create-all-undecided"));
    expect(screen.getByTestId("lodging-import-action-0")).toHaveValue("create");
    pick(BERN);
    expect(screen.getByTestId("lodging-import-action-0")).toHaveValue("");
    expect(commitButton()).toBeDisabled();
  });

  it("sends the stay it was told about when the reader creates another one anyway", async () => {
    const onCommit = renderRows([ambiguous]);
    pick(BERN);
    choose(0, "create");
    fireEvent.click(commitButton());
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    const [row] = onCommit.mock.calls[0][0];
    expect(row.matchedLodgingId).toBe(BERN);
    expect(row.matchedStayId).toBe(STAY_ID);
  });

  it("finds nothing under a house without that stay, and adds it plainly", () => {
    renderRows([ambiguous]);
    pick(CHUR);
    expect(screen.queryByTestId("lodging-import-stay-hint-0")).not.toBeInTheDocument();
    expect(optionLabels(0)).toContain("Aufenthalt hinzufügen");
  });
});

describe("4 — an update row explains every field it changes", () => {
  const update: LodgingImportPreviewRow = {
    ...matched,
    stay: { checkIn: "2026-05-01", checkOut: "2026-05-05", totalPrice: 300, currency: "EUR" },
    dedupeHint: "stay_exact_ref",
    matchIsGuess: false,
    matchedStayId: STAY_ID,
    matchedStay: {
      checkIn: "2026-05-01",
      checkOut: "2026-05-03",
      datePrecision: "DAY",
      nights: 2,
      href: `/lodging/${HOUSE_ID}`,
    },
    matchedStayValues: {
      checkIn: "2026-05-01",
      checkOut: "2026-05-03",
      roomCategory: null,
      board: null,
      guests: null,
      totalPrice: 300,
      pricePerNight: null,
      currency: "EUR",
      bookingReference: null,
    },
    action: "update",
    changes: [{ field: "checkOut", from: "2026-05-03", to: "2026-05-05" }],
  };

  it("names a price the reader edits on a row whose mail did not move it", () => {
    renderRows([update]);
    expect(screen.getByTestId("lodging-import-changes-0")).toHaveTextContent(
      "Geändert: Abreise: 03.05.2026 → 05.05.2026"
    );
    type("lodging-import-price-0", "350");
    expect(screen.getByTestId("lodging-import-changes-0")).toHaveTextContent(
      "Abreise: 03.05.2026 → 05.05.2026, Gesamtpreis: 300 → 350"
    );
  });

  it("names a currency the reader changes", () => {
    renderRows([update]);
    type("lodging-import-currency-0", "CHF");
    expect(screen.getByTestId("lodging-import-changes-0")).toHaveTextContent("Währung: EUR → CHF");
  });

  it("drops the line again once the edit restores the stored value", () => {
    renderRows([update]);
    type("lodging-import-price-0", "350");
    type("lodging-import-price-0", "300");
    expect(screen.getByTestId("lodging-import-changes-0")).not.toHaveTextContent("Gesamtpreis");
  });
});

describe("5 — a stay cleared to nothing on a stored house is never a silent no-op", () => {
  it("holds 'add a stay' once both dates are gone", () => {
    renderRows([matched]);
    choose(0, "create");
    expect(commitButton()).toBeEnabled();
    type("lodging-import-checkin-0", "");
    type("lodging-import-checkout-0", "");
    expect(screen.getByTestId("lodging-import-blocker-nothing_to_create-0")).toHaveTextContent(
      "Kein Aufenthalt angegeben — es gibt nichts anzulegen. Daten eintragen oder Zeile überspringen."
    );
    expect(commitButton()).toBeDisabled();
    choose(0, "skip");
    expect(commitButton()).toBeEnabled();
  });

  it("says it in English too", () => {
    locale.current = "en";
    renderRows([matched]);
    choose(0, "create");
    type("lodging-import-checkin-0", "");
    type("lodging-import-checkout-0", "");
    expect(screen.getByTestId("lodging-import-blocker-nothing_to_create-0")).toHaveTextContent(
      "No stay given — there is nothing to create. Enter dates or skip the row."
    );
  });
});
