import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" }, ready: true }),
}));

import { ClockChangeNotice } from "../ClockChangeNotice";

describe("ClockChangeNotice", () => {
  // forgejo#249: the "later occurrence" row is a text-xs line; the row is the
  // label, so it is what a finger has to hit.
  it("makes the later-occurrence row a touch target on a coarse pointer", () => {
    // 02:30 happens twice in Berlin on 2026-10-25.
    render(
      <ClockChangeNotice local="2026-10-25T02:30" zone="Europe/Berlin" onFoldChange={vi.fn()} />
    );
    const box = screen.getByLabelText("common:clockChange.later");
    expect(box.closest("label")?.className).toContain("pointer-coarse:min-h-(--ts-size-touch-min)");
  });
});
