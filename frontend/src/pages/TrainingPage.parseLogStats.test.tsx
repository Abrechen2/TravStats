import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";

// Mock react-router-dom navigate
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock stores
vi.mock("../store/authStore");
vi.mock("../store/toastStore");

// Mock APIs — use plain vi.fn() so implementations can be set in beforeEach
vi.mock("../lib/api", () => ({
  trainingApi: {
    upload: vi.fn(),
    getParseLogStats: vi.fn(),
  },
  settingsApi: {
    getDeveloperMode: vi.fn(),
  },
}));

// Mock logger
vi.mock("../lib/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock useTranslation
vi.mock("../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));

// Mock child components to keep tests focused
vi.mock("../components/NavigationBar", () => ({
  default: () => <div data-testid="navigation-bar" />,
}));

vi.mock("../components/Training/TrainingDashboard", () => ({
  default: () => <div data-testid="training-dashboard" />,
}));

vi.mock("../components/Training/EmailAnnotation", () => ({
  default: () => <div data-testid="email-annotation" />,
}));

vi.mock("../components/Training/BoardingPassAnnotation", () => ({
  default: () => <div data-testid="boarding-pass-annotation" />,
}));

vi.mock("../components/Training/TrainingGuide", () => ({
  default: () => <div data-testid="training-guide" />,
}));

vi.mock("../components/Help/InlineHelp", () => ({
  default: () => <div data-testid="inline-help" />,
}));

vi.mock("../components/Training/ParseLogStats", () => ({
  default: () => <div data-testid="parse-log-stats" />,
}));

import { useAuthStore } from "../store/authStore";
import { useToastStore } from "../store/toastStore";
import { settingsApi, trainingApi } from "../lib/api";
import type { User, ParseLogStats as ParseLogStatsType } from "../types/index";
import TrainingPage from "./TrainingPage";

const mockUseAuthStore = vi.mocked(useAuthStore);
const mockUseToastStore = vi.mocked(useToastStore);
const mockGetDeveloperMode = vi.mocked(settingsApi.getDeveloperMode);
const mockGetParseLogStats = vi.mocked(trainingApi.getParseLogStats);

const adminUser: User = {
  id: "1",
  username: "admin",
  isAdmin: true,
  canTrainLLM: true,
};

const regularUser: User = {
  id: "2",
  username: "user",
  isAdmin: false,
  canTrainLLM: true,
};

type AuthStoreState = Parameters<Parameters<typeof useAuthStore>[0]>[0];

/**
 * Mock useAuthStore with a specific user.
 * useAuthStore is called with a selector (s) => s.user in TrainingPage,
 * so mockImplementation must apply the selector to a fake state object.
 */
function mockAuthStoreWithUser(user: User): void {
  const fakeState: AuthStoreState = {
    user,
    _hasHydrated: true,
    setAuth: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    setHasHydrated: vi.fn(),
  };
  mockUseAuthStore.mockImplementation((selector: (state: AuthStoreState) => unknown) =>
    selector(fakeState)
  );
}

function renderTrainingPage() {
  return render(
    <BrowserRouter>
      <TrainingPage />
    </BrowserRouter>
  );
}

describe("TrainingPage — ParseLogStats tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDeveloperMode.mockResolvedValue({ enabled: true, confirmedAt: null });
    mockGetParseLogStats.mockResolvedValue({
      totalLogs: 0,
      overallHitRate: 0,
      byAirline: [],
    } as ParseLogStatsType);
    mockUseToastStore.mockReturnValue({
      addToast: vi.fn(),
    } as ReturnType<typeof useToastStore>);
  });

  it("shows the Parse Logs tab button for admin users", async () => {
    mockAuthStoreWithUser(adminUser);

    await act(async () => {
      renderTrainingPage();
    });

    await waitFor(() => {
      expect(screen.getByText("training:parseLogs.title")).toBeInTheDocument();
    });
  });

  it("does not show the Parse Logs tab button for non-admin users", async () => {
    mockAuthStoreWithUser(regularUser);

    await act(async () => {
      renderTrainingPage();
    });

    await waitFor(() => {
      // Non-admin sees the upload tab but not the parse-logs tab
      expect(screen.getByText("training:uploadAnnotation")).toBeInTheDocument();
    });

    expect(screen.queryByText("training:parseLogs.title")).not.toBeInTheDocument();
  });

  it("renders ParseLogStats component when admin clicks the Parse Logs tab", async () => {
    mockAuthStoreWithUser(adminUser);

    await act(async () => {
      renderTrainingPage();
    });

    await waitFor(() => {
      expect(screen.getByText("training:parseLogs.title")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("training:parseLogs.title"));

    expect(screen.getByTestId("parse-log-stats")).toBeInTheDocument();
  });

  it("does not render ParseLogStats on initial load (upload tab is default)", async () => {
    mockAuthStoreWithUser(adminUser);

    await act(async () => {
      renderTrainingPage();
    });

    await waitFor(() => {
      // Wait for developer mode to resolve and the main UI to show
      expect(screen.getByText("training:uploadAnnotation")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("parse-log-stats")).not.toBeInTheDocument();
  });
});
