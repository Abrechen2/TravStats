import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Tabs } from "../Tabs";

const TABS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta", count: 3 },
  { value: "c", label: "Gamma", disabled: true },
] as const;

describe("Tabs", () => {
  it("is a named tablist with one selected tab and one tab stop", () => {
    render(<Tabs label="Bereiche" value="b" tabs={TABS} onChange={() => {}} />);
    expect(screen.getByRole("tablist", { name: "Bereiche" })).toBeTruthy();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
    expect(tabs.map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("moves with the arrow keys and skips a disabled tab", () => {
    const onChange = vi.fn();
    render(<Tabs label="Bereiche" value="b" tabs={TABS} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("tab", { name: /Beta/ }), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith("a");
    fireEvent.keyDown(screen.getByRole("tab", { name: /Beta/ }), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("a");
    fireEvent.keyDown(screen.getByRole("tab", { name: /Alpha/ }), { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith("b");
  });

  it("ties tab and panel together through the id prefix", () => {
    render(<Tabs label="x" value="a" tabs={TABS} onChange={() => {}} idPrefix="demo" />);
    const tab = screen.getByRole("tab", { name: "Alpha" });
    expect(tab.id).toBe("demo-tab-a");
    expect(tab.getAttribute("aria-controls")).toBe("demo-panel-a");
  });

  it("keeps a dimmed tab operable and says so in data-disabled", () => {
    const onChange = vi.fn();
    render(
      <Tabs
        label="x"
        value="a"
        onChange={onChange}
        tabs={[
          { value: "a", label: "A" },
          { value: "b", label: "B", dimmed: true },
        ]}
      />
    );
    const dimmed = screen.getByRole("tab", { name: "B" });
    expect(dimmed.getAttribute("data-disabled")).toBe("true");
    fireEvent.click(dimmed);
    expect(onChange).toHaveBeenCalledWith("b");
  });
});
