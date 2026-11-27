import { describe, it, expect, afterEach } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PageErrorHost from "../PageErrorHost";
import Dialog from "../ui/Dialog";
import { reportPageError, usePageErrorStore } from "../../store/pageErrorStore";

afterEach(() => {
  cleanup();
  usePageErrorStore.getState().clear();
});

describe("a failure reported while a dialog is open", () => {
  it("is shown inside that dialog, not behind its scrim", () => {
    const { rerender } = render(
      <MemoryRouter>
        <PageErrorHost />
        <Dialog open onClose={() => {}} title="Bearbeiten" footer={<button>OK</button>}>
          Inhalt
        </Dialog>
      </MemoryRouter>
    );
    act(() => reportPageError("Speichern fehlgeschlagen"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Speichern fehlgeschlagen")).toBeInTheDocument();
    expect(screen.queryByTestId("page-errors")).toBeNull();

    // closed: the same failure is on the page again
    rerender(
      <MemoryRouter>
        <PageErrorHost />
        <Dialog open={false} onClose={() => {}} title="Bearbeiten">
          Inhalt
        </Dialog>
      </MemoryRouter>
    );
    expect(screen.getByTestId("page-errors")).toHaveTextContent("Speichern fehlgeschlagen");
  });

  it("with two dialogs stacked only the top one carries the banner", () => {
    render(
      <MemoryRouter>
        <Dialog open onClose={() => {}} title="Unten" footer={<button>A</button>}>
          a
        </Dialog>
        <Dialog open onClose={() => {}} title="Oben" footer={<button>B</button>}>
          b
        </Dialog>
      </MemoryRouter>
    );
    act(() => reportPageError("Fehler"));
    expect(screen.getAllByTestId("dialog-errors")).toHaveLength(1);
  });
});
