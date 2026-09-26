import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { JSX } from "react";
import { useConfirmDialog } from "../useConfirmDialog";

/**
 * The in-page replacement for `window.confirm` (browser acceptance
 * 2026-09-26: log cleanup, a loyalty card and nineteen other questions were
 * the browser's own box). Driven through real clicks on the real ConfirmModal.
 */

vi.mock("../useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

function Asker({ onAnswer }: { onAnswer: (answer: boolean) => void }): JSX.Element {
  const { confirm, confirmDelete, confirmDialog } = useConfirmDialog();
  const [shown, setShown] = useState(true);
  return (
    <>
      <button onClick={async () => onAnswer(await confirmDelete("Wirklich löschen?"))}>ask</button>
      <button onClick={async () => onAnswer(await confirm({ message: "Exportieren?" }))}>
        plain
      </button>
      <button onClick={() => setShown(false)}>hide</button>
      {shown && confirmDialog}
    </>
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("useConfirmDialog", () => {
  it("answers yes on the dialog's own delete button, without the browser's box", async () => {
    const native = vi.fn(() => false);
    vi.stubGlobal("confirm", native);
    const onAnswer = vi.fn();
    const user = userEvent.setup();
    render(<Asker onAnswer={onAnswer} />);

    await user.click(screen.getByText("ask"));
    const dialog = screen.getByTestId("confirm-modal");
    expect(within(dialog).getByText("Wirklich löschen?")).toBeTruthy();
    expect(
      within(dialog).getByRole("heading", { name: "common:confirmDialog.title" })
    ).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "common:buttons.delete" }));

    expect(onAnswer).toHaveBeenCalledWith(true);
    expect(screen.queryByTestId("confirm-modal")).toBeNull();
    expect(native).not.toHaveBeenCalled();
  });

  it("answers no on cancel", async () => {
    const onAnswer = vi.fn();
    const user = userEvent.setup();
    render(<Asker onAnswer={onAnswer} />);

    await user.click(screen.getByText("plain"));
    await user.click(screen.getByRole("button", { name: "common:buttons.cancel" }));

    expect(onAnswer).toHaveBeenCalledWith(false);
    expect(screen.queryByTestId("confirm-modal")).toBeNull();
  });

  it("answers no on Escape", async () => {
    const onAnswer = vi.fn();
    const user = userEvent.setup();
    render(<Asker onAnswer={onAnswer} />);

    await user.click(screen.getByText("plain"));
    await user.keyboard("{Escape}");

    expect(onAnswer).toHaveBeenCalledWith(false);
  });

  it("does not leave a caller waiting when the component goes away", async () => {
    const onAnswer = vi.fn();
    const user = userEvent.setup();
    const { unmount } = render(<Asker onAnswer={onAnswer} />);

    await user.click(screen.getByText("ask"));
    unmount();
    await Promise.resolve();

    expect(onAnswer).toHaveBeenCalledWith(false);
  });
});
