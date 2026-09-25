import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ExtractTarget, ExtractValuesResult } from "../../../lib/extractValues";

const extractValues = vi.hoisted(() => vi.fn());

vi.mock("../../../lib/api/documents", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/api/documents")>(
    "../../../lib/api/documents"
  );
  return { ...actual, documentsApi: { extractValues } };
});

import { ExtractValuesAction } from "../ExtractValuesAction";

const FOUND: ExtractValuesResult = {
  domain: "flight",
  parserUsed: "regex",
  values: {
    price: 412.8,
    currency: "EUR",
    bookingReference: "ABC123",
    seatNumber: "12A",
    seatClass: null,
  },
  reason: null,
};

function target(over: Partial<ExtractTarget> = {}): ExtractTarget {
  return {
    domain: "flight",
    flightNumber: "LH1234",
    departureDate: "2026-05-01",
    current: { price: undefined, currency: "EUR", bookingReference: "XYZ999", seatNumber: "" },
    onApply: vi.fn(),
    ...over,
  };
}

async function open(t: ExtractTarget) {
  const user = userEvent.setup();
  render(<ExtractValuesAction documentId="d1" target={t} />);
  await user.click(screen.getByRole("button", { name: "documents:extract.action" }));
  return user;
}

/**
 * "Werte aus dem Beleg übernehmen": nothing is written without the apply
 * button, empty fields start ticked and filled ones do not, a slow parse can
 * be stopped, and an empty answer is said plainly.
 */
describe("ExtractValuesAction", () => {
  beforeEach(() => {
    extractValues.mockReset();
  });

  it("asks with the entry's domain and leg hints, then previews with empty fields ticked", async () => {
    extractValues.mockResolvedValue(FOUND);
    const t = target();
    const user = await open(t);

    expect(extractValues).toHaveBeenCalledWith(
      "d1",
      { domain: "flight", flightNumber: "LH1234", departureDate: "2026-05-01" },
      expect.any(AbortSignal)
    );
    const price = await screen.findByRole("checkbox", { name: /field\.price/ });
    const reference = screen.getByRole("checkbox", { name: /field\.bookingReference/ });
    const seat = screen.getByRole("checkbox", { name: /field\.seatNumber/ });
    expect(price).toBeChecked();
    expect(seat).toBeChecked();
    // Filled: offered, not ticked. The currency is the one already there: not offered.
    expect(screen.queryByRole("checkbox", { name: /field.currency/ })).toBeNull();
    expect(reference).not.toBeChecked();
    expect(t.onApply).not.toHaveBeenCalled();

    await user.click(seat);
    await user.click(screen.getByRole("button", { name: "documents:extract.apply" }));
    await waitFor(() => expect(t.onApply).toHaveBeenCalledWith({ price: 412.8 }));
  });

  it("says so when the receipt holds nothing, and offers no apply", async () => {
    extractValues.mockResolvedValue({ ...FOUND, values: null, reason: "nothingFound" });
    await open(target());
    expect(await screen.findByText("documents:extract.nothingFound")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "documents:extract.apply" })).toBeNull();
  });

  it("tells a scan apart from an empty reading", async () => {
    extractValues.mockResolvedValue({ ...FOUND, values: null, reason: "noText" });
    await open(target());
    expect(await screen.findByText("documents:extract.noText")).toBeInTheDocument();
  });

  it("names a spent parse budget", async () => {
    extractValues.mockRejectedValue({ isAxiosError: true, response: { status: 429 } });
    await open(target());
    expect(await screen.findByText("documents:extract.rateLimited")).toBeInTheDocument();
  });

  it("shows progress and stops the request on cancel", async () => {
    let signal: AbortSignal | undefined;
    extractValues.mockImplementation(
      (_id: string, _body: unknown, s: AbortSignal) =>
        new Promise(() => {
          signal = s;
        })
    );
    const user = await open(target());
    expect(screen.getByRole("status")).toHaveTextContent("documents:extract.reading");
    await user.click(screen.getByRole("button", { name: "common:buttons.cancel" }));
    expect(signal?.aborted).toBe(true);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
