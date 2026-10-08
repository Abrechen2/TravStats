import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import type { JSX } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DomainImportPanel from "../DomainImportPanel";
import type { DomainImportAdapter } from "../types";

vi.mock("../../../store/toastStore", () => ({
  useToastStore: () => vi.fn(),
}));

vi.mock("../EmailImportTab", () => ({
  default: () => <div data-testid="email-tab-content">EmailTab</div>,
}));

/**
 * A stand-in manual form that does what the real ones do: hand `onSaved` to
 * its save step and show "saved, not refreshed" when that step rejects.
 */
function ManualForm({ onSaved }: { onSaved: () => void | Promise<void> }): JSX.Element {
  const [notice, setNotice] = useState(false);
  return (
    <div data-testid="manual-form">
      <button
        type="button"
        onClick={() => {
          void (async () => {
            try {
              await onSaved();
            } catch {
              setNotice(true);
            }
          })();
        }}
      >
        save
      </button>
      {notice && <p role="status">saved-not-refreshed</p>}
    </div>
  );
}

const adapter: DomainImportAdapter = {
  domain: "lodging",
  panelTitle: "Panel",
  panelHint: "Hint",
  acceptedEmailExtensions: [".eml"],
  supportsDocumentImport: false,
  renderManual: ({ onSaved }) => <ManualForm onSaved={onSaved} />,
  renderReviewModal: () => null,
};

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function openManual(onItemsCreated: () => Promise<void>, onClose = vi.fn()): typeof onClose {
  render(
    <DomainImportPanel open onClose={onClose} onItemsCreated={onItemsCreated} adapter={adapter} />
  );
  fireEvent.click(screen.getByRole("button", { name: "import:route.manual" }));
  return onClose;
}

describe("DomainImportPanel - the manual form outlives the reload (forgejo#247)", () => {
  it("keeps the form mounted while the list reloads, then closes the flow", async () => {
    const reload = deferred();
    const onClose = openManual(() => reload.promise);

    fireEvent.click(screen.getByText("save"));
    // The reload is still running: the form must still be on screen, or a
    // failure of that reload would have nothing to report through.
    expect(screen.getByTestId("manual-form")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    reload.resolve();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("manual-form")).toBeNull();
  });

  it("a reload that fails reaches the form and leaves it open, with no close", async () => {
    const reload = deferred();
    const onClose = openManual(() => reload.promise);

    fireEvent.click(screen.getByText("save"));
    reload.reject(new Error("list unavailable"));

    expect(await screen.findByRole("status")).toHaveProperty("textContent", "saved-not-refreshed");
    expect(screen.getByTestId("manual-form")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});
