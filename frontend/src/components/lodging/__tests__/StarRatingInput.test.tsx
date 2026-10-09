import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StarRatingInput } from "../StarRatingInput";

describe("StarRatingInput", () => {
  it("picks whole and half stars and clears", async () => {
    const onChange = vi.fn();
    render(<StarRatingInput fieldKey="room" label="Zimmer" value={3} onChange={onChange} />);
    await userEvent.click(screen.getByTestId("star-room-4.5"));
    await userEvent.click(screen.getByTestId("star-room-5"));
    await userEvent.click(screen.getByTestId("star-room-clear"));
    expect(onChange.mock.calls.map(([v]) => v)).toEqual([4.5, 5, null]);
  });

  it("stays reachable by keyboard: every half and whole star is a button in tab order", async () => {
    const onChange = vi.fn();
    render(<StarRatingInput fieldKey="room" label="Zimmer" value={null} onChange={onChange} />);
    await userEvent.tab();
    expect(screen.getByTestId("star-room-0.5")).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await userEvent.tab();
    expect(screen.getByTestId("star-room-1")).toHaveFocus();
    await userEvent.keyboard(" ");
    expect(onChange.mock.calls.map(([v]) => v)).toEqual([0.5, 1]);
  });

  // forgejo#249: measured 10 x 20 px per half star on an iPad. Under a coarse
  // pointer the star is 44 px square (halves 22 x 44) and the clear button is
  // 44 px; jsdom cannot measure, so the classes are the contract.
  it("scales the stars and the clear button to the touch minimum on a coarse pointer", () => {
    render(<StarRatingInput fieldKey="room" label="Zimmer" value={2} onChange={vi.fn()} />);
    const star = screen.getByTestId("star-room-1").parentElement as HTMLElement;
    expect(star.className).toContain("pointer-coarse:h-(--ts-size-touch-min)");
    expect(star.className).toContain("pointer-coarse:w-(--ts-size-touch-min)");
    // The two halves still fill the whole star, so each is 22 x 44.
    expect(screen.getByTestId("star-room-0.5").className).toContain("inset-y-0");
    expect(screen.getByTestId("star-room-0.5").className).toContain("w-1/2");
    const clear = screen.getByTestId("star-room-clear");
    expect(clear.className).toContain("pointer-coarse:min-h-(--ts-size-touch-min)");
    expect(clear.className).toContain("pointer-coarse:min-w-(--ts-size-touch-min)");
  });
});
