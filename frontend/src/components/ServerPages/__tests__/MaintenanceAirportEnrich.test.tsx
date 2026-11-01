import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MaintenanceAirportEnrich from "../MaintenanceAirportEnrich";
import { useSettingsLevelStore } from "../../../store/settingsLevelStore";

const api = vi.hoisted(() => ({ enrich: vi.fn() }));
vi.mock("../../../lib/api/airports", () => ({ airportsApi: api }));

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsLevelStore.setState({ level: "expert" });
});
afterEach(() => {
  cleanup();
  useSettingsLevelStore.setState({ level: null });
});

// The test i18n returns keys, so the assertions name the key of the sentence.
const axiosError = (status?: number): Error =>
  Object.assign(new Error("request failed"), {
    isAxiosError: true,
    ...(status ? { response: { status } } : {}),
  });

async function submit(code: string) {
  const user = userEvent.setup();
  render(<MaintenanceAirportEnrich />);
  await user.type(screen.getByRole("textbox"), code);
  await user.click(screen.getByRole("button", { name: /enrich\.action/ }));
}

describe("Maintenance › Flughafen nachladen (forgejo#407)", () => {
  it("fetches by IATA code and says what it found", async () => {
    api.enrich.mockResolvedValue({ name: "Frankfurt Airport", iata: "FRA", lat: 0, lon: 0 });
    await submit("fra");
    expect(api.enrich).toHaveBeenCalledWith("fra");
    expect(await screen.findByRole("status")).toHaveTextContent("maintenance.enrich.found");
  });

  it("refuses a code of the wrong shape without calling the server", async () => {
    await submit("FR");
    expect(api.enrich).not.toHaveBeenCalled();
    expect(await screen.findByText(/enrich\.failure\.invalidCode/)).toBeInTheDocument();
  });

  it.each([
    [404, /failure\.notFound/],
    [503, /failure\.unreachable/],
    [429, /failure\.rateLimited/],
    [403, /failure\.forbidden/],
    [undefined, /failure\.unreachable/],
  ])("says its own reason for HTTP %s", async (status, text) => {
    api.enrich.mockRejectedValue(axiosError(status));
    await submit("ZZZ");
    await waitFor(() => expect(screen.getByText(text)).toBeInTheDocument());
  });
});
