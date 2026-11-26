import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import errorToastBaseline from "./uiUnifyB.errorToasts.baseline.json";

/**
 * rc.47 UI unification, package B — dialogs, errors, undo, confirms.
 *
 * Each rule is a source scan, because the defect it prevents is a NEW raw
 * occurrence somewhere nobody is looking: a hand-built overlay, a red
 * paragraph in a fourth shade of red, a `window.confirm`, an undo bar of its
 * own. Allowlists name a file AND a reason; a stale entry fails too, so the
 * lists can only shrink.
 */
const SRC = resolve(__dirname, "..");

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules" || entry === "generated") continue;
      sourceFiles(full, acc);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

const FILES = sourceFiles(SRC).map((f) => ({
  rel: relative(SRC, f).split("\\").join("/"),
  text: readFileSync(f, "utf8"),
}));
const OUTSIDE_UI = FILES.filter((f) => !f.rel.startsWith("components/ui/"));

function count(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

/** Fails on a file over its allowance AND on an allowance nobody uses any more. */
function expectRatchet(found: Map<string, number>, allowed: Record<string, number>): void {
  const over = [...found].filter(([f, n]) => n > (allowed[f]?.valueOf() ?? 0));
  expect(over, "new raw occurrences — use the shared component").toEqual([]);
  const stale = Object.entries(allowed).filter(([f, n]) => (found.get(f) ?? 0) < n);
  expect(stale, "allowance no longer needed — remove or lower it").toEqual([]);
}

describe("one dialog frame", () => {
  it("the legacy components/Modal.tsx is gone and nothing imports it", () => {
    expect(existsSync(join(SRC, "components/Modal.tsx"))).toBe(false);
    const importers = FILES.filter((f) =>
      /from\s+["'](\.\.?\/)+(components\/)?Modal["']/.test(f.text)
    ).map((f) => f.rel);
    expect(importers).toEqual([]);
  });

  /**
   * Modal overlays outside `ui/Dialog` — each is a surface that is not a
   * question with a body: a full-screen editor or a lightbox. Escape and a
   * focus trap are right for them, but the frame (header, scrolling body,
   * footer) is not.
   */
  const MODAL_ALLOWED: Record<string, number> = {
    "components/Cruise/CruiseRouteMap.tsx": 1, // full-screen route editor on a map
    "components/Dashboard/tabs/DomainFilterButton.tsx": 1, // bottom sheet of the filter, not a form
    "components/Trips/CoverCropEditor.tsx": 1, // full-screen crop canvas
    "components/Trips/PhotoLightbox.tsx": 1, // full-bleed photo viewer
  };
  it("a modal overlay is a ui/Dialog, except the named full-screen surfaces", () => {
    const found = new Map<string, number>();
    for (const f of OUTSIDE_UI) {
      const n = count(f.text, /aria-modal(=|"?:)\s*(\{?true\}?|"true")/g);
      if (n > 0) found.set(f.rel, n);
    }
    expectRatchet(found, MODAL_ALLOWED);
  });

  it("nothing calls the browser's own confirm box", () => {
    const hits = FILES.filter((f) => /\b(window|globalThis)\.confirm\s*\(/.test(f.text)).map(
      (f) => f.rel
    );
    expect(hits).toEqual([]);
  });
});

describe("one undo", () => {
  it("no hand-built undo bar or undo toast remains", () => {
    const hits = FILES.filter((f) => /\b(UndoBar|UndoToast)\b/.test(f.text)).map((f) => f.rel);
    expect(hits).toEqual([]);
  });
});

describe("one error voice", () => {
  /**
   * A red of its own. A field error is `InlineError`, a page error `Banner`.
   * What remains is not an error message: a required-field asterisk, a
   * removed-value diff, a destructive button, a status colour in a table.
   */
  const RAW_RED =
    /text-red-\d|text-\(--danger\)|text-\[var\(--danger\)\]|rgb\(252, 165, 165\)|var\(--color-error\)|var\(--color-danger\)|bg-red-\d|border-red-\d|border-\(--danger\)|border-\[var\(--danger\)\]/g;
  const RED_ALLOWED: Record<string, number> = {
    "pages/SetupPage.tsx": 3, // required-field asterisk
    "components/ChangeDiffView.tsx": 2, // removed value in a diff
    "lib/flightReviewFields.ts": 2, // field-source classes of the flight review table
    "components/AirportSeedingBanner.tsx": 1, // status icon
    "components/Toast.tsx": 1, // the toast's own border
    "components/BoardingPassScanner.tsx": 3, // step-status tone table
    "components/ReceiptUpload.tsx": 2, // delete link
    "components/table/RowActionButton.tsx": 1, // delete action hover
    "components/Training/ParseLogStats.tsx": 1, // failure cell in a stats table
    "components/Cruise/CruiseStopActions.tsx": 1, // destructive action
    "components/Cruise/CruiseStopSummary.tsx": 1, // stop status colour
    "components/Cruise/CruiseImportPreviewModal.tsx": 3, // "missing" cell labels
    "components/lodging/StayEditorFooter.tsx": 2, // destructive button
    "components/rental/RentalFormModal.tsx": 1, // gap count in a step header
    "components/import/PreviewModal.tsx": 1, // problem cell in the preview table
    "components/rail/RailTransferNote.tsx": 1, // conflict line of a transfer
  };
  it("a red of its own is InlineError or Banner, except non-message uses", () => {
    const found = new Map<string, number>();
    for (const f of OUTSIDE_UI) {
      const n = count(f.text, RAW_RED);
      if (n > 0) found.set(f.rel, n);
    }
    expectRatchet(found, RED_ALLOWED);
  });

  it("a toast is for success and undo: error toasts only shrink (baseline)", () => {
    const found = new Map<string, number>();
    for (const f of FILES) {
      const n = count(f.text, /addToast\(\s*["'](error|warning)["']/g);
      if (n > 0) found.set(f.rel, n);
    }
    expectRatchet(found, errorToastBaseline as Record<string, number>);
  });
});
