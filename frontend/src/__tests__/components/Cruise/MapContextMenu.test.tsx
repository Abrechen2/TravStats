import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MapContextMenu } from "../../../components/Cruise/MapContextMenu";

/**
 * The right-click menu is the mouse route to commands that had none: picking a
 * different leg, and deleting a marquee's worth of handles. Test i18n returns
 * raw keys, so labels here are passed in literally by the caller anyway.
 */
function setup(over: Partial<React.ComponentProps<typeof MapContextMenu>> = {}) {
  const onClose = vi.fn();
  const onSelect = vi.fn();
  render(
    <MapContextMenu
      x={40}
      y={60}
      title="Wegpunkt 3"
      entries={[
        { label: "Wegpunkt löschen", onSelect },
        { label: "Ausgewählte löschen (1)", disabled: true },
        { label: null },
        { label: "Auswahl aufheben", onSelect: vi.fn() },
      ]}
      onClose={onClose}
      {...over}
    />
  );
  return { onClose, onSelect };
}

describe("MapContextMenu", () => {
  it("is a menu with its commands", () => {
    setup();
    expect(screen.getByRole("menu", { name: "Wegpunkt 3" })).toBeTruthy();
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
  });

  it("runs a command and closes", () => {
    const { onClose, onSelect } = setup();
    fireEvent.click(screen.getByText("Wegpunkt löschen"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not run a disabled command", () => {
    setup();
    const disabled = screen.getByText("Ausgewählte löschen (1)").closest("button");
    expect(disabled?.disabled).toBe(true);
  });

  it("closes on a click outside", () => {
    const { onClose } = setup();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it("stays open for a click on itself", () => {
    const { onClose } = setup();
    fireEvent.mouseDown(screen.getByRole("menu"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on Escape without letting the editor see it", () => {
    // The editor closes on Escape too. One keystroke must dismiss ONE thing:
    // the menu now, the editor on the next press.
    const { onClose } = setup();
    const editorSaw = vi.fn();
    document.addEventListener("keydown", editorSaw);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(editorSaw).not.toHaveBeenCalled();
    document.removeEventListener("keydown", editorSaw);
  });

  it("puts focus on the first command that can be used", () => {
    setup({
      entries: [
        { label: "Gesperrt", disabled: true },
        { label: "Machbar", onSelect: vi.fn() },
      ],
    });
    expect(document.activeElement?.textContent).toBe("Machbar");
  });
});
