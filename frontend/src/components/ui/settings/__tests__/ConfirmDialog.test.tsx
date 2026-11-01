import { useState, type JSX } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConfirmDialog from "../ConfirmDialog";

afterEach(cleanup);

function Host({ word, onConfirm }: { word?: string; onConfirm: () => void }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Ersetzen starten</button>
      <ConfirmDialog
        open={open}
        title="Inhalte ersetzen?"
        affects="Die Blätter Flüge und Orte"
        amount="312 Einträge werden gelöscht."
        after="Vorher sichere ich den Server."
        confirmLabel="312 Einträge ersetzen"
        word={word}
        onConfirm={() => {
          onConfirm();
          setOpen(false);
        }}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

describe("the confirmation (B9)", () => {
  it("states affected, how many and afterwards, and the button names the amount", async () => {
    render(<Host onConfirm={vi.fn()} />);
    await userEvent.click(screen.getByText("Ersetzen starten"));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Die Blätter Flüge und Orte");
    expect(dialog).toHaveTextContent("312 Einträge werden gelöscht.");
    expect(dialog).toHaveTextContent("Vorher sichere ich den Server.");
    expect(screen.getByRole("button", { name: "312 Einträge ersetzen" })).toBeEnabled();
  });

  it("starts with focus on Abbrechen, so a stray Enter destroys nothing", async () => {
    const onConfirm = vi.fn();
    render(<Host onConfirm={onConfirm} />);
    await userEvent.click(screen.getByText("Ersetzen starten"));
    expect(screen.getByRole("button", { name: "settings:blocks.confirm.cancel" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Escape closes and focus returns to the opener", async () => {
    render(<Host onConfirm={vi.fn()} />);
    const opener = screen.getByText("Ersetzen starten");
    await userEvent.click(opener);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("traps Tab inside the dialog, both directions", async () => {
    render(<Host word="ERSETZEN" onConfirm={vi.fn()} />);
    await userEvent.click(screen.getByText("Ersetzen starten"));
    const dialog = screen.getByRole("dialog");
    for (let i = 0; i < 8; i++) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    for (let i = 0; i < 8; i++) {
      await userEvent.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it("keeps the button off until the typed word matches", async () => {
    const onConfirm = vi.fn();
    render(<Host word="ERSETZEN" onConfirm={onConfirm} />);
    await userEvent.click(screen.getByText("Ersetzen starten"));
    const button = screen.getByRole("button", { name: "312 Einträge ersetzen" });
    expect(button).toBeDisabled();
    const field = screen.getByRole("textbox");
    await userEvent.type(field, "ersetz");
    expect(button).toBeDisabled();
    await userEvent.type(field, "en");
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("asks for the word again on the next opening", async () => {
    render(<Host word="ERSETZEN" onConfirm={vi.fn()} />);
    await userEvent.click(screen.getByText("Ersetzen starten"));
    await userEvent.type(screen.getByRole("textbox"), "ERSETZEN");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByText("Ersetzen starten"));
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(screen.getByRole("button", { name: "312 Einträge ersetzen" })).toBeDisabled();
  });
});
