import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  LodgingImportPreviewModal,
  parseTotalPriceInput,
} from "../../../components/lodging/LodgingImportPreviewModal";
import type { LodgingImportPreviewRow, LodgingImportSummary } from "../../../types/lodgingImport";

const rows: LodgingImportPreviewRow[] = [
  {
    sourceRowIndex: 1,
    lodging: null,
    lodgingName: "Unknown Hotel",
    stay: { checkIn: "2026-01-01", checkOut: "2026-01-02" },
    flags: ["unresolvable_lodging_name"],
    dedupeHint: "none",
    matchedLodgingId: null,
    matchedStayId: null,
    action: "needs_input",
  },
  {
    sourceRowIndex: 0,
    lodging: { name: "Fresh Hotel", city: "Berlin" },
    stay: null,
    flags: ["missing_coordinates"],
    dedupeHint: "none",
    matchedLodgingId: null,
    matchedStayId: null,
    action: "create",
  },
  {
    sourceRowIndex: 2,
    lodging: { name: "Dup Hotel", externalRef: "google:ChIJdup" },
    stay: null,
    flags: [],
    dedupeHint: "lodging_exact_ref",
    matchedLodgingId: "existing-id",
    matchedStayId: null,
    action: "skip",
  },
];

const summary: LodgingImportSummary = { newRows: 1, alreadyPresent: 1, needsInput: 1 };

describe("LodgingImportPreviewModal", () => {
  it("shows the three counts and keeps the questionable row first", () => {
    render(
      <LodgingImportPreviewModal
        rows={rows}
        summary={summary}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    const counts = screen.getByTestId("lodging-import-counts");
    expect(counts.textContent).toContain("1");

    const nameInputs = screen.getAllByTestId(/lodging-import-name-/);
    expect(nameInputs[0]).toHaveValue("Unknown Hotel");
  });

  it("cannot commit while a row is still unresolved", () => {
    render(
      <LodgingImportPreviewModal
        rows={rows}
        summary={summary}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByTestId("lodging-import-commit")).toBeDisabled();
  });

  it("commits create/skip rows once the unresolved row is decided, with the user's edits", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    render(
      <LodgingImportPreviewModal
        rows={rows}
        summary={summary}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />
    );

    fireEvent.change(screen.getByTestId("lodging-import-name-0"), {
      target: { value: "Fresh Hotel (edited)" },
    });
    fireEvent.change(screen.getByTestId("lodging-import-city-0"), {
      target: { value: "Hamburg" },
    });
    fireEvent.change(screen.getByTestId("lodging-import-action-1"), {
      target: { value: "skip" },
    });

    const commit = screen.getByTestId("lodging-import-commit");
    expect(commit).not.toBeDisabled();
    fireEvent.click(commit);

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));

    const committed = onCommit.mock.calls[0][0] as {
      sourceRowIndex: number;
      action: string;
      lodging: { name?: string; city?: string } | null;
    }[];
    expect(committed).toHaveLength(3);
    expect(committed.find((r) => r.sourceRowIndex === 1)?.action).toBe("skip");
    const edited = committed.find((r) => r.sourceRowIndex === 0);
    expect(edited?.action).toBe("create");
    // The regression this guards against: an earlier version of this test
    // only asserted `action`/gating and never checked that the edited value
    // actually reached the payload `onCommit` receives — a bug that drops
    // user edits would still pass. Assert the edit itself made it through.
    expect(edited?.lodging?.name).toBe("Fresh Hotel (edited)");
    expect(edited?.lodging?.city).toBe("Hamburg");
  });

  it("materialises a lodging from the free-text name when the user picks Anlegen and edits nothing", async () => {
    // The defect this pins (found 2026-08-13 against the owner's own CSV, and
    // reported by Alex on 2026-08-09): a stays-only row carries `lodging: null`
    // and only a `lodgingName`. Choosing "Anlegen" used to send `lodging: null`
    // unchanged, because the lodging object was materialised lazily — on the
    // first EDIT of a lodging field. The backend then answered 201 with
    // `missing_lodging_reference` for the row and created nothing, so a CSV of
    // hotel names plus dates imported zero rows unless the user happened to
    // type into a field they had no reason to touch.
    //
    // Picking "Anlegen" IS the instruction to create it. The name is the one
    // thing such a row always has.
    const onCommit = vi.fn().mockResolvedValue(undefined);
    render(
      <LodgingImportPreviewModal
        rows={rows}
        summary={summary}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />
    );

    fireEvent.change(screen.getByTestId("lodging-import-action-1"), {
      target: { value: "create" },
    });
    fireEvent.click(screen.getByTestId("lodging-import-commit"));

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));

    const committed = onCommit.mock.calls[0][0] as {
      sourceRowIndex: number;
      action: string;
      lodging: { name?: string } | null;
      lodgingName: string | null;
    }[];
    const created = committed.find((r) => r.sourceRowIndex === 1);
    expect(created?.action).toBe("create");
    expect(created?.lodging?.name).toBe("Unknown Hotel");
    // The name still travels separately: the backend uses it to join a
    // stays-only row onto a lodging another row in the same payload creates.
    expect(created?.lodgingName).toBe("Unknown Hotel");
  });

  it("does not invent a lodging for a row the user chose to skip", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    render(
      <LodgingImportPreviewModal
        rows={rows}
        summary={summary}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />
    );

    fireEvent.change(screen.getByTestId("lodging-import-action-1"), {
      target: { value: "skip" },
    });
    fireEvent.click(screen.getByTestId("lodging-import-commit"));

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    const committed = onCommit.mock.calls[0][0] as {
      sourceRowIndex: number;
      lodging: { name?: string } | null;
    }[];
    expect(committed.find((r) => r.sourceRowIndex === 1)?.lodging).toBeNull();
  });

  it("does not let an edit on a matched row's name/city reach the commit payload", async () => {
    // A row with `matchedLodgingId` set attaches its stay to the EXISTING
    // hotel on commit — the backend (lodgingImportCommit.ts) never reads
    // `row.lodging` for it. This row starts as `needs_input` (a guessed
    // name+city match the user must confirm), exactly the scenario from the
    // review: the user corrects an OCR'd name, picks "create", and must NOT
    // be lied to about that edit being saved.
    const matchedRows: LodgingImportPreviewRow[] = [
      {
        sourceRowIndex: 9,
        lodging: { name: "OCR'd Hotel Nmae", city: "Munich" },
        stay: { checkIn: "2026-05-01", checkOut: "2026-05-03" },
        flags: [],
        dedupeHint: "lodging_name_city",
        matchedLodgingId: "guessed-lodging-id",
        matchedStayId: null,
        action: "needs_input",
      },
    ];
    const matchedSummary: LodgingImportSummary = { newRows: 0, alreadyPresent: 0, needsInput: 1 };
    const onCommit = vi.fn().mockResolvedValue(undefined);

    render(
      <LodgingImportPreviewModal
        rows={matchedRows}
        summary={matchedSummary}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />
    );

    // The fields must not present themselves as an editable-and-saved input.
    const nameField = screen.getByTestId("lodging-import-name-9");
    const cityField = screen.getByTestId("lodging-import-city-9");
    expect(nameField.tagName).not.toBe("INPUT");
    expect(cityField.tagName).not.toBe("INPUT");
    expect(nameField).toHaveTextContent("OCR'd Hotel Nmae");
    expect(cityField).toHaveTextContent("Munich");

    // Resolve the row and commit — dates/price remain editable and DO reach
    // the payload for a matched row.
    fireEvent.change(screen.getByTestId("lodging-import-checkin-9"), {
      target: { value: "2026-05-02" },
    });
    fireEvent.change(screen.getByTestId("lodging-import-action-9"), {
      target: { value: "create" },
    });
    fireEvent.click(screen.getByTestId("lodging-import-commit"));

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));

    const committed = onCommit.mock.calls[0][0] as {
      sourceRowIndex: number;
      matchedLodgingId?: string | null;
      lodging: { name?: string; city?: string } | null;
      stay: { checkIn?: string } | null;
    }[];
    expect(committed).toHaveLength(1);
    // Name/city are exactly what the row started with — untouched, because
    // there was never an input the user could edit them through.
    expect(committed[0].lodging?.name).toBe("OCR'd Hotel Nmae");
    expect(committed[0].lodging?.city).toBe("Munich");
    expect(committed[0].matchedLodgingId).toBe("guessed-lodging-id");
    // The stay field IS editable and DOES reach the payload.
    expect(committed[0].stay?.checkIn).toBe("2026-05-02");
  });

  it("shows a fixed translated error and never the raw thrown message", async () => {
    const onCommit = vi.fn().mockRejectedValue(new Error("ECONNRESET: raw internal detail"));
    render(
      <LodgingImportPreviewModal
        rows={rows}
        summary={summary}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />
    );

    fireEvent.change(screen.getByTestId("lodging-import-action-1"), {
      target: { value: "skip" },
    });
    fireEvent.click(screen.getByTestId("lodging-import-commit"));

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("ECONNRESET");
    expect(alert.textContent).not.toContain("raw internal detail");
    // The global react-i18next test mock (src/__tests__/setup.ts) returns
    // the bare key it was called with — asserting the exact fixed key here
    // proves the error message is the translated constant, not the thrown
    // error's `.message`.
    expect(alert.textContent).toBe("lodging:import.preview.commitError");
  });

  it("updates the live counts when the user flips a row to skip", () => {
    render(
      <LodgingImportPreviewModal
        rows={rows}
        summary={summary}
        onCommit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    fireEvent.change(screen.getByTestId("lodging-import-action-0"), { target: { value: "skip" } });
    const counts = screen.getByTestId("lodging-import-counts");
    // 0 new · 2 already present · 1 needs input
    expect(counts.textContent).toMatch(/\b0\b/);
  });

  // Finding 1: `ensureStay` is a one-way door — the first touch of any stay
  // input on a stay-less row materializes `stay: {checkIn: "", checkOut: ""}`
  // permanently, with no UI path back to `stay: null`. A row left in that
  // state 400s wholesale on the backend's `isoDay` regex at commit time.
  it("strips an all-empty stay back to null after the user touches then clears a stay-less row's dates", async () => {
    const placesOnlyRows: LodgingImportPreviewRow[] = [
      {
        sourceRowIndex: 0,
        lodging: { name: "Places-only Hotel", city: "Vienna" },
        stay: null,
        flags: ["missing_coordinates"],
        dedupeHint: "none",
        matchedLodgingId: null,
        matchedStayId: null,
        action: "create",
      },
    ];
    const placesOnlySummary: LodgingImportSummary = {
      newRows: 1,
      alreadyPresent: 0,
      needsInput: 0,
    };
    const onCommit = vi.fn().mockResolvedValue(undefined);

    render(
      <LodgingImportPreviewModal
        rows={placesOnlyRows}
        summary={placesOnlySummary}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />
    );

    // Touch: the first edit lazily materializes `stay`.
    fireEvent.change(screen.getByTestId("lodging-import-checkin-0"), {
      target: { value: "2026-01-05" },
    });
    // Clear: back to empty — the user changed their mind / never meant to
    // add a stay at all.
    fireEvent.change(screen.getByTestId("lodging-import-checkin-0"), {
      target: { value: "" },
    });

    fireEvent.click(screen.getByTestId("lodging-import-commit"));
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));

    const committed = onCommit.mock.calls[0][0] as { sourceRowIndex: number; stay: unknown }[];
    expect(committed).toHaveLength(1);
    expect(committed[0].stay).toBeNull();
  });

  // Finding 2: `commitRowSchema` has no `lodgingName` field and commit reads
  // only `lodging`/`matchedLodgingId` — a name-only edit on an unresolved
  // stays-only row (`lodging === null`) used to update ONLY `lodgingName`,
  // guaranteeing `missing_lodging_reference` on commit.
  it("materializes row.lodging when only the name is edited on an unresolved stays-only row", async () => {
    const onCommit = vi.fn().mockResolvedValue(undefined);
    render(
      <LodgingImportPreviewModal
        rows={rows}
        summary={summary}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />
    );

    // Row 1 starts as `lodging: null, lodgingName: "Unknown Hotel"` — edit
    // ONLY the name, never the city.
    fireEvent.change(screen.getByTestId("lodging-import-name-1"), {
      target: { value: "Resolved Hotel Name" },
    });
    fireEvent.change(screen.getByTestId("lodging-import-action-1"), {
      target: { value: "create" },
    });

    fireEvent.click(screen.getByTestId("lodging-import-commit"));
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));

    const committed = onCommit.mock.calls[0][0] as {
      sourceRowIndex: number;
      lodging: { name?: string } | null;
    }[];
    const edited = committed.find((r) => r.sourceRowIndex === 1);
    expect(edited?.lodging).not.toBeNull();
    expect(edited?.lodging?.name).toBe("Resolved Hotel Name");
  });

  // Finding 5 (frontend half): an UNEDITED stays-only row the preview
  // resolved by matching its free-text `lodgingName` against another
  // candidate in the SAME payload (`lodging` stays null, no dedupe hint —
  // lodgingImportPreview.ts's `payloadNames` branch) must still carry
  // `lodgingName` through to commit, so the backend's `createdByName`
  // fallback has something to resolve against.
  it("passes lodgingName through for an unedited stays-only row matched by payload name", async () => {
    const payloadNameRows: LodgingImportPreviewRow[] = [
      {
        sourceRowIndex: 0,
        lodging: { name: "Payload Hotel" },
        stay: null,
        flags: [],
        dedupeHint: "none",
        matchedLodgingId: null,
        matchedStayId: null,
        action: "create",
      },
      {
        sourceRowIndex: 1,
        lodging: null,
        lodgingName: "Payload Hotel",
        stay: { checkIn: "2026-02-01", checkOut: "2026-02-02" },
        flags: [],
        dedupeHint: "none",
        matchedLodgingId: null,
        matchedStayId: null,
        action: "create",
      },
    ];
    const payloadNameSummary: LodgingImportSummary = {
      newRows: 2,
      alreadyPresent: 0,
      needsInput: 0,
    };
    const onCommit = vi.fn().mockResolvedValue(undefined);

    render(
      <LodgingImportPreviewModal
        rows={payloadNameRows}
        summary={payloadNameSummary}
        onCommit={onCommit}
        onCancel={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId("lodging-import-commit"));
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));

    const committed = onCommit.mock.calls[0][0] as {
      sourceRowIndex: number;
      lodging: unknown;
      lodgingName?: string | null;
    }[];
    const staysOnlyRow = committed.find((r) => r.sourceRowIndex === 1);
    expect(staysOnlyRow?.lodging).toBeNull();
    expect(staysOnlyRow?.lodgingName).toBe("Payload Hotel");
  });
});

describe("parseTotalPriceInput", () => {
  // jsdom (and real browsers) sanitize an invalid `type="number"` DOM value
  // to "" before a change event fires — a DOM-level fireEvent.change test
  // cannot actually drive a non-numeric string into e.target.value. Test the
  // guard directly instead.
  it("returns null for an empty string", () => {
    expect(parseTotalPriceInput("")).toBeNull();
  });

  it("returns null for a non-numeric string instead of NaN", () => {
    expect(parseTotalPriceInput("not-a-number")).toBeNull();
  });

  it("returns null for Infinity (a technically-valid but non-finite parse)", () => {
    expect(parseTotalPriceInput("Infinity")).toBeNull();
  });

  it("parses a genuine numeric string", () => {
    expect(parseTotalPriceInput("451.7")).toBe(451.7);
  });

  it("preserves a genuine 0", () => {
    expect(parseTotalPriceInput("0")).toBe(0);
  });
});
