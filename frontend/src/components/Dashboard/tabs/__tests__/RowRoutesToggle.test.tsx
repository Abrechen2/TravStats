/**
 * Owner 2026-11-22: the "routes off, only airports/ports/stations" switch must
 * sit in the domain selection rows, not only deep in the map settings.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DomainFilterRow } from "../DomainFilterRow";
import { RowRoutesToggle } from "../RowRoutesToggle";
import { useMapRoutesStore } from "../../../../store/mapRoutesStore";
import { ALL_ROUTES_VISIBLE } from "../../../../lib/mapRoutes";
import type { FilterDomainKey } from "../../../../shared/dashboardDomainFilter";

function renderRow(key: FilterDomainKey, onToggle = vi.fn()): void {
  render(
    <DomainFilterRow
      row={{ key, visible: true, count: 1, beta: false }}
      label={key}
      color="var(--domain-flight)"
      onlyLabel="Nur"
      onlyTooltip="Nur"
      betaTooltip=""
      touch={false}
      onToggle={onToggle}
      onIsolate={vi.fn()}
      rowRef={vi.fn()}
      onKeyDown={vi.fn()}
    />
  );
}

beforeEach(() => {
  useMapRoutesStore.setState({ visible: { ...ALL_ROUTES_VISIBLE }, blocked: false });
  localStorage.clear();
});

describe("domain row routes toggle", () => {
  it("defaults to routes shown and flips the shared store to stops only without toggling the row", () => {
    const onToggle = vi.fn();
    renderRow("cruise", onToggle);
    const btn = screen.getByTestId("row-routes-toggle-cruise");
    expect(btn).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(btn);
    expect(useMapRoutesStore.getState().visible.cruise).toBe(false);
    expect(useMapRoutesStore.getState().visible.flight).toBe(true);
    expect(onToggle).not.toHaveBeenCalled();
    expect(btn).toHaveAttribute("aria-pressed", "true");
  });

  it("is absent on domains that draw no route and disabled while the mode is route-only", () => {
    renderRow("lodging");
    expect(screen.queryByTestId("row-routes-toggle-lodging")).toBeNull();
  });

  it("ignores the stored switch while blocked", () => {
    useMapRoutesStore.setState({ blocked: true });
    renderRow("flight");
    expect(screen.getByTestId("row-routes-toggle-flight")).toBeDisabled();
  });

  it("lets Escape reach the panel from the focused toggle but keeps Enter off the row", () => {
    const rowKey = vi.fn();
    render(
      <div onKeyDown={(e) => rowKey(e.key)}>
        <RowRoutesToggle domain="flight" touch={false} />
      </div>
    );
    const btn = screen.getByTestId("row-routes-toggle-flight");
    fireEvent.keyDown(btn, { key: "Escape" });
    fireEvent.keyDown(btn, { key: "Enter" });
    expect(rowKey).toHaveBeenCalledTimes(1);
    expect(rowKey).toHaveBeenCalledWith("Escape");
  });
});
