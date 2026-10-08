/**
 * forgejo#249: on a finger-operated device the dialog's × and its footer
 * buttons reach the 44 px touch minimum. Measured before: × ~28 px, footer
 * buttons ~36 px, on iPads — the web build's target.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Modal from "../../Modal";

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

function renderModal(): void {
  render(
    <Modal
      open
      onClose={vi.fn()}
      title="Formular"
      closeLabel="Schließen"
      footer={<button>OK</button>}
    >
      <p>Inhalt</p>
    </Modal>
  );
}

describe("Modal touch targets", () => {
  it("grows the × and the footer buttons for a coarse pointer", () => {
    pointer(true);
    renderModal();
    const close = screen.getByRole("button", { name: "Schließen" });
    expect(close.style.minWidth).toBe("var(--ts-size-touch-min)");
    expect(close.style.minHeight).toBe("var(--ts-size-touch-min)");
    const footer = screen.getByRole("button", { name: "OK" }).parentElement;
    expect(footer).toHaveAttribute("data-touch", "coarse");
    expect(footer?.className).toContain("[&_button]:min-h-(--ts-size-touch-min)");
  });

  it("keeps the compact sizes for a mouse", () => {
    pointer(false);
    renderModal();
    expect(screen.getByRole("button", { name: "Schließen" }).style.minHeight).toBe("");
    expect(screen.getByRole("button", { name: "OK" }).parentElement).not.toHaveAttribute(
      "data-touch"
    );
  });
});
