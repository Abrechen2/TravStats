import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import FederationAdmissionCards from "../FederationAdmissionCards";
import { federationAdminApi, type FederationAdmission } from "../../../lib/api/federationAdmin";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("../../../lib/api/federationAdmin", async (original) => ({
  ...(await original<typeof import("../../../lib/api/federationAdmin")>()),
  federationAdminApi: {
    admissions: vi.fn(),
    approveAdmission: vi.fn(),
    declineAdmission: vi.fn(),
  },
}));

const FP = "ab".repeat(32);
const request: FederationAdmission = {
  id: "11111111-1111-4111-8111-111111111111",
  direction: "incoming",
  origin: "https://far.example",
  fingerprint: FP,
  status: "pending",
  failureReason: null,
  createdAt: "2026-11-07T10:00:00.000Z",
  decidedAt: null,
  expiresAt: "2026-11-21T10:00:00.000Z",
  person: { username: "anna", displayName: "Anna" },
};

describe("FederationAdmissionCards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(federationAdminApi.admissions).mockResolvedValue([request]);
  });

  it("a card shows origin, fingerprint and who asked", async () => {
    render(<FederationAdmissionCards onDecided={vi.fn()} />);
    const card = await screen.findByTestId(`federation-admission-${request.id}`);
    expect(within(card).getByText("https://far.example")).toBeInTheDocument();
    expect(within(card).getByText(FP)).toBeInTheDocument();
    expect(card).toHaveTextContent("Anna");
  });

  it("approve calls the API and the card leaves", async () => {
    vi.mocked(federationAdminApi.approveAdmission).mockResolvedValue({
      ...request,
      status: "approved",
    });
    const onDecided = vi.fn();
    render(<FederationAdmissionCards onDecided={onDecided} />);
    const card = await screen.findByTestId(`federation-admission-${request.id}`);
    fireEvent.click(within(card).getByRole("button", { name: "federation.admissions.approve" }));
    await waitFor(() =>
      expect(federationAdminApi.approveAdmission).toHaveBeenCalledWith(request.id)
    );
    await waitFor(() =>
      expect(screen.queryByTestId(`federation-admission-${request.id}`)).toBeNull()
    );
    expect(onDecided).toHaveBeenCalled();
  });

  it("decline calls the API and the card leaves", async () => {
    vi.mocked(federationAdminApi.declineAdmission).mockResolvedValue({
      ...request,
      status: "declined",
    });
    render(<FederationAdmissionCards onDecided={vi.fn()} />);
    const card = await screen.findByTestId(`federation-admission-${request.id}`);
    fireEvent.click(within(card).getByRole("button", { name: "federation.admissions.decline" }));
    await waitFor(() =>
      expect(federationAdminApi.declineAdmission).toHaveBeenCalledWith(request.id)
    );
    await waitFor(() =>
      expect(screen.queryByTestId(`federation-admission-${request.id}`)).toBeNull()
    );
  });

  it("the card states that trip-share requests become possible when that switch is on", async () => {
    render(<FederationAdmissionCards onDecided={vi.fn()} />);
    const card = await screen.findByTestId(`federation-admission-${request.id}`);
    expect(card).toHaveTextContent("federation.admissions.tripSharingNote");
  });

  it("a refused decision keeps the card and says why", async () => {
    vi.mocked(federationAdminApi.approveAdmission).mockRejectedValue(
      Object.assign(new Error("x"), {
        isAxiosError: true,
        response: { status: 409, data: { code: "FEDERATION_ADMISSION_NOT_PENDING" } },
      })
    );
    render(<FederationAdmissionCards onDecided={vi.fn()} />);
    const card = await screen.findByTestId(`federation-admission-${request.id}`);
    fireEvent.click(within(card).getByRole("button", { name: "federation.admissions.approve" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "federation.error.FEDERATION_ADMISSION_NOT_PENDING"
    );
    expect(screen.getByTestId(`federation-admission-${request.id}`)).toBeInTheDocument();
  });

  it("a request waiting for the other admin is listed without buttons", async () => {
    vi.mocked(federationAdminApi.admissions).mockResolvedValue([{ ...request, status: "sent" }]);
    render(<FederationAdmissionCards onDecided={vi.fn()} />);
    expect(await screen.findByText("https://far.example")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "federation.admissions.approve" })).toBeNull();
  });

  it("a sent request that the delivery job settled as failed does not vanish: it says it did not go through", async () => {
    vi.mocked(federationAdminApi.admissions).mockResolvedValue([
      {
        ...request,
        id: "22222222-2222-4222-8222-222222222222",
        direction: "outgoing",
        origin: "https://gone.example",
        status: "failed",
        failureReason: "token-refused",
      },
    ]);
    render(<FederationAdmissionCards onDecided={vi.fn()} />);
    const line = await screen.findByTestId(
      "federation-admission-failed-22222222-2222-4222-8222-222222222222"
    );
    expect(line).toHaveTextContent("https://gone.example");
    expect(line).toHaveTextContent("federation.admissions.failed");
    expect(line).toHaveTextContent("federation.admissions.failedReason.token-refused");
  });
});
