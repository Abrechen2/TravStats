import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Banner from "../Banner";
import InlineError from "../InlineError";
import ConfirmModal from "../ConfirmModal";
import Toast from "../../Toast";
import { toast, useToastStore, UNDO_TTL_MS } from "../../../store/toastStore";

afterEach(() => {
  cleanup();
  useToastStore.getState().clearToasts();
  vi.useRealTimers();
});

describe("InlineError", () => {
  it("is announced, and stays quiet inside an element that already announces", () => {
    const { rerender } = render(<InlineError>Falsch</InlineError>);
    expect(screen.getByRole("alert")).toHaveTextContent("Falsch");
    rerender(<InlineError announce={false}>Falsch</InlineError>);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Banner", () => {
  it("announces an error at once but an info politely, and offers its one action", () => {
    const { rerender } = render(
      <Banner tone="error" action={<button>Erneut</button>}>
        Laden fehlgeschlagen
      </Banner>
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Laden fehlgeschlagen");
    expect(screen.getByRole("button", { name: "Erneut" })).toBeInTheDocument();
    rerender(<Banner tone="info">Hinweis</Banner>);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Hinweis");
  });
});

describe("toast.undoable", () => {
  it("shows what was done, undoes it once on click and dismisses itself", async () => {
    const onUndo = vi.fn();
    render(<Toast />);
    act(
      () => void toast.undoable({ label: "Station entfernt", detail: "Bringt sie zurück", onUndo })
    );
    expect(screen.getByText("Station entfernt")).toBeInTheDocument();
    expect(screen.getByText("Bringt sie zurück")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "buttons.undo" }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("goes away by itself after the shared undo window", () => {
    vi.useFakeTimers();
    toast.undoable({ label: "Entfernt", onUndo: vi.fn() });
    expect(useToastStore.getState().toasts).toHaveLength(1);
    act(() => void vi.advanceTimersByTime(UNDO_TTL_MS + 50));
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});

describe("ConfirmModal with a body", () => {
  it("keeps the confirm button off until the question is answered and starts on Cancel", () => {
    render(
      <ConfirmModal
        isOpen
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        title="Zeitraum löschen"
        message="12 Punkte gehen verloren."
        confirmText="Löschen"
        cancelText="Abbrechen"
        confirmDisabled
        focusCancel
      >
        <input aria-label="von" />
      </ConfirmModal>
    );
    expect(screen.getByRole("button", { name: "Löschen" })).toBeDisabled();
    expect(screen.getByLabelText("von")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abbrechen" })).toHaveFocus();
  });
});
