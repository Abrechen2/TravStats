import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ tryReload: vi.fn(), reloadNow: vi.fn() }));

vi.mock("../lib/staleBundle", async () => {
  const actual = await vi.importActual<typeof import("../lib/staleBundle")>("../lib/staleBundle");
  return {
    ...actual,
    tryReloadForStaleBundle: mocks.tryReload,
    reloadNowForStaleBundle: mocks.reloadNow,
  };
});
vi.mock("../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

import ErrorBoundary from "../components/ErrorBoundary";

const originalError = console.error;
beforeEach(() => {
  console.error = vi.fn();
  vi.clearAllMocks();
});
afterEach(() => {
  console.error = originalError;
});

function StaleChunk(): JSX.Element {
  throw new TypeError(
    "Failed to fetch dynamically imported module: http://x/assets/DashboardPage-old.js"
  );
}

describe("ErrorBoundary — a chunk from an older build is gone", () => {
  it("reloads once and says it is loading the new version", () => {
    mocks.tryReload.mockReturnValue(true);
    render(
      <ErrorBoundary fallback={<p>generic crash</p>}>
        <StaleChunk />
      </ErrorBoundary>
    );
    expect(mocks.tryReload).toHaveBeenCalledTimes(1);
    expect(screen.getByText("common:staleBundle.reloading")).toBeInTheDocument();
    expect(screen.queryByText("generic crash")).toBeNull();
  });

  // The guard held (a reload already happened and the page is still stale):
  // a blank view or the generic crash card would be the old behaviour.
  it("explains and offers a reload when the automatic one is used up", () => {
    mocks.tryReload.mockReturnValue(false);
    render(
      <ErrorBoundary fallback={<p>generic crash</p>}>
        <StaleChunk />
      </ErrorBoundary>
    );
    expect(screen.getByText("common:staleBundle.title")).toBeInTheDocument();
    expect(screen.queryByText("generic crash")).toBeNull();
    screen.getByRole("button", { name: "common:staleBundle.reload" }).click();
    expect(mocks.reloadNow).toHaveBeenCalledTimes(1);
  });

  it("leaves an ordinary error to the fallback", () => {
    const Boom = (): JSX.Element => {
      throw new Error("Cannot read properties of undefined");
    };
    render(
      <ErrorBoundary fallback={<p>generic crash</p>}>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByText("generic crash")).toBeInTheDocument();
    expect(mocks.tryReload).not.toHaveBeenCalled();
  });
});
