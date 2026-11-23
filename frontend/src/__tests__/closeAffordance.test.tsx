import { describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import Modal from "../components/Modal";
import Dialog from "../components/ui/Dialog";
import ConfirmModal from "../components/ui/ConfirmModal";
import { useEscapeClose } from "../hooks/useEscapeClose";

/**
 * Everything that opens has a way to close (owner report 2026-11-23: the
 * change history on a stay opened inline and could not be closed again, "and
 * it happens in several places").
 *
 * Two halves. The shared primitives are rendered and closed — by their visible
 * control and by Escape. And every hand-rolled overlay in the source is
 * scanned: a `role="dialog"`, an `aria-modal` or a full-screen scrim must
 * answer Escape through the shared chrome or `useEscapeClose`. A new overlay
 * that forgets it fails here by file name.
 */

vi.mock("../lib/api/changeHistory", () => ({
  changeHistoryApi: {
    forEntry: vi.fn(),
    restore: vi.fn(),
    retention: vi.fn().mockResolvedValue({ months: 12 }),
  },
}));

import ChangeHistoryDialog from "../components/changeHistory/ChangeHistoryDialog";
import { changeHistoryApi } from "../lib/api/changeHistory";

const SRC = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" || name === "node_modules" ? [] : sourceFiles(path);
    }
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });
}

const OVERLAY = /role="(?:alert)?dialog"|aria-modal|fixed inset-0[^"]*bg-black/;
// `onEscape=` hands the key to a child that owns it (the domain filter panel).
const ANSWERS_ESCAPE = /useEscapeClose|useDialogChrome|["']Escape["']|onEscape=|<Modal\b|<Dialog\b/;

/** Overlays that are not closable things, each with the reason. */
const NOT_A_PANEL: Record<string, string> = {
  // The Suspense fallback shown while the scanner chunk loads; it closes itself.
  "components/FlightForm/FlightLookupStep.tsx": "loading fallback, not a panel",
};

describe("close affordance — every overlay answers Escape", () => {
  it("every role=dialog / aria-modal / scrim in the source closes on Escape", () => {
    const offenders = sourceFiles(SRC)
      .map((path) => ({ path, rel: relative(SRC, path), text: readFileSync(path, "utf8") }))
      .filter(({ rel, text }) => OVERLAY.test(text) && !(rel in NOT_A_PANEL))
      .filter(({ text }) => !ANSWERS_ESCAPE.test(text))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it("the allow-list names only files that still exist and still draw an overlay", () => {
    for (const rel of Object.keys(NOT_A_PANEL)) {
      expect(OVERLAY.test(readFileSync(join(SRC, rel), "utf8"))).toBe(true);
    }
  });
});

describe("close affordance — the shared primitives", () => {
  it("Modal has a visible close control and closes on Escape", async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="T" closeLabel="Schließen">
        body
      </Modal>
    );
    await userEvent.click(screen.getByRole("button", { name: "Schließen" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("Dialog has a visible close control and closes on Escape", async () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="T" closeLabel="Schließen">
        body
      </Dialog>
    );
    await userEvent.click(screen.getByRole("button", { name: "Schließen" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("ConfirmModal closes on Escape and by its cancel button", async () => {
    const onClose = vi.fn();
    render(
      <ConfirmModal
        isOpen
        onClose={onClose}
        onConfirm={vi.fn()}
        title="T"
        message="M"
        cancelText="Abbrechen"
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("the change history ('Verlauf') opens in a dialog that closes again", async () => {
    // Since fix/history-rolling the list opens from the entry's ⋯ menu in a dialog;
    // the dialog's own close button is the way back (close-and-back's rule).
    vi.mocked(changeHistoryApi.forEntry).mockResolvedValue({ entries: [], nextCursor: null });
    const onClose = vi.fn();
    render(<ChangeHistoryDialog entityType="flight" entityId="f1" onClose={onClose} />);
    await screen.findByText("changeHistory:empty");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("useEscapeClose", () => {
  function Panel({ name, onClose }: { name: string; onClose: () => void }): JSX.Element {
    useEscapeClose(true, onClose);
    return <div>{name}</div>;
  }

  it("closes only the panel opened last", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    function Stack(): JSX.Element {
      const [showInner, setShowInner] = useState(false);
      return (
        <>
          <Panel name="outer" onClose={outer} />
          <button type="button" onClick={() => setShowInner(true)}>
            open inner
          </button>
          {showInner && <Panel name="inner" onClose={inner} />}
        </>
      );
    }
    render(<Stack />);
    fireEvent.click(screen.getByText("open inner"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it("leaves a key a dialog inside it already claimed", () => {
    const onClose = vi.fn();
    render(<Panel name="p" onClose={onClose} />);
    const event = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    event.preventDefault();
    window.dispatchEvent(event);
    expect(onClose).not.toHaveBeenCalled();
  });
});
