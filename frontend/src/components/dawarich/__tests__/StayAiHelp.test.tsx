import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, AxiosHeaders } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StayAiHelp, { isAmbiguous, resetAiHelpAvailability } from "../StayAiHelp";
import { dawarichStaysApi, type StayIdentity } from "../../../lib/api/dawarichStays";

/**
 * "KI fragen" (forgejo#439 phase 2) as the user sees it: hidden unless the
 * server offers it, nothing sent before the confirmation dialog, advice that
 * only fills the name field, and every failure shown as itself.
 */

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}));
vi.mock("../../../lib/api/dawarichStays", () => ({
  dawarichStaysApi: { aiHelp: vi.fn(), aiHelpAvailability: vi.fn() },
}));

const help = vi.mocked(dawarichStaysApi.aiHelp);
const availability = vi.mocked(dawarichStaysApi.aiHelpAvailability);
const K = "trips:dawarichStays.aiHelp";

const candidate = (name: string) => ({
  name,
  type: null,
  address: null,
  city: null,
  lat: 48,
  lon: 7.8,
  distanceM: 50,
  photoCount: null,
});
const identity = {
  candidates: [candidate("Stadtverwaltung"), candidate("Café Atlantik")],
  probable: null,
} as unknown as StayIdentity;
const disclosure = {
  serviceId: "aiSuggestionHelp",
  host: "api.openai.com",
  provider: "openai",
  location: "cloud",
  fields: ["candidates", "localDay"],
  pointCount: 0,
  privacyZonesApplied: null,
};
const confirmFirst = () =>
  new AxiosError("409", "ERR_BAD_REQUEST", undefined, undefined, {
    status: 409,
    data: { code: "CONFIRMATION_REQUIRED", disclosure },
    statusText: "Conflict",
    headers: {},
    config: { headers: new AxiosHeaders() },
  });
const failed = (status: number, reason: string) =>
  new AxiosError(String(status), "ERR_BAD_RESPONSE", undefined, undefined, {
    status,
    data: { code: "AI_HELP_FAILED", reason, error: "x" },
    statusText: "",
    headers: {},
    config: { headers: new AxiosHeaders() },
  });
const answer = {
  answer: { ranking: [{ name: "Stadtverwaltung", reason: "Weekday, two hours" }] },
  provider: { kind: "openai", model: "m", host: "api.openai.com", location: "cloud" as const },
};

beforeEach(() => {
  vi.clearAllMocks();
  resetAiHelpAvailability();
  availability.mockResolvedValue({ available: true, reason: null });
});

describe("StayAiHelp", () => {
  it("is not drawn while the server does not offer it", async () => {
    availability.mockResolvedValue({ available: false, reason: "serviceOff" });
    render(<StayAiHelp stayId="s" identity={identity} onPickName={vi.fn()} />);
    await waitFor(() => expect(availability).toHaveBeenCalled());
    expect(screen.queryByTestId("stay-ai-help")).toBeNull();
  });

  it("is not drawn for a stay its photos already settle", () => {
    expect(
      isAmbiguous({
        ...identity,
        probable: { name: "Stadtverwaltung", source: "photos", photoSupported: true },
      })
    ).toBe(false);
    expect(isAmbiguous({ ...identity, candidates: [candidate("Only")] })).toBe(false);
  });

  it("asks first, sends with the confirmation, and only fills the name on a click", async () => {
    help.mockRejectedValueOnce(confirmFirst()).mockResolvedValueOnce(answer);
    const pick = vi.fn();
    render(<StayAiHelp stayId="s" identity={identity} onPickName={pick} />);
    await userEvent.click(await screen.findByTestId("stay-ai-help-ask"));

    const facts = await screen.findByTestId("use-consent-facts");
    expect(facts.textContent).toContain("api.openai.com");
    expect(help).toHaveBeenCalledTimes(1);
    expect(help.mock.calls[0][1]).toBeUndefined();

    await userEvent.click(screen.getByTestId("use-consent-once"));
    expect(await screen.findByText("Stadtverwaltung")).toBeTruthy();
    expect(help.mock.calls[1][1]).toEqual({ mode: "once", target: "openai@api.openai.com" });
    expect(pick).not.toHaveBeenCalled();

    await userEvent.click(screen.getByText(`${K}.use`));
    expect(pick).toHaveBeenCalledWith("Stadtverwaltung");
  });

  it("sends nothing further when the dialog is cancelled", async () => {
    help.mockRejectedValueOnce(confirmFirst());
    render(<StayAiHelp stayId="s" identity={identity} onPickName={vi.fn()} />);
    await userEvent.click(await screen.findByTestId("stay-ai-help-ask"));
    await screen.findByTestId("use-consent-facts");
    await userEvent.click(screen.getByText("externalServices:useConsent.cancel"));
    await waitFor(() => expect(screen.queryByTestId("use-consent-facts")).toBeNull());
    expect(help).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    [504, "timeout"],
    [502, "unreachable"],
    [409, "noProvider"],
  ])("shows a %s as itself (%s)", async (status, reason) => {
    help.mockRejectedValueOnce(failed(status, reason));
    render(<StayAiHelp stayId="s" identity={identity} onPickName={vi.fn()} />);
    await userEvent.click(await screen.findByTestId("stay-ai-help-ask"));
    expect((await screen.findByRole("alert")).textContent).toBe(`${K}.error.${reason}`);
  });
});
