import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import CoverImage from "../CoverImage";

describe("CoverImage", () => {
  it("reports a picture that does not load, so the page can say the cover is gone", () => {
    const onBroken = vi.fn();
    render(<CoverImage url="/gone.jpg" crop={null} opacity={0.2} onBroken={onBroken} />);
    fireEvent.error(screen.getByTestId("cover-image").querySelector("img")!);
    expect(onBroken).toHaveBeenCalledTimes(1);
  });
});
