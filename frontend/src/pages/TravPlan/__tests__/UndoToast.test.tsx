import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UndoToast } from "../UndoToast";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe("UndoToast", () => {
  afterEach(() => vi.useRealTimers());

  it("is not offered for the change the page was opened on", () => {
    render(<UndoToast mutationId="m1" busy={false} onUndo={vi.fn()} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("appears for a change made here, undoes it, and goes away by itself", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onUndo = vi.fn();
    const { rerender } = render(<UndoToast mutationId="m1" busy={false} onUndo={onUndo} />);
    rerender(<UndoToast mutationId="m2" busy={false} onUndo={onUndo} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTime(8100));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    rerender(<UndoToast mutationId="m3" busy={false} onUndo={onUndo} />);
    await userEvent.click(screen.getByRole("button", { name: "undo" }));
    expect(onUndo).toHaveBeenCalledWith("m3");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
