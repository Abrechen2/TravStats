import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChangeHistorySection from "../ChangeHistorySection";
import { formatChangeValue } from "../formatChangeValue";
import { changeHistoryApi, type ChangeHistoryEntry } from "../../../lib/api/changeHistory";

vi.mock("../../../lib/api/changeHistory", () => ({
  changeHistoryApi: { forEntry: vi.fn(), restore: vi.fn() },
}));
vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
const api = vi.mocked(changeHistoryApi);

const row = (over: Partial<ChangeHistoryEntry> = {}): ChangeHistoryEntry => ({
  id: "00000000-0000-4000-8000-000000000001",
  changeSetId: "cs1",
  entityType: "flight",
  entityId: "f1",
  operation: "update",
  field: "seatNumber",
  oldValue: "12A",
  newValue: "30F",
  valueType: "String",
  omitted: false,
  label: "LH400",
  source: "web",
  actor: "self",
  reason: null,
  restoredFromId: null,
  restorable: true,
  createdAt: "2026-11-22T10:00:00.000Z",
  ...over,
});

const axiosError = (code: string) =>
  Object.assign(new Error("Request failed"), {
    isAxiosError: true,
    response: { status: 409, data: { code, error: "x" } },
  });

describe("change history on an entry's detail page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists who changed what, from → to", async () => {
    api.forEntry.mockResolvedValue({ entries: [row()], nextCursor: null });
    render(<ChangeHistorySection entityType="flight" entityId="f1" />);
    expect(api.forEntry).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("change-history-open"));
    const line = await screen.findByTestId("change-history-row");
    expect(line).toHaveTextContent("changeHistory:field.seatNumber");
    expect(line).toHaveTextContent("12A → 30F");
    expect(line).toHaveTextContent("changeHistory:source.web · changeHistory:actor.self");
    expect(api.forEntry).toHaveBeenCalledWith("flight", "f1");
  });

  it("restores a value, then reloads the entry and the history", async () => {
    api.forEntry.mockResolvedValue({ entries: [row()], nextCursor: null });
    api.restore.mockResolvedValue([row({ id: "r2", restoredFromId: row().id })]);
    const onRestored = vi.fn();
    render(<ChangeHistorySection entityType="flight" entityId="f1" onRestored={onRestored} />);
    await userEvent.click(screen.getByTestId("change-history-open"));
    await userEvent.click(await screen.findByTestId("change-history-restore"));
    await waitFor(() => expect(onRestored).toHaveBeenCalled());
    expect(api.restore).toHaveBeenCalledWith(row().id);
    expect(api.forEntry).toHaveBeenCalledTimes(2);
  });

  it("says why a restore was refused, visibly, and changes nothing", async () => {
    api.forEntry.mockResolvedValue({ entries: [row()], nextCursor: null });
    api.restore.mockRejectedValue(axiosError("CHANGE_NOT_RESTORABLE"));
    const onRestored = vi.fn();
    render(<ChangeHistorySection entityType="flight" entityId="f1" onRestored={onRestored} />);
    await userEvent.click(screen.getByTestId("change-history-open"));
    await userEvent.click(await screen.findByTestId("change-history-restore"));
    expect(await screen.findByRole("alert")).toHaveTextContent("changeHistory:restoreRefused");
    expect(onRestored).not.toHaveBeenCalled();
  });

  it("shows a failed load as a failure with a retry, not as an empty history", async () => {
    api.forEntry.mockRejectedValueOnce(new Error("Network Error"));
    api.forEntry.mockResolvedValueOnce({ entries: [], nextCursor: null });
    render(<ChangeHistorySection entityType="bus" entityId="b1" />);
    await userEvent.click(screen.getByTestId("change-history-open"));
    expect(await screen.findByRole("alert")).toHaveTextContent("changeHistory:loadFailed");
    expect(screen.queryByText("changeHistory:empty")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "changeHistory:retry" }));
    expect(await screen.findByText("changeHistory:empty")).toBeInTheDocument();
  });

  it("offers no restore on a time, an omitted value or a delete", async () => {
    api.forEntry.mockResolvedValue({
      entries: [
        row({ id: "a", field: "departureTime", valueType: "DateTime", restorable: false }),
        row({ id: "b", omitted: true, restorable: false, oldValue: null, newValue: null }),
        row({ id: "c", operation: "delete", field: null, restorable: false }),
      ],
      nextCursor: null,
    });
    render(<ChangeHistorySection entityType="flight" entityId="f1" />);
    await userEvent.click(screen.getByTestId("change-history-open"));
    expect(await screen.findAllByTestId("change-history-row")).toHaveLength(3);
    expect(screen.queryByTestId("change-history-restore")).toBeNull();
    expect(screen.getByText("changeHistory:notRestorableTime")).toBeInTheDocument();
    expect(screen.getByText("changeHistory:deleted")).toBeInTheDocument();
  });
});

describe("formatChangeValue", () => {
  const words = { dateTime: (iso: string) => `D(${iso})`, empty: "–", yes: "Y", no: "N" };
  it("reads the ledger's JSON values", () => {
    expect(formatChangeValue(null, "String", "notes", words)).toBe("–");
    expect(formatChangeValue(["a", "b"], "String", "tags", words)).toBe("a, b");
    expect(formatChangeValue(true, "Boolean", "isCodeshare", words)).toBe("Y");
    expect(formatChangeValue("2026-01-01T06:00:00.000Z", "DateTime", "departureUtc", words)).toBe(
      "D(2026-01-01T06:00:00.000Z) UTC"
    );
    expect(formatChangeValue(12.5, "Float", "price", words)).toBe("12.5");
  });
});
