import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import RequestsSection from "../RequestsSection";
import { comparisonApi } from "../../../lib/api/comparison";
import type { OwnAdmission } from "../../../lib/comparison/types";
import { SCOPE, person } from "./fixtures";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { origin?: string }) => (o?.origin ? `${k}|${o.origin}` : k),
    i18n: {
      language: "de",
      exists: (k: string) => k === "comparison:error.COMPARISON_INVITE_INVALID",
    },
  }),
}));
vi.mock(
  "../../comparison/ConsentDialog",
  async () => (await import("./fixtures")).consentDialogStub
);
vi.mock("../../../lib/api/comparison", async (original) => ({
  ...(await original<typeof import("../../../lib/api/comparison")>()),
  comparisonApi: {
    accept: vi.fn().mockResolvedValue({}),
    decline: vi.fn().mockResolvedValue({}),
  },
}));

const request = {
  consentId: "c-1",
  person: person("1", "Ben"),
  createdAt: "2026-11-07T00:00:00.000Z",
};
const admission = (
  status: OwnAdmission["status"],
  failureReason: string | null = null
): OwnAdmission => ({
  id: `a-${status}`,
  origin: "https://far.example",
  fingerprint: "f".repeat(64),
  status,
  failureReason,
  createdAt: "2026-11-07T00:00:00.000Z",
  expiresAt: "2026-11-21T00:00:00.000Z",
});

describe("RequestsSection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders nothing when there is nothing to answer", () => {
    const { container } = render(
      <RequestsSection requests={[]} admissions={[admission("approved")]} onChanged={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("accepts a request with the scope chosen in the dialog", async () => {
    const onChanged = vi.fn();
    render(<RequestsSection requests={[request]} admissions={[]} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "requests.accept" }));
    expect(screen.getByRole("button", { name: "confirm-dialog" })).toHaveAttribute(
      "data-mode",
      "accept"
    );
    fireEvent.click(screen.getByRole("button", { name: "confirm-dialog" }));
    await waitFor(() => expect(comparisonApi.accept).toHaveBeenCalledWith("c-1", SCOPE));
    expect(onChanged).toHaveBeenCalled();
  });

  it("says why a decline failed instead of swallowing it", async () => {
    vi.mocked(comparisonApi.decline).mockRejectedValueOnce(new Error("boom"));
    render(<RequestsSection requests={[request]} admissions={[]} onChanged={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "requests.decline" }));
    expect((await screen.findByRole("alert")).textContent).toBe("error.unknown");
  });

  it("reads each admission state as its own sentence and shows a reason only when it has copy", () => {
    render(
      <RequestsSection
        requests={[]}
        admissions={[
          admission("pending"),
          admission("sent"),
          admission("failed", "COMPARISON_INVITE_INVALID"),
          admission("expired", "some English prose from a server"),
        ]}
        onChanged={vi.fn()}
      />
    );
    expect(screen.getByText("friends.admission.pending|https://far.example")).toBeInTheDocument();
    expect(screen.getByText("friends.admission.sent|https://far.example")).toBeInTheDocument();
    expect(
      screen.getByText(
        "friends.admission.failed|https://far.example – error.COMPARISON_INVITE_INVALID"
      )
    ).toBeInTheDocument();
    expect(screen.getByText("friends.admission.expired|https://far.example")).toBeInTheDocument();
    expect(screen.queryByText(/English prose/)).toBeNull();
  });
});
