/**
 * An empty list has two reasons to be empty and they are not the same message.
 *
 * Measured in the browser on 23.08.: a library with 22 cruises, searched for
 * a word it does not contain, told the user "Noch keine Kreuzfahrten erfasst".
 * The lodging list did the same. Both had one text for both cases, and adding
 * filters made that wrong answer much easier to reach.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ListEmptyState from "../ListEmptyState";

const props = {
  emptyTitle: "Noch keine Kreuzfahrten erfasst",
  emptyHint: "Füge deine erste hinzu.",
};

describe("ListEmptyState", () => {
  it("says the library is empty only when no filter is narrowing it", () => {
    render(<ListEmptyState {...props} filtered={false} onReset={vi.fn()} />);
    expect(screen.getByText(props.emptyTitle)).toBeInTheDocument();
    expect(screen.getByText(props.emptyHint)).toBeInTheDocument();
  });

  it("never claims the library is empty while a filter is active", () => {
    render(<ListEmptyState {...props} filtered onReset={vi.fn()} />);
    expect(screen.queryByText(props.emptyTitle)).not.toBeInTheDocument();
    expect(screen.getByText("common:filters.noMatch")).toBeInTheDocument();
  });

  it("offers the way out, since the filter may be one the user forgot", async () => {
    const onReset = vi.fn();
    render(<ListEmptyState {...props} filtered onReset={onReset} />);
    await userEvent.click(screen.getByRole("button", { name: "common:filters.reset" }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("offers no reset when there is nothing to reset", () => {
    render(<ListEmptyState {...props} filtered={false} onReset={vi.fn()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  // forgejo#250: "add your first one" with no button to do it.
  it("offers the next step when the library is genuinely empty", async () => {
    const onClick = vi.fn();
    render(
      <ListEmptyState
        {...props}
        filtered={false}
        onReset={vi.fn()}
        action={{ label: "Kreuzfahrt hinzufügen", onClick }}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Kreuzfahrt hinzufügen" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("keeps only the reset while filtered — the entries are hidden, not missing", () => {
    render(
      <ListEmptyState
        {...props}
        filtered
        onReset={vi.fn()}
        action={{ label: "Kreuzfahrt hinzufügen", onClick: vi.fn() }}
      />
    );
    expect(screen.queryByRole("button", { name: "Kreuzfahrt hinzufügen" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "common:filters.reset" })).toBeInTheDocument();
  });
});
