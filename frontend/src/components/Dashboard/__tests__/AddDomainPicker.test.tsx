import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AddDomainPicker } from "../AddDomainPicker";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string): string => {
      const map: Record<string, string> = {
        "dashboard:addPicker.button": "Hinzufügen",
        "dashboard:addPicker.flight": "Flug",
        "dashboard:addPicker.cruise": "Kreuzfahrt",
        "dashboard:addPicker.lodging": "Unterkunft",
        "dashboard:addPicker.poi": "POI",
      };
      return map[key] ?? key;
    },
  }),
}));

describe("AddDomainPicker", () => {
  it("renders the button label", () => {
    render(<AddDomainPicker enabled={{ flight: true, cruise: true, lodging: true, poi: false }} onPick={() => {}} />);
    expect(screen.getByRole("button", { name: /hinzufügen/i })).toBeTruthy();
  });

  it("opens the menu on click and lists only enabled domains", () => {
    render(<AddDomainPicker enabled={{ flight: true, cruise: true, lodging: true, poi: false }} onPick={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /hinzufügen/i }));
    expect(screen.getByRole("menuitem", { name: /flug/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /kreuzfahrt/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /unterkunft/i })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /poi/i })).toBeNull();
  });

  // Stays were missing from this menu although the tab strip above it counts
  // them — the menu had been hard-wired back when flights were all there was.
  it("omits stays when the lodging domain is switched off", () => {
    render(
      <AddDomainPicker
        enabled={{ flight: true, cruise: false, lodging: false, poi: false }}
        onPick={() => {}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /hinzufügen/i }));
    expect(screen.queryByRole("menuitem", { name: /unterkunft/i })).toBeNull();
  });

  it("calls onPick with the selected domain and closes the menu", () => {
    const onPick = vi.fn();
    render(<AddDomainPicker enabled={{ flight: true, cruise: true, lodging: true, poi: false }} onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: /hinzufügen/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /kreuzfahrt/i }));
    expect(onPick).toHaveBeenCalledWith("cruise");
    expect(screen.queryByRole("menuitem", { name: /flug/i })).toBeNull();
  });

  it("closes the menu on an outside click without calling onPick", () => {
    const onPick = vi.fn();
    render(
      <div>
        <AddDomainPicker enabled={{ flight: true, cruise: true, lodging: true, poi: false }} onPick={onPick} />
        <button type="button">outside</button>
      </div>
    );
    fireEvent.click(screen.getByRole("button", { name: /hinzufügen/i }));
    expect(screen.getByRole("menuitem", { name: /flug/i })).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole("button", { name: /outside/i }));
    expect(screen.queryByRole("menuitem", { name: /flug/i })).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });
});
