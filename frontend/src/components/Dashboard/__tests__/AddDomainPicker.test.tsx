import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AddDomainPicker } from "../AddDomainPicker";

// The other component tests in this folder locally override the global key-passthrough mock
// of useTranslation to return human-readable strings. Do the same here so label-based
// assertions work.
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string): string => {
      const map: Record<string, string> = {
        "dashboard:addPicker.button": "Hinzufügen",
        "dashboard:addPicker.flight": "Flug",
        "dashboard:addPicker.cruise": "Kreuzfahrt",
        "dashboard:addPicker.poi": "POI",
      };
      return map[key] ?? key;
    },
  }),
}));

describe("AddDomainPicker", () => {
  it("renders the button label", () => {
    render(
      <AddDomainPicker enabled={{ flight: true, cruise: true, poi: false }} onPick={() => {}} />
    );
    expect(screen.getByRole("button", { name: /hinzufügen/i })).toBeTruthy();
  });

  it("opens the menu on click and lists only enabled domains", () => {
    render(
      <AddDomainPicker enabled={{ flight: true, cruise: true, poi: false }} onPick={() => {}} />
    );
    fireEvent.click(screen.getByRole("button", { name: /hinzufügen/i }));
    expect(screen.getByRole("menuitem", { name: /flug/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /kreuzfahrt/i })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /poi/i })).toBeNull();
  });

  it("calls onPick with the selected domain and closes the menu", () => {
    const onPick = vi.fn();
    render(
      <AddDomainPicker enabled={{ flight: true, cruise: true, poi: false }} onPick={onPick} />
    );
    fireEvent.click(screen.getByRole("button", { name: /hinzufügen/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /kreuzfahrt/i }));
    expect(onPick).toHaveBeenCalledWith("cruise");
    expect(screen.queryByRole("menuitem", { name: /flug/i })).toBeNull();
  });
});
