import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { ExtractTarget } from "../../../lib/extractValues";

const storedValues = vi.hoisted(() => vi.fn());
const extractValues = vi.hoisted(() => vi.fn());

vi.mock("../../../lib/api/documents", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/api/documents")>(
    "../../../lib/api/documents"
  );
  return { ...actual, documentsApi: { storedValues, extractValues } };
});

import { StoredValuesAction } from "../StoredValuesAction";

const target: ExtractTarget = {
  domain: "flight",
  flightNumber: "LH1234",
  departureDate: "2026-05-01",
  current: {},
  onApply: vi.fn(),
};

async function open() {
  const user = userEvent.setup();
  render(<StoredValuesAction documentId="d1" target={target} />);
  await user.click(screen.getByRole("button", { name: "documents:stored.action" }));
  return user;
}

beforeEach(() => vi.clearAllMocks());

describe("StoredValuesAction (forgejo#407)", () => {
  it("shows the stored values with the leg hints and never runs the parser", async () => {
    storedValues.mockResolvedValue({
      domain: "flight",
      parserUsed: "regex",
      values: {
        price: 412.8,
        currency: "EUR",
        bookingReference: "ABC123",
        seatNumber: null,
        seatClass: null,
      },
      reason: null,
    });
    await open();
    expect(await screen.findByText("412.8")).toBeInTheDocument();
    expect(screen.getByText("ABC123")).toBeInTheDocument();
    expect(screen.queryByText("documents:extract.field.seatNumber")).toBeNull();
    expect(storedValues).toHaveBeenCalledWith("d1", {
      flightNumber: "LH1234",
      departureDate: "2026-05-01",
    });
    expect(extractValues).not.toHaveBeenCalled();
  });

  it.each(["notParsed", "unreadable", "nothingFound"])(
    "says why there is nothing to show (%s)",
    async (reason) => {
      storedValues.mockResolvedValue({ domain: null, parserUsed: null, values: null, reason });
      await open();
      expect(await screen.findByText(`documents:stored.reason.${reason}`)).toBeInTheDocument();
    }
  );

  it.each([
    [404, "documents:stored.notFound"],
    [429, "documents:stored.rateLimited"],
    [undefined, "documents:stored.network"],
    [500, "documents:stored.failed"],
  ])("names its own reason for a failed read (HTTP %s)", async (status, key) => {
    storedValues.mockRejectedValue(
      Object.assign(new Error("x"), status ? { response: { status } } : {})
    );
    await open();
    expect(await screen.findByRole("alert")).toHaveTextContent(key);
  });
});
