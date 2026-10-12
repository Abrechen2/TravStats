import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import DawarichStayScanCard from "../../Settings/DawarichStayScanCard";
import { dawarichStaysApi } from "../../../lib/api/dawarichStays";

vi.mock("../../../lib/api/dawarichStays", () => ({
  dawarichStaysApi: { state: vi.fn(), enable: vi.fn(), scan: vi.fn() },
}));
vi.mock("../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
vi.mock("../../../lib/profileInstant", () => ({ profileDateTime: (v: string) => v }));
const state = { enabled: true, connected: true, result: "running", error: null };
const mount = () =>
  render(
    <MemoryRouter>
      <DawarichStayScanCard />
    </MemoryRouter>
  );
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe("Dawarich settings failure recovery", () => {
  it("clears a polling error after the next successful status read", async () => {
    vi.useFakeTimers();
    vi.mocked(dawarichStaysApi.state)
      .mockResolvedValueOnce(state as never)
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValue({ ...state, result: "succeeded" } as never);
    mount();
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(vi.mocked(dawarichStaysApi.state)).toHaveBeenCalledTimes(3);
  });
  it("keeps a failed save visible even when reloading settings succeeds", async () => {
    vi.mocked(dawarichStaysApi.state).mockResolvedValue({ ...state, result: "succeeded" } as never);
    vi.mocked(dawarichStaysApi.enable).mockRejectedValue(new Error("save failed"));
    mount();
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeEnabled());
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(vi.mocked(dawarichStaysApi.state)).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeChecked();
  });
});
