import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import MoreMenu from "../MoreMenu";

/**
 * beta.22 UAT on an iPad: the header's "Mehr" button measured 32 px high.
 * Touch sizing follows the pointer (useCoarsePointer / `pointer-coarse:`), so
 * the trigger reaches 44 px on a finger and keeps its size under a mouse.
 */
describe("MoreMenu trigger", () => {
  it("reaches the touch minimum on a coarse pointer", () => {
    render(
      <MemoryRouter>
        <MoreMenu sections={[{ id: "s", label: "S", items: [] }]} />
      </MemoryRouter>
    );
    const trigger = screen.getByRole("button", { name: /dashboard:nav.more/ });
    expect(trigger.className).toContain("pointer-coarse:min-h-(--ts-size-touch-min)");
  });
});
