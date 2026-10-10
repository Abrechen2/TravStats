/**
 * forgejo#249: the shared help affordance. Every case drives what a user does
 * — a tap, a key, a click beside it — and asserts what they then see or where
 * their focus is, because the old help icon passed its tests while it opened
 * on `touchstart` and shut again on the `click` that followed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Toggletip from "../Toggletip";
import HelpIcon from "../../Help/HelpIcon";
import Modal from "../../Modal";
import { placeToggletip } from "../toggletipPosition";

const originalMatchMedia = window.matchMedia;

function pointer(coarse: boolean): void {
  window.matchMedia = ((query: string) => ({
    matches: coarse && query === "(pointer: coarse)",
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
});

const helpButton = (): HTMLElement =>
  screen.getByRole("button", { name: "accessibility.showHelp" });

describe("Toggletip", () => {
  it("opens on a click, says so, and the panel it names holds the help", async () => {
    render(<HelpIcon content="Gepäck in Kilogramm" expandedContent="Ohne Handgepäck" />);
    const button = helpButton();
    expect(button).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(button);

    expect(button).toHaveAttribute("aria-expanded", "true");
    const panel = screen.getByRole("dialog", { name: "accessibility.showHelp" });
    expect(button).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveTextContent("Gepäck in Kilogramm");
    expect(panel).toHaveTextContent("Ohne Handgepäck");
    // Focus moved in, so a screen reader reads the help as it opens.
    expect(panel).toHaveFocus();
  });

  it("a tap opens it and leaves it open — no touchstart/click flash", () => {
    render(<HelpIcon content="Hilfe" />);
    const button = helpButton();
    fireEvent.pointerDown(button, { pointerType: "touch" });
    fireEvent.touchStart(button);
    fireEvent.pointerEnter(button, { pointerType: "touch" });
    fireEvent.click(button);
    expect(screen.getByRole("dialog")).toHaveTextContent("Hilfe");
  });

  it("opens by keyboard with Enter and with Space", async () => {
    render(<HelpIcon content="Hilfe" />);
    act(() => helpButton().focus());
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => helpButton().focus());
    await userEvent.keyboard(" ");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Escape closes it and gives focus back to the trigger, without re-opening a preview", async () => {
    render(<HelpIcon content="Hilfe" />);
    await userEvent.click(helpButton());
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(helpButton()).toHaveFocus();
  });

  it("Tab onto it previews the short help; Tab away hides it", async () => {
    render(
      <>
        <HelpIcon content="Kurz" />
        <button type="button">Weiter</button>
      </>
    );
    await userEvent.tab();
    expect(helpButton()).toHaveFocus();
    expect(screen.getByRole("tooltip")).toHaveTextContent("Kurz");
    await userEvent.tab();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("the close button closes it and gives focus back to the trigger", async () => {
    render(<HelpIcon content="Hilfe" />);
    await userEvent.click(helpButton());
    await userEvent.click(screen.getByRole("button", { name: "buttons.close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(helpButton()).toHaveFocus();
  });

  it("Tab out of the panel returns to the trigger instead of the end of the page", async () => {
    render(
      <>
        <HelpIcon content="Hilfe" />
        <button type="button">Weiter</button>
      </>
    );
    await userEvent.click(helpButton());
    await userEvent.tab(); // panel -> its close button
    expect(screen.getByRole("button", { name: "buttons.close" })).toHaveFocus();
    await userEvent.tab(); // leaves the panel
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(helpButton()).toHaveFocus();
  });

  it("a tap beside it closes it", async () => {
    render(
      <>
        <HelpIcon content="Hilfe" />
        <p>Anderswo</p>
      </>
    );
    await userEvent.click(helpButton());
    await userEvent.click(screen.getByText("Anderswo"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("inside a form dialog, Escape closes the help and not the form", async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Flug">
        <HelpIcon content="Hilfe" />
      </Modal>
    );
    await userEvent.click(helpButton());
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "accessibility.showHelp" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(helpButton()).toHaveFocus();
  });

  it("opening it does not activate the row or label around it", async () => {
    const onRow = vi.fn();
    const onRowKey = vi.fn();
    render(
      <div onClick={onRow} onKeyDown={onRowKey}>
        <HelpIcon content="Hilfe" />
      </div>
    );
    await userEvent.click(helpButton());
    expect(onRow).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    act(() => helpButton().focus());
    await userEvent.keyboard("{Enter}");
    expect(onRowKey).not.toHaveBeenCalled();
  });

  it("a mouse hover previews the short help as a tooltip the trigger is described by", async () => {
    render(<HelpIcon content="Kurz" expandedContent="Lang" />);
    await userEvent.hover(helpButton());
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Kurz");
    expect(tip).not.toHaveTextContent("Lang");
    expect(helpButton()).toHaveAccessibleDescription(/Kurz/);
    await userEvent.unhover(helpButton());
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("is named after its subject, so twelve helps in a form are told apart", () => {
    render(<HelpIcon content="Hilfe" subject="Gepäck" />);
    expect(screen.getByRole("button", { name: "help.about" })).toBeInTheDocument();
  });

  it("a custom trigger keeps its visible text as its name, or takes a label", async () => {
    render(
      <>
        <Toggletip content="Kein Datum bekannt">
          <span>ohne Datum</span>
        </Toggletip>
        <Toggletip content="Nicht anwendbar" label="nicht anwendbar">
          —
        </Toggletip>
      </>
    );
    await userEvent.click(screen.getByRole("button", { name: "ohne Datum" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Kein Datum bekannt");
    expect(screen.getByRole("button", { name: "nicht anwendbar" })).toBeInTheDocument();
  });

  // Touch sizing follows the POINTER (CLAUDE.md): jsdom lays nothing out, so
  // the hit area's declared size is what can be read.
  it("takes a 44 px hit area on a coarse pointer and 24 px for a mouse, without growing", () => {
    pointer(true);
    const { unmount } = render(<HelpIcon content="Hilfe" />);
    const hit = (): HTMLElement =>
      helpButton().querySelector("[data-toggletip-hit]") as HTMLElement;
    expect(hit().style.width).toBe("max(100%, var(--ts-size-touch-min))");
    expect(hit().style.height).toBe("max(100%, var(--ts-size-touch-min))");
    expect(hit().className).toContain("absolute");
    unmount();

    pointer(false);
    render(<HelpIcon content="Hilfe" />);
    expect(hit().style.width).toBe("max(100%, 24px)");
  });

  it("the close button reaches the touch minimum on a coarse pointer", async () => {
    pointer(true);
    render(<HelpIcon content="Hilfe" />);
    await userEvent.click(helpButton());
    expect(screen.getByRole("button", { name: "buttons.close" }).style.minHeight).toBe(
      "var(--ts-size-touch-min)"
    );
  });
});

describe("placeToggletip", () => {
  const viewport = { width: 800, height: 600 };
  const panel = { top: 0, bottom: 100, left: 0, right: 200, width: 200, height: 100 };
  const at = (top: number, left: number) => ({
    top,
    bottom: top + 16,
    left,
    right: left + 16,
    width: 16,
    height: 16,
  });

  it("takes the preferred side when it fits", () => {
    expect(placeToggletip("top", at(300, 300), panel, viewport)).toMatchObject({
      side: "top",
      top: 192,
    });
  });

  it("flips to the side with room when the preferred one does not fit", () => {
    expect(placeToggletip("top", at(20, 300), panel, viewport).side).toBe("bottom");
  });

  it("never leaves the viewport at an edge", () => {
    const placed = placeToggletip("bottom", at(300, 790), panel, viewport);
    expect(placed.left).toBe(800 - 200 - 8);
  });
});
