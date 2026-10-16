import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ChangeDiffView from "../ChangeDiffView";

/**
 * The diff view serves two inboxes. A pending update carries raw provider
 * values it formats itself; a share notice carries values the time helpers
 * already formatted on the PLACE's clock (ADR 0002). Re-parsing those — an
 * English "Tue, 2 Jun 2026, 09:15" contains a "T" — would move them into the
 * browser's zone. With `formatValue`, a value is shown as given.
 */
describe("ChangeDiffView", () => {
  const change = {
    field: "departureTime",
    type: "changed" as const,
    oldValue: "Mon, 1 Jun 2026, 22:40",
    newValue: "Tue, 2 Jun 2026, 09:15",
  };

  it("shows a preformatted value as given, under the caller's label", async () => {
    render(
      <ChangeDiffView
        original={{}}
        proposed={{}}
        changes={[change]}
        formatValue={(v) => String(v)}
        fieldLabel={(f) => `label:${f}`}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /label:departureTime/ }));
    expect(screen.getByText("Tue, 2 Jun 2026, 09:15")).toBeTruthy();
    expect(screen.getByText("Mon, 1 Jun 2026, 22:40")).toBeTruthy();
  });

  it("keeps formatting raw values itself without the props (pending updates)", async () => {
    render(
      <ChangeDiffView original={{}} proposed={{}} changes={[{ ...change, newValue: null }]} />
    );
    await userEvent.click(screen.getByRole("button", { name: /departureTime/ }));
    expect(screen.getByText("-")).toBeTruthy();
  });
});
