import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import adminDe from "../../../i18n/resources/de/admin.json";

function resolve(bundle: unknown, dottedKey: string): unknown {
  return dottedKey.split(".").reduce<unknown>((acc, part) => {
    if (typeof acc !== "object" || acc === null) return undefined;
    return (acc as Record<string, unknown>)[part];
  }, bundle);
}

// The global setup (src/__tests__/setup.ts) mocks react-i18next's t() to echo
// the raw key, which can't exercise the DE interpolation this test asserts
// on. Override just this hook with a stub that resolves real DE strings from
// admin.json and does {{var}} interpolation, mirroring what react-i18next
// does at runtime.
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const raw = resolve(adminDe, key);
      if (typeof raw !== "string") return key;
      if (!options) return raw;
      return Object.entries(options).reduce(
        (acc, [name, value]) => acc.replace(new RegExp(`{{${name}}}`, "g"), String(value)),
        raw
      );
    },
  }),
}));

import { api } from "../../../lib/api/client";
import AirlineLogoRefreshButton from "../AirlineLogoRefreshButton";

describe("AirlineLogoRefreshButton", () => {
  // api.post/api.get are spied per test; without restoring, a later
  // `vi.spyOn` call on an already-spied method returns the SAME mock and
  // inherits its prior implementation + call history from the previous test.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("triggers a logo refresh and shows the result", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ status: 202, data: {} });
    vi.spyOn(api, "get").mockResolvedValue({
      data: { running: false, checked: 12, refreshed: 3, finishedAt: "2026-07-14T03:00:00Z" },
    });

    render(<AirlineLogoRefreshButton />);
    fireEvent.click(screen.getByRole("button", { name: /logos aktualisieren/i }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/admin/airline-logos/refresh"));
    await waitFor(() => expect(screen.getByText(/3 von 12/i)).toBeTruthy());
  });

  it("shows a failure message when the refresh request itself errors", async () => {
    vi.spyOn(api, "post").mockRejectedValue(new Error("network down"));
    const get = vi.spyOn(api, "get");

    render(<AirlineLogoRefreshButton />);
    fireEvent.click(screen.getByRole("button", { name: /logos aktualisieren/i }));

    await waitFor(() =>
      expect(screen.getByText(/aktualisierung fehlgeschlagen/i)).toBeInTheDocument()
    );
    expect(get).not.toHaveBeenCalled();
  });

  it(
    "treats a 409 (already running) as running and polls until done",
    async () => {
      vi.spyOn(api, "post").mockRejectedValue({
        response: { status: 409, data: { error: "A logo refresh is already running" } },
        isAxiosError: true,
      });
      const get = vi
        .spyOn(api, "get")
        .mockResolvedValueOnce({ data: { running: true, checked: null, refreshed: null } })
        .mockResolvedValueOnce({ data: { running: false, checked: 5, refreshed: 1 } });

      render(<AirlineLogoRefreshButton />);
      fireEvent.click(screen.getByRole("button", { name: /logos aktualisieren/i }));

      await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.getByText(/1 von 5/i)).toBeTruthy(), { timeout: 6000 });
    },
    8000
  );
});
