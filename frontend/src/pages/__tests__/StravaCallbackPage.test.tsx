import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import StravaCallbackPage from "../StravaCallbackPage";
import { stravaApi } from "../../lib/api/strava";

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("../../components/ui/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../lib/api/strava", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/api/strava")>();
  return { ...original, stravaApi: { exchange: vi.fn() } };
});

function renderAt(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/integrations/strava/callback${search}`]}>
      <Routes>
        <Route path="/integrations/strava/callback" element={<StravaCallbackPage />} />
        <Route path="/settings" element={<div>settings-page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("StravaCallbackPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("exchanges the code once, with the granted scope, and returns to settings", async () => {
    vi.mocked(stravaApi.exchange).mockResolvedValue({
      configured: true,
      connected: true,
      athleteId: "1",
    });
    renderAt("?code=abc&state=s1&scope=read,activity:read_all");
    expect(await screen.findByText("settings-page")).toBeInTheDocument();
    expect(stravaApi.exchange).toHaveBeenCalledTimes(1);
    expect(stravaApi.exchange).toHaveBeenCalledWith({
      code: "abc",
      state: "s1",
      scope: "read,activity:read_all",
    });
  });

  it("says the connection was cancelled when Strava sends an error instead of a code", async () => {
    renderAt("?error=access_denied&state=s1");
    expect(await screen.findByText("roadtrips:strava.callbackDenied")).toBeInTheDocument();
    expect(stravaApi.exchange).not.toHaveBeenCalled();
  });

  it("names the failure kind when the server refuses", async () => {
    const { AxiosError } = await import("axios");
    const err = new AxiosError("refused");
    err.response = { data: { kind: "auth" }, status: 401 } as never;
    vi.mocked(stravaApi.exchange).mockRejectedValue(err);
    renderAt("?code=abc&state=s1");
    await waitFor(() =>
      expect(screen.getByText("roadtrips:strava.failure.auth")).toBeInTheDocument()
    );
  });
});
