/**
 * forgejo#249: the row's "Beta" badge explained itself only in a hover title.
 * The row is a checkbox, so it cannot hold a help button of its own; the
 * explanation is the row's accessible description instead.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DomainFilterRow } from "../DomainFilterRow";

function renderRow(beta: boolean): void {
  render(
    <DomainFilterRow
      row={{ key: "flight", visible: true, count: 3, beta }}
      label="Flüge"
      color="var(--domain-flight)"
      onlyLabel="Nur"
      onlyTooltip="Nur Flüge"
      betaTooltip="Beta-Funktion dieser Instanz"
      touch={false}
      onToggle={vi.fn()}
      onIsolate={vi.fn()}
      rowRef={vi.fn()}
      onKeyDown={vi.fn()}
    />
  );
}

describe("DomainFilterRow beta badge", () => {
  it("describes a beta row with the badge's explanation, not a hover title", () => {
    renderRow(true);
    const row = screen.getByRole("checkbox", { name: "Flüge" });
    expect(row).toHaveAccessibleDescription("Beta-Funktion dieser Instanz");
    expect(screen.getByText("Beta")).not.toHaveAttribute("title");
  });

  it("describes nothing on a row that is not beta", () => {
    renderRow(false);
    expect(screen.getByRole("checkbox", { name: "Flüge" })).not.toHaveAttribute("aria-describedby");
  });
});
