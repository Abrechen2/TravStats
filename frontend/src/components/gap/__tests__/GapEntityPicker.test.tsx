import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("../../ui/Dialog", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import GapEntityPicker from "../GapEntityPicker";

/** The house/place picker behind "Eintrag anlegen": a search, its failure, and the way out when nothing fits. */

const base = {
  title: "T",
  hint: "H",
  searchLabel: "S",
  createLabel: "Neu",
  onClose: vi.fn(),
};

describe("GapEntityPicker", () => {
  it("lists what the server found and hands back the record that was picked", async () => {
    const onPick = vi.fn();
    const search = vi
      .fn()
      .mockResolvedValue([{ id: "1", name: "Hotel A", detail: "Köln", data: { id: "1" } }]);
    render(<GapEntityPicker {...base} search={search} onPick={onPick} onCreate={vi.fn()} />);
    fireEvent.click(await screen.findByText("Hotel A"));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "1", data: { id: "1" } }));
    expect(search).toHaveBeenCalledWith("");
  });

  it("a failed search says so and retries; it is not an empty list", async () => {
    const search = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce([{ id: "1", name: "Hotel A", data: 1 }]);
    render(<GapEntityPicker {...base} search={search} onPick={vi.fn()} onCreate={vi.fn()} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("track:gaps.picker.failed");
    expect(screen.queryByTestId("gap-picker-none")).toBeNull();
    fireEvent.click(screen.getByText("track:gaps.retry"));
    expect(await screen.findByText("Hotel A")).toBeTruthy();
  });

  it("with nothing found, creating the missing one is still offered", async () => {
    const onCreate = vi.fn();
    render(
      <GapEntityPicker
        {...base}
        search={vi.fn().mockResolvedValue([])}
        onPick={vi.fn()}
        onCreate={onCreate}
      />
    );
    expect(await screen.findByTestId("gap-picker-none")).toBeTruthy();
    fireEvent.click(screen.getByTestId("gap-picker-create"));
    expect(onCreate).toHaveBeenCalled();
  });

  it("typing searches the server again with the text", async () => {
    const search = vi.fn().mockResolvedValue([]);
    render(<GapEntityPicker {...base} search={search} onPick={vi.fn()} onCreate={vi.fn()} />);
    fireEvent.change(screen.getByTestId("gap-picker-search"), { target: { value: "Rom" } });
    await waitFor(() => expect(search).toHaveBeenCalledWith("Rom"));
  });
});
