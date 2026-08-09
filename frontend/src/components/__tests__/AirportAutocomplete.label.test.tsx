import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AirportAutocomplete from "../AirportAutocomplete";

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

// The component polls a seeding-status endpoint on mount; irrelevant here and
// it must not reach the network from a unit test.
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../../lib/api");
  return { ...actual, checkSeedingStatus: vi.fn(async () => ({ isSeeding: false })) };
});

/**
 * Issue #239. Callers that render their own heading pass `label=""` — the
 * flight form's Von/Nach fields do exactly that, with `required`. The
 * component still emitted its `<label>`, so the field ended up with TWO
 * labels: the caller's real one, and a second containing nothing but a red
 * asterisk. A screen reader announces that second one as a label whose entire
 * content is "*".
 */
describe("AirportAutocomplete label", () => {
  it("renders no label element at all when the caller supplies none", () => {
    const { container } = render(
      <AirportAutocomplete value={null} onChange={vi.fn()} label="" required />
    );
    expect(container.querySelectorAll("label")).toHaveLength(0);
  });

  it("still renders the label and its required marker when a caller supplies one", () => {
    render(<AirportAutocomplete value={null} onChange={vi.fn()} label="Von" required />);
    const label = screen.getByText("Von", { selector: "label" });
    expect(label).toBeInTheDocument();
    expect(label.textContent).toContain("*");
  });

  it("renders the label without a marker when not required", () => {
    render(<AirportAutocomplete value={null} onChange={vi.fn()} label="Von" />);
    const label = screen.getByText("Von", { selector: "label" });
    expect(label.textContent).not.toContain("*");
  });
});
