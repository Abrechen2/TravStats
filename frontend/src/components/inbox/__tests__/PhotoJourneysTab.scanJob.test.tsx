import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * The photo-journey scan as a server job (silent-failure fixes, 2026-09-26).
 *
 * Forty seconds is the scan's floor and the client gave up after ten: the
 * inbox said "Die Foto-Suche konnte nicht gestartet werden" while the server
 * went on and stored the findings. The real `photoJourneysApi.scan` and job
 * poll run here; only the HTTP client is stubbed.
 */

vi.mock("../../../lib/api/immich", () => ({
  immichApi: {
    getSettings: vi.fn().mockResolvedValue({
      baseUrl: "https://immich.example",
      hasKey: true,
      defaultMode: "link",
      source: "user",
      isShared: false,
      hasAccess: true,
    }),
  },
}));

const addToast = vi.fn();
const toastState = { addToast: (...args: unknown[]) => addToast(...args) };
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: typeof toastState) => unknown) => selector(toastState),
}));

import { api } from "../../../lib/api/client";
import PhotoJourneysTab from "../PhotoJourneysTab";

const SCAN = "dataQuality:inbox.photoJourneys.scan";

function stubServer(jobAnswers: Array<() => Promise<unknown>>) {
  const answers = [...jobAnswers];
  vi.spyOn(api, "get").mockImplementation(((url: string) => {
    if (url === "/photo-journeys") return Promise.resolve({ data: { success: true, data: [] } });
    const next = answers.length > 1 ? answers.shift()! : answers[0];
    return next();
  }) as never);
  return vi
    .spyOn(api, "post")
    .mockResolvedValue({ data: { success: true, data: { jobId: "job-1" } } } as never);
}

const jobState =
  (status: string, result: unknown = null) =>
  () =>
    Promise.resolve({
      data: { success: true, data: { id: "job-1", status, result, error: null } },
    });

describe("the photo scan reports the job's outcome", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    addToast.mockClear();
  });

  it("a scan that runs past the old timeout ends in its counts, never in 'failed'", async () => {
    const post = stubServer([
      jobState("running"),
      jobState("succeeded", { scanned: true, created: 3, updated: 1 }),
    ]);
    render(
      <MemoryRouter>
        <PhotoJourneysTab active />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole("button", { name: SCAN }));

    await waitFor(
      () =>
        expect(addToast).toHaveBeenCalledWith(
          "success",
          "dataQuality:inbox.photoJourneys.messages.scanned"
        ),
      { timeout: 4000 }
    );
    expect(addToast).not.toHaveBeenCalledWith("error", expect.anything());
    expect(post).toHaveBeenCalledWith("/photo-journeys/scan", { background: true });
  });

  it("an outcome the server forgot is 'unknown', and the list is read again", async () => {
    stubServer([() => Promise.reject({ isAxiosError: true, response: { status: 404 } })]);
    render(
      <MemoryRouter>
        <PhotoJourneysTab active />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole("button", { name: SCAN }));

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith(
        "info",
        "dataQuality:inbox.photoJourneys.messages.scanOutcomeUnknown"
      )
    );
    expect(addToast).not.toHaveBeenCalledWith("error", expect.anything());
  });
});
