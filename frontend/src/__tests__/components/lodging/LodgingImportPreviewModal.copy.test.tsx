import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { LodgingImportPreviewModal } from "../../../components/lodging/LodgingImportPreviewModal";
import type { LodgingImportPreviewRow } from "../../../types/lodgingImport";

/**
 * The preview as a reader sees it — real German and English strings, plurals
 * and interpolation included. The owner's screenshot (2026-10-25) was wrong
 * in its WORDS: "1 neu" over a row that created no hotel, a yellow "Bitte
 * prüfe und entscheide" over nothing left to decide, "Keine Koordinaten"
 * about a house that was not going to be written. A key-returning mock
 * cannot see any of that, so this file renders the real copy.
 */
const locale = vi.hoisted(() => ({ current: "de" as "de" | "en" }));
vi.mock("../../../hooks/useTranslation", async () => {
  const { localeUseTranslationNs } = await import("../../helpers/localeT");
  return {
    useTranslation: (ns?: string | string[]) => localeUseTranslationNs(locale.current, ns),
  };
});

const HOUSE_ID = "8b4c1f8e-2f0d-4a59-9a3e-6d2f7c1b0a11";

/** The screenshot: a Mercure booking, guessed to a stored house by name + city. */
const mercure: LodgingImportPreviewRow = {
  sourceRowIndex: 0,
  lodging: { name: "Mercure Zürich City", city: "Zurich", chainName: "Mercure" },
  stay: { checkIn: "2026-11-02", checkOut: "2026-11-04" },
  flags: ["missing_coordinates", "unknown_chain"],
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

const SUMMARY = { newRows: 0, alreadyPresent: 0, needsInput: 1, changedRows: 0 };

function renderRows(
  rows: LodgingImportPreviewRow[],
  onCommit = vi.fn().mockResolvedValue(undefined)
): ReturnType<typeof vi.fn> {
  render(
    <LodgingImportPreviewModal
      rows={rows}
      summary={SUMMARY}
      onCommit={onCommit}
      onCancel={vi.fn()}
    />
  );
  return onCommit;
}

const counts = (): string => screen.getByTestId("lodging-import-counts").textContent ?? "";
const optionLabels = (index: number): string[] =>
  within(screen.getByTestId(`lodging-import-action-${index}`))
    .getAllByRole("option")
    .map((o) => o.textContent ?? "");
const choose = (index: number, value: string): void => {
  fireEvent.change(screen.getByTestId(`lodging-import-action-${index}`), { target: { value } });
};
const commitButton = (): HTMLElement => screen.getByTestId("lodging-import-commit");

beforeEach(() => {
  locale.current = "de";
});

describe("the screenshot: a stay for a guessed house", () => {
  it("names the stored house as text and says what the guess rests on", () => {
    renderRows([mercure]);

    const name = screen.getByTestId("lodging-import-name-0");
    expect(name.tagName).toBe("A");
    expect(name).toHaveTextContent("Mercure Zürich City");
    expect(name).toHaveAttribute("href", `/lodging/${HOUSE_ID}`);
    // The STORED city, not the import's "Zurich" — and nothing rewritten.
    expect(screen.getByTestId("lodging-import-city-0")).toHaveTextContent(/^Zürich$/);
    expect(screen.getByTestId("lodging-import-imported-as-0")).toHaveTextContent(
      "Laut Import: Mercure Zürich City, Zurich"
    );
    expect(screen.getByTestId("lodging-import-match-hint-0")).toHaveTextContent(
      "Mögliches Hotel: Name und Ort stimmen überein."
    );
    // The import's missing pin and unknown chain describe a hotel this row
    // will not write.
    expect(screen.queryByText(/Koordinaten/)).not.toBeInTheDocument();
    expect(screen.queryByTestId("lodging-import-create-chain-0")).not.toBeInTheDocument();
    expect(screen.queryByTestId("lodging-import-create-all-chains")).not.toBeInTheDocument();
  });

  it("offers the outcome, not a bare 'Anlegen'", () => {
    renderRows([mercure]);

    expect(optionLabels(0)).toEqual(["— auswählen —", "Aufenthalt hinzufügen", "Überspringen"]);
    expect(screen.getByTestId("lodging-import-reject-match-0")).toHaveTextContent(
      "Anderes Hotel? Zuordnung aufheben"
    );
  });

  it("drops the warning once the row is decided, and commits a stay on the stored house", async () => {
    const onCommit = renderRows([mercure]);

    expect(counts()).toBe("0 Zeilen hinzufügen · 0 überspringen · 1 noch zu entscheiden");
    expect(screen.getByTestId("lodging-import-pending-hint")).toHaveTextContent(
      "Bitte wähle für die markierten Zeilen eine Aktion."
    );
    expect(commitButton()).toBeDisabled();

    choose(0, "create");

    expect(counts()).toBe("1 Zeile hinzufügen · 0 überspringen · 0 noch zu entscheiden");
    expect(screen.queryByTestId("lodging-import-pending-hint")).not.toBeInTheDocument();
    expect(screen.getByTestId("lodging-import-matched-explain-0")).toHaveTextContent(
      "Der Aufenthalt wird diesem vorhandenen Hotel zugeordnet. Die Hoteldaten bleiben unverändert."
    );
    expect(commitButton()).toHaveTextContent("Auswahl importieren");
    expect(commitButton()).toBeEnabled();

    fireEvent.click(commitButton());
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    const [row] = onCommit.mock.calls[0][0];
    expect(row.action).toBe("create");
    expect(row.matchedLodgingId).toBe(HOUSE_ID);
    expect(row.stay).toEqual({ checkIn: "2026-11-02", checkOut: "2026-11-04" });
  });

  it("reads the same in English", () => {
    locale.current = "en";
    renderRows([mercure]);

    expect(optionLabels(0)).toEqual(["— choose —", "Add stay", "Skip"]);
    expect(counts()).toBe("0 rows to add · 0 to skip · 1 awaiting a decision");
    expect(screen.getByTestId("lodging-import-match-hint-0")).toHaveTextContent(
      "Possible hotel: name and city match."
    );
    expect(screen.getByTestId("lodging-import-reject-match-0")).toHaveTextContent(
      "Different hotel? Remove match"
    );
    choose(0, "create");
    expect(counts()).toBe("1 row to add · 0 to skip · 0 awaiting a decision");
    expect(commitButton()).toHaveTextContent("Import selection");
  });
});

describe("removing a guessed match", () => {
  it("turns 'add a stay' into 'create hotel and stay', unlocks the fields, and sends no id", async () => {
    const onCommit = renderRows([mercure]);
    choose(0, "create");

    fireEvent.click(screen.getByTestId("lodging-import-reject-match-0"));

    expect(screen.getByTestId("lodging-import-action-0")).toHaveValue("create");
    expect(optionLabels(0)).toContain("Hotel und Aufenthalt anlegen");
    expect(optionLabels(0)).not.toContain("Aufenthalt hinzufügen");
    expect(screen.getByTestId("lodging-import-name-0").tagName).toBe("INPUT");
    expect(screen.getByTestId("lodging-import-city-0")).toHaveValue("Zurich");
    // Now the import's hotel IS written, so its missing pin is worth saying —
    // neutrally, since it does not stop anything.
    expect(screen.getByTestId("lodging-import-flag-missing_coordinates-0")).toHaveTextContent(
      "Importdaten ohne Koordinaten; Import ist möglich."
    );
    expect(screen.getByTestId("lodging-import-create-chain-0")).toBeInTheDocument();

    fireEvent.click(commitButton());
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    const [row] = onCommit.mock.calls[0][0];
    expect(row.action).toBe("create");
    expect(row.matchedLodgingId).toBeNull();
    expect(row.lodging.name).toBe("Mercure Zürich City");
  });

  it("leaves an undecided row undecided", () => {
    renderRows([mercure]);
    fireEvent.click(screen.getByTestId("lodging-import-reject-match-0"));

    expect(screen.getByTestId("lodging-import-action-0")).toHaveValue("");
    expect(screen.getByTestId("lodging-import-pending-hint")).toBeInTheDocument();
  });

  it("is not offered on a skipped row, which shows its values as text", () => {
    renderRows([mercure]);
    choose(0, "skip");

    expect(screen.queryByTestId("lodging-import-reject-match-0")).not.toBeInTheDocument();
    expect(screen.queryByTestId("lodging-import-matched-explain-0")).not.toBeInTheDocument();
    expect(screen.getByTestId("lodging-import-checkin-0").tagName).toBe("SPAN");
    expect(screen.getByTestId("lodging-import-checkin-0")).toHaveTextContent("02.11.2026");
  });
});

describe("the summary counts rows by what they are set to do", () => {
  it("counts a declined new booking as skipped, never as already present", () => {
    renderRows([fresh(0, "Brand New Inn")]);
    choose(0, "skip");

    expect(counts()).toBe("0 Zeilen hinzufügen · 1 überspringen · 0 noch zu entscheiden");
    expect(screen.queryByText(/bereits vorhanden/)).not.toBeInTheDocument();
  });

  it("pluralises in both languages", () => {
    locale.current = "en";
    renderRows([fresh(0, "Inn A"), fresh(1, "Inn B")]);
    expect(counts()).toBe("2 rows to add · 0 to skip · 0 awaiting a decision");
    choose(1, "skip");
    expect(counts()).toBe("1 row to add · 1 to skip · 0 awaiting a decision");
  });

  it("names a new hotel without a stay for what it is", () => {
    renderRows([{ ...fresh(0, "Bookmark Inn"), stay: null }]);
    expect(optionLabels(0)).toContain("Hotel anlegen");
  });

  it("offers nothing to create for a matched hotel with no stay", () => {
    renderRows([{ ...mercure, stay: null }]);
    expect(optionLabels(0)).toEqual(["— auswählen —", "Überspringen"]);
  });
});

describe("match hints say what they rest on", () => {
  it("name only, when the import names no city", () => {
    renderRows([
      {
        ...mercure,
        lodging: { name: "Mercure Zürich City" },
        dedupeHint: "lodging_name_only",
        lodgingDedupeHint: "lodging_name_only",
      },
    ]);
    expect(screen.getByTestId("lodging-import-match-hint-0")).toHaveTextContent(
      "Mögliches Hotel: Name stimmt überein; Ort fehlt im Import."
    );
  });

  it("an exact reference, as proven", () => {
    renderRows([
      {
        ...mercure,
        stay: null,
        dedupeHint: "lodging_exact_ref",
        lodgingDedupeHint: "lodging_exact_ref",
        matchIsGuess: false,
        action: "skip",
      },
    ]);
    const hint = screen.getByTestId("lodging-import-match-hint-0");
    expect(hint).toHaveTextContent("Vorhandenes Hotel mit gleicher Importreferenz.");
    expect(hint.className).toMatch(/success/);
  });

  it("a guess is not painted as a success", () => {
    renderRows([mercure]);
    expect(screen.getByTestId("lodging-import-match-hint-0").className).not.toMatch(/success/);
  });

  it("a same check-in as a possible duplicate, with both periods side by side", () => {
    renderRows([
      {
        ...mercure,
        stay: { checkIn: "2026-05-01", checkOut: "2026-05-05" },
        dedupeHint: "stay_same_dates",
        matchedStayId: "1d9a6f0c-1111-4b2a-8c3d-222222222222",
        matchedStay: {
          checkIn: "2026-05-01",
          checkOut: "2026-05-03",
          datePrecision: "DAY",
          nights: 2,
          href: `/lodging/${HOUSE_ID}`,
        },
      },
    ]);
    expect(screen.getByTestId("lodging-import-stay-hint-0")).toHaveTextContent(
      "Möglicher vorhandener Aufenthalt mit gleicher Anreise."
    );
    expect(screen.getByTestId("lodging-import-incoming-stay-0")).toHaveTextContent(
      "Import: 01.05.2026 – 05.05.2026"
    );
    expect(screen.getByTestId("lodging-import-matched-stay-0")).toHaveTextContent(
      "01.05.2026 – 03.05.2026"
    );
    // The house evidence is not lost behind the stay match.
    expect(screen.getByTestId("lodging-import-match-hint-0")).toHaveTextContent(
      "Name und Ort stimmen überein"
    );
    expect(optionLabels(0)).toContain("Weiteren Aufenthalt anlegen");
  });

  describe("several houses of that name", () => {
    const ambiguous: LodgingImportPreviewRow = {
      ...fresh(0, "Hotel Post"),
      lodging: { name: "Hotel Post" },
      flags: ["ambiguous_lodging_name", "missing_coordinates"],
      dedupeHint: "lodging_name_only",
      lodgingDedupeHint: "lodging_name_only",
      lodgingOptions: [
        { id: "0b9e3a52-1a1a-4c4c-9d9d-000000000001", name: "Hotel Post", city: "Bern" },
        { id: "0b9e3a52-1a1a-4c4c-9d9d-000000000002", name: "Hotel Post", city: "Chur" },
      ],
      action: "needs_input",
    };

    it("asks which one instead of claiming a match, and holds the commit until answered", () => {
      renderRows([ambiguous]);
      expect(screen.getByTestId("lodging-import-ambiguous-0")).toHaveTextContent(
        "Mehrere mögliche Hotels — bitte zuordnen."
      );
      expect(screen.queryByTestId("lodging-import-match-hint-0")).not.toBeInTheDocument();
      choose(0, "create");
      expect(screen.getByTestId("lodging-import-blocked-hint")).toHaveTextContent(
        "1 Zeile braucht noch Angaben"
      );
      expect(commitButton()).toBeDisabled();
    });

    it("commits the house the reader picked", async () => {
      const onCommit = renderRows([ambiguous]);
      fireEvent.change(screen.getByTestId("lodging-import-choose-lodging-0"), {
        target: { value: "0b9e3a52-1a1a-4c4c-9d9d-000000000002" },
      });
      expect(screen.getByTestId("lodging-import-city-0")).toHaveTextContent("Chur");
      expect(optionLabels(0)).toContain("Aufenthalt hinzufügen");
      choose(0, "create");
      expect(commitButton()).toBeEnabled();
      fireEvent.click(commitButton());
      await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
      expect(onCommit.mock.calls[0][0][0].matchedLodgingId).toBe(
        "0b9e3a52-1a1a-4c4c-9d9d-000000000002"
      );
    });

    it("lets the reader declare it a new house", () => {
      renderRows([ambiguous]);
      fireEvent.change(screen.getByTestId("lodging-import-choose-lodging-0"), {
        target: { value: "__new__" },
      });
      expect(screen.getByTestId("lodging-import-name-0").tagName).toBe("INPUT");
      choose(0, "create");
      expect(optionLabels(0)).toContain("Hotel und Aufenthalt anlegen");
      expect(commitButton()).toBeEnabled();
    });
  });
});

describe("flags follow the row as edited", () => {
  it("drops a date flag once the date is corrected", () => {
    renderRows([{ ...fresh(0, "Inn"), stay: { checkIn: "2026-11-04", checkOut: "2026-11-02" } }]);
    expect(screen.getByTestId("lodging-import-flag-invalid_date_range-0")).toHaveTextContent(
      "Zeitraum ungültig"
    );
    expect(commitButton()).toBeDisabled();

    fireEvent.change(screen.getByTestId("lodging-import-checkout-0"), {
      target: { value: "2026-11-06" },
    });
    expect(
      screen.queryByTestId("lodging-import-flag-invalid_date_range-0")
    ).not.toBeInTheDocument();
    expect(commitButton()).toBeEnabled();
  });

  it("raises one when a date is broken after the preview, and a skip releases it", () => {
    renderRows([fresh(0, "Inn")]);
    expect(commitButton()).toBeEnabled();

    fireEvent.change(screen.getByTestId("lodging-import-checkout-0"), {
      target: { value: "2026-10-01" },
    });
    expect(screen.getByTestId("lodging-import-flag-invalid_date_range-0")).toBeInTheDocument();
    expect(commitButton()).toBeDisabled();

    choose(0, "skip");
    expect(commitButton()).toBeEnabled();
  });

  it("holds a name cleared to nothing", () => {
    renderRows([fresh(0, "Inn")]);
    fireEvent.change(screen.getByTestId("lodging-import-name-0"), { target: { value: "" } });
    expect(screen.getByTestId("lodging-import-flag-missing_name-0")).toBeInTheDocument();
    expect(commitButton()).toBeDisabled();
  });
});

describe("a price without a currency", () => {
  it("holds a new row with the same words the server's rule needs", () => {
    renderRows([
      {
        ...fresh(0, "Inn"),
        stay: { checkIn: "2026-11-02", checkOut: "2026-11-04", totalPrice: 300 },
      },
    ]);
    expect(screen.getByTestId("lodging-import-blocker-currency-0")).toHaveTextContent(
      "Währung ergänzen, Preis entfernen oder Zeile überspringen."
    );
    expect(commitButton()).toBeDisabled();
  });

  it("holds an update as well", () => {
    renderRows([
      {
        ...mercure,
        stay: { checkIn: "2026-11-02", checkOut: "2026-11-05", totalPrice: 300 },
        dedupeHint: "stay_exact_ref",
        matchIsGuess: false,
        matchedStayId: "1d9a6f0c-1111-4b2a-8c3d-222222222222",
        action: "update",
        changes: [{ field: "checkOut", from: "2026-11-04", to: "2026-11-05" }],
      },
    ]);
    expect(screen.getByTestId("lodging-import-blocker-currency-0")).toBeInTheDocument();
    expect(commitButton()).toBeDisabled();
    expect(optionLabels(0)).toContain("Aufenthalt aktualisieren");
  });
});

describe("a changed booking's summary follows the edits", () => {
  const changed: LodgingImportPreviewRow = {
    ...mercure,
    stay: { checkIn: "2026-05-01", checkOut: "2026-05-05", currency: "EUR" },
    dedupeHint: "stay_exact_ref",
    matchIsGuess: false,
    matchedStayId: "1d9a6f0c-1111-4b2a-8c3d-222222222222",
    matchedStay: {
      checkIn: "2026-05-01",
      checkOut: "2026-05-03",
      datePrecision: "DAY",
      nights: 2,
      href: `/lodging/${HOUSE_ID}`,
    },
    action: "update",
    changes: [{ field: "checkOut", from: "2026-05-03", to: "2026-05-05" }],
  };

  it("names the field in the reader's words and the new value as edited", () => {
    renderRows([changed]);
    expect(screen.getByTestId("lodging-import-changes-0")).toHaveTextContent(
      "Geändert: Abreise: 03.05.2026 → 05.05.2026"
    );
    fireEvent.change(screen.getByTestId("lodging-import-checkout-0"), {
      target: { value: "2026-05-06" },
    });
    expect(screen.getByTestId("lodging-import-changes-0")).toHaveTextContent(
      "Abreise: 03.05.2026 → 06.05.2026"
    );
  });

  it("says nothing moves once the edit restores the stored value", () => {
    renderRows([changed]);
    fireEvent.change(screen.getByTestId("lodging-import-checkout-0"), {
      target: { value: "2026-05-03" },
    });
    expect(screen.queryByTestId("lodging-import-changes-0")).not.toBeInTheDocument();
  });
});
