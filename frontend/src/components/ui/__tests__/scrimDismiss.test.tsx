import type { JSX } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import Modal from "../../Modal";
import Dialog from "../Dialog";

/**
 * forgejo#184: selecting the text of a field and letting go of the mouse
 * beside the dialog closed it, and the form with it. The browser reports that
 * gesture to the scrim as a click — mousedown inside the panel, mouseup and
 * click on the scrim — so it is driven here exactly that way.
 */
afterEach(cleanup);

function shells(onClose: () => void): Array<[string, JSX.Element]> {
  return [
    [
      "Modal",
      <Modal key="m" open onClose={onClose} title="Titel" testId="scrim">
        <input aria-label="Feld" defaultValue="markiere mich" />
      </Modal>,
    ],
    [
      "Dialog",
      <Dialog key="d" open onClose={onClose} title="Titel">
        <input aria-label="Feld" defaultValue="markiere mich" />
      </Dialog>,
    ],
  ];
}

const scrimOf = (): HTMLElement => {
  const scrim = document.querySelector<HTMLElement>(".ts-dialog-scrim");
  if (!scrim) throw new Error("no scrim rendered");
  return scrim;
};

describe.each(["Modal", "Dialog"])("%s — a click beside the panel", (name) => {
  const mount = (onClose: () => void): void => {
    const shell = shells(onClose).find(([n]) => n === name);
    if (!shell) throw new Error(name);
    render(shell[1]);
  };

  it("stays open when a drag that began in a field ends on the scrim", () => {
    const onClose = vi.fn();
    mount(onClose);
    fireEvent.mouseDown(screen.getByLabelText("Feld"));
    fireEvent.mouseUp(scrimOf());
    fireEvent.click(scrimOf());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes when the press itself began on the scrim", () => {
    const onClose = vi.fn();
    mount(onClose);
    fireEvent.mouseDown(scrimOf());
    fireEvent.mouseUp(scrimOf());
    fireEvent.click(scrimOf());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on the click after a swallowed drag — the guard does not stick", () => {
    const onClose = vi.fn();
    mount(onClose);
    fireEvent.mouseDown(screen.getByLabelText("Feld"));
    fireEvent.click(scrimOf());
    fireEvent.click(scrimOf());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
