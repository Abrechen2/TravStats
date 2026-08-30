import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import RankedBarList, { type RankedRow } from "../RankedBarList";

/**
 * "+ 12 weitere" used to be a caption.
 *
 * It named rows that existed and gave no way to reach them — a promise with no
 * door behind it (Alex, 2026-08-29). The rows are already in the component, so
 * the fix is to show them, not to build a modal around data that is sitting
 * right here.
 *
 * One change covers every list in the app: lodging, cruise and places all draw
 * through this component.
 */
const rows: RankedRow[] = Array.from({ length: 12 }, (_, i) => ({
  key: `r${i}`,
  label: `Zeile ${i}`,
  weight: (12 - i) / 12,
  value: String(12 - i),
}));

describe("RankedBarList — the hidden rows are reachable", () => {
  it("shows the rest when the count is clicked, and offers the way back", async () => {
    const user = userEvent.setup();
    render(
      <RankedBarList
        title="Test"
        rows={rows}
        emptyLabel="leer"
        limit={5}
        moreLabel={(hidden) => `+ ${hidden} weitere`}
      />
    );

    expect(screen.queryByText("Zeile 11")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "+ 7 weitere" }));
    expect(screen.getByText("Zeile 11")).toBeInTheDocument();

    // And back — an expander with no way to collapse leaves a wall of rows.
    await user.click(screen.getByRole("button", { name: "common:buttons.showLess" }));
    expect(screen.queryByText("Zeile 11")).not.toBeInTheDocument();
  });

  it("offers nothing when the limit cut nothing", () => {
    render(
      <RankedBarList
        title="Test"
        rows={rows.slice(0, 3)}
        emptyLabel="leer"
        limit={5}
        moreLabel={(hidden) => `+ ${hidden} weitere`}
      />
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("stays a plain list when no moreLabel was given", () => {
    // Callers that never cut anything must not grow a control.
    render(<RankedBarList title="Test" rows={rows} emptyLabel="leer" />);

    expect(screen.getByText("Zeile 11")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
