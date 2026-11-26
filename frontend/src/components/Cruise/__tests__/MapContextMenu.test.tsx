import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { MapContextMenu } from "../MapContextMenu";

describe("MapContextMenu inside the map's box-select wrapper (#413)", () => {
  it("'Ausgewählte löschen' runs without the click reaching the box selection, which used to clear the selection first", () => {
    const wrapperDown = vi.fn();
    const wrapperUp = vi.fn();
    const removeSelected = vi.fn();
    render(
      <div onPointerDown={wrapperDown} onPointerUp={wrapperUp}>
        <MapContextMenu
          x={10}
          y={10}
          title="Wegpunkt 3"
          entries={[{ label: "Ausgewählte löschen (11)", onSelect: removeSelected }]}
          onClose={vi.fn()}
        />
      </div>
    );
    const item = screen.getByRole("menuitem", { name: "Ausgewählte löschen (11)" });
    fireEvent.pointerDown(item, { button: 0 });
    fireEvent.pointerUp(item, { button: 0 });
    fireEvent.click(item);
    expect(wrapperDown).not.toHaveBeenCalled();
    expect(wrapperUp).not.toHaveBeenCalled();
    expect(removeSelected).toHaveBeenCalledTimes(1);
  });
});
