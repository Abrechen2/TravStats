import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { AdminService } from "../../lib/api/externalServices";

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  initialize: vi.fn(),
  overview: vi.fn(),
  update: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => mocks.navigate };
});

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    setupApi: {
      ...actual.setupApi,
      getStatus: () => mocks.getStatus(),
      initialize: (p: unknown) => mocks.initialize(p),
    },
    versionApi: { ...actual.versionApi, get: async () => ({ version: "2.8.0" }) },
    settingsApi: { ...actual.settingsApi, update: async () => ({}) },
  };
});

vi.mock("../../lib/api/externalServices", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api/externalServices")>();
  return {
    ...actual,
    externalServicesApi: {
      ...actual.externalServicesApi,
      adminOverview: () => mocks.overview(),
      adminUpdate: (id: string, body: unknown) => mocks.update(id, body),
    },
  };
});

import SetupPage from "../SetupPage";

function svc(id: string, over: Partial<AdminService>): AdminService {
  return {
    id,
    category: "openData",
    credential: "none",
    keyless: true,
    alwaysOn: false,
    getKeyUrl: null,
    level: "instance",
    recommended: "free",
    enabled: false,
    configured: true,
    instanceSource: "none",
    allowAccountKeys: null,
    lastTest: null,
    quota: null,
    fields: [],
    ...over,
  };
}

const CATALOGUE = [
  svc("adsblol", {}),
  svc("openData", {}),
  svc("fx", { alwaysOn: true, enabled: true }),
  svc("airlabs", { keyless: false, credential: "key" }),
  svc("ollama", { keyless: false, credential: "url", category: "ai" }),
  svc("immich", { keyless: false, credential: "urlKey" }),
  svc("push", { recommended: null }),
];

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByPlaceholderText("setup:form.adminUsername.placeholder"), "owner");
  await user.type(screen.getByPlaceholderText("setup:form.password.placeholder"), "longenough1");
  await user.type(
    screen.getByPlaceholderText("setup:form.confirmPassword.placeholder"),
    "longenough1"
  );
  await user.click(screen.getByRole("button", { name: "setup:form.submit.create" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getStatus.mockResolvedValue({ demoAccountAvailable: false });
  mocks.initialize.mockResolvedValue({ user: { id: "u1", username: "owner", isAdmin: true } });
  mocks.overview.mockResolvedValue({
    categories: [{ id: "all", services: CATALOGUE }],
    accountConnections: [],
  });
  mocks.update.mockResolvedValue(undefined);
});

describe("SetupPage — turn on the free services", () => {
  it("enables exactly the free, key-less services and nothing that needs a key, cloud AI or a connection", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SetupPage />
      </MemoryRouter>
    );
    await user.click(screen.getByRole("button", { name: "setup:freeServices.cta" }));
    await fillAndSubmit(user);
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
    expect(mocks.update.mock.calls.map((c) => c[0]).sort()).toEqual(["adsblol", "openData"]);
    expect(mocks.update).toHaveBeenCalledWith("adsblol", { enabled: true });
  });

  it("turns nothing on when the button was not pressed", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SetupPage />
      </MemoryRouter>
    );
    await fillAndSubmit(user);
    await waitFor(() => expect(mocks.initialize).toHaveBeenCalled());
    expect(mocks.overview).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("says why a service could not be turned on and waits instead of redirecting past it", async () => {
    mocks.update.mockRejectedValue({
      response: { status: 400, data: { error: "x", code: "VALIDATION_FAILED" } },
    });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <SetupPage />
      </MemoryRouter>
    );
    await user.click(screen.getByRole("button", { name: "setup:freeServices.cta" }));
    await fillAndSubmit(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("setup:freeServices.partialFailed");
    expect(mocks.navigate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "setup:freeServices.continue" }));
    expect(mocks.navigate).toHaveBeenCalledWith("/");
  });
});
