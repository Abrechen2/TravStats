import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const applyMany = vi.fn();
const rejectMany = vi.fn();
vi.mock("../../../../lib/api/pendingUpdates", () => ({
  pendingUpdatesApi: {
    applyMany: (...a: unknown[]) => applyMany(...a),
    rejectMany: (...a: unknown[]) => rejectMany(...a),
  },
}));
vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, o?: Record<string, unknown>) => (o ? `${key}:${JSON.stringify(o)}` : key),
  }),
}));

import BulkUpdatesBar from "../BulkUpdatesBar";

describe("BulkUpdatesBar (forgejo#397)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("draws nothing when no update is shown", () => {
    const { container } = render(<BulkUpdatesBar ids={[]} reload={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("asks before applying, then applies exactly the shown ids and reloads", async () => {
    applyMany.mockResolvedValue({ requested: 2, applied: 2, failed: 0, results: [] });
    const reload = vi.fn().mockResolvedValue(undefined);
    render(<BulkUpdatesBar ids={["a", "b"]} reload={reload} />);
    await userEvent.click(screen.getByRole("button", { name: /bulk\.apply/ }));
    expect(applyMany).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "pendingUpdates:bulk.yes" }));
    await waitFor(() => expect(applyMany).toHaveBeenCalledWith(["a", "b"]));
    expect(await screen.findByRole("status")).toHaveTextContent("bulk.applyDone");
    expect(reload).toHaveBeenCalled();
  });

  it("reports a partly failed run instead of success", async () => {
    rejectMany.mockResolvedValue({ requested: 2, rejected: 1, failed: 1, results: [] });
    render(<BulkUpdatesBar ids={["a", "b"]} reload={vi.fn().mockResolvedValue(undefined)} />);
    await userEvent.click(screen.getByRole("button", { name: /bulk\.reject/ }));
    await userEvent.click(screen.getByRole("button", { name: "pendingUpdates:bulk.yes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("bulk.partial");
  });

  it("says the call failed and still reloads when the request errors", async () => {
    applyMany.mockRejectedValue(new Error("network"));
    const reload = vi.fn().mockResolvedValue(undefined);
    render(<BulkUpdatesBar ids={["a"]} reload={reload} />);
    await userEvent.click(screen.getByRole("button", { name: /bulk\.apply/ }));
    await userEvent.click(screen.getByRole("button", { name: "pendingUpdates:bulk.yes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("bulk.failed");
    expect(reload).toHaveBeenCalled();
  });

  it("sends more than 200 updates in chunks the server accepts and adds the outcomes up", async () => {
    const ids = Array.from({ length: 450 }, (_, n) => `u${n}`);
    applyMany.mockImplementation(async (part: string[]) => ({
      requested: part.length,
      applied: part.length,
      failed: 0,
      results: [],
    }));
    render(<BulkUpdatesBar ids={ids} reload={vi.fn().mockResolvedValue(undefined)} />);
    await userEvent.click(screen.getByRole("button", { name: /bulk\.apply/ }));
    await userEvent.click(screen.getByRole("button", { name: "pendingUpdates:bulk.yes" }));
    await waitFor(() => expect(applyMany).toHaveBeenCalledTimes(3));
    expect(applyMany.mock.calls.map((c) => (c[0] as string[]).length)).toEqual([200, 200, 50]);
    expect(await screen.findByRole("status")).toHaveTextContent('"count":450');
  });
});
