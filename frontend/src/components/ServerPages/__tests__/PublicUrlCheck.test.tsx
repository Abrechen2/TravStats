import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";

import PublicUrlCheck from "../PublicUrlCheck";

const api = vi.hoisted(() => ({ checkPublicUrl: vi.fn() }));
vi.mock("../../../lib/api/admin", () => ({ adminApi: api }));
vi.mock("../../../store/readinessShellStore", () => ({
  refreshReadinessShell: vi.fn().mockResolvedValue(undefined),
}));

const result = (over = {}) => ({
  ok: true,
  checkedAt: "2026-11-15T10:00:00.000Z",
  url: "https://trav.example.de",
  httpStatus: 200,
  errorCode: null,
  ...over,
});
const click = () =>
  userEvent.click(screen.getByRole("button", { name: "settings:publicUrlCheck.button" }));
const httpFail = (status: number) =>
  new AxiosError("x", "ERR_BAD_RESPONSE", undefined, undefined, { status } as never);

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("Erreichbarkeit prüfen", () => {
  it("shows ok with the time", async () => {
    api.checkPublicUrl.mockResolvedValue(result());
    render(<PublicUrlCheck unsaved={false} savedUrl="https://a.example" />);
    await click();
    expect(await screen.findByRole("status")).toHaveTextContent("settings:publicUrlCheck.ok");
  });

  it.each([
    "NO_PUBLIC_URL",
    "OUTBOUND_DISABLED",
    "TIMEOUT",
    "DNS",
    "TLS",
    "CONNECTION",
    "HTTP_STATUS",
    "NOT_THIS_INSTANCE",
  ])("names its own sentence for %s", async (code) => {
    api.checkPublicUrl.mockResolvedValue(result({ ok: false, errorCode: code, httpStatus: 502 }));
    render(<PublicUrlCheck unsaved={false} savedUrl="https://a.example" />);
    await click();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      `settings:publicUrlCheck.error.${code}`
    );
  });

  it("says the check did not finish when the request times out on the client", async () => {
    api.checkPublicUrl.mockRejectedValue(new AxiosError("t", "ECONNABORTED"));
    render(<PublicUrlCheck unsaved={false} savedUrl="https://a.example" />);
    await click();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "settings:publicUrlCheck.failed.timeout"
    );
  });

  it("separates a rate limit from a refusal and from a generic failure", async () => {
    api.checkPublicUrl.mockRejectedValueOnce(httpFail(429));
    render(<PublicUrlCheck unsaved={false} savedUrl="https://a.example" />);
    await click();
    expect(await screen.findByRole("alert")).toHaveTextContent("failed.rateLimited");
    api.checkPublicUrl.mockRejectedValueOnce(httpFail(403));
    await click();
    expect(await screen.findByText("settings:publicUrlCheck.failed.forbidden")).toBeInTheDocument();
    api.checkPublicUrl.mockRejectedValueOnce(httpFail(500));
    await click();
    expect(await screen.findByText("settings:publicUrlCheck.failed.generic")).toBeInTheDocument();
  });

  it("is off while the address has unsaved edits and says why", () => {
    render(<PublicUrlCheck unsaved savedUrl="https://a.example" />);
    expect(screen.getByRole("button", { name: "settings:publicUrlCheck.button" })).toBeDisabled();
    expect(screen.getByText("settings:publicUrlCheck.saveFirst")).toBeInTheDocument();
  });

  it("drops a result when the address is edited afterwards", async () => {
    api.checkPublicUrl.mockResolvedValue(result());
    const view = render(<PublicUrlCheck unsaved={false} savedUrl="https://a.example" />);
    await click();
    expect(await screen.findByRole("status")).toBeInTheDocument();
    view.rerender(<PublicUrlCheck unsaved savedUrl="https://a.example" />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("ignores a late answer for an address that changed meanwhile", async () => {
    let answer!: (v: unknown) => void;
    api.checkPublicUrl.mockReturnValue(new Promise((r) => (answer = r)));
    const view = render(<PublicUrlCheck unsaved={false} savedUrl="https://a.example" />);
    await click();
    view.rerender(<PublicUrlCheck unsaved={false} savedUrl="https://b.example" />);
    await act(async () => answer(result()));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
