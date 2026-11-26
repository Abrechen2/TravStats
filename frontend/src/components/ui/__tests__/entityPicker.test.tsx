import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EntityPicker, type EntityPickerStatus } from "../EntityPicker";

const OPTIONS = [
  { id: "1", label: "Frankfurt", detail: "FRA", mark: <span>🇩🇪</span> },
  { id: "2", label: "Fulda" },
];

function Harness({
  status = "ready",
  options = OPTIONS,
  onPick,
  onRetry,
}: {
  status?: EntityPickerStatus;
  options?: typeof OPTIONS;
  onPick: (o: { id: string }) => void;
  onRetry?: () => void;
}) {
  const [query, setQuery] = useState("");
  return (
    <EntityPicker
      label="Ort"
      query={query}
      onQueryChange={setQuery}
      options={options}
      onPick={onPick}
      status={status}
      onRetry={onRetry}
    />
  );
}

describe("EntityPicker", () => {
  it("walks the list with the arrow keys and picks with Enter while focus stays in the box", () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    const box = screen.getByRole("combobox");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "2" }));
  });

  it("picks on click", () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    fireEvent.click(screen.getByRole("option", { name: /Frankfurt/ }).querySelector("button")!);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }));
  });

  it("says a failed search failed instead of showing an empty list, and offers a retry", () => {
    const onRetry = vi.fn();
    render(<Harness status="failed" options={[]} onPick={() => {}} onRetry={onRetry} />);
    expect(screen.getByRole("alert").textContent).toContain("common:ui.picker.failed");
    expect(screen.queryByText("common:ui.picker.none")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "common:ui.picker.retry" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("says so when the search found nothing", () => {
    render(<Harness options={[]} onPick={() => {}} />);
    expect(screen.getByText("common:ui.picker.none")).toBeTruthy();
  });
});
