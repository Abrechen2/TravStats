import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../client", () => ({ api: { get: vi.fn() } }));

import { api } from "../client";
import { travTrackApi } from "../travtrack";

const get = vi.mocked(api.get);

describe("travTrackApi.exportFile", () => {
  beforeEach(() => {
    get.mockReset();
  });

  const part = (headers: Record<string, string>) => ({ data: new Blob(["{}"]), headers });

  it("carries the continuation's cursor with its span, and sends it back", async () => {
    get.mockResolvedValue(
      part({
        "x-travtrack-coverage": "truncated",
        "x-travtrack-next": "2026-10-12T00:01:00.000Z",
        "x-travtrack-until": "2026-10-13T00:00:00.000Z",
        "x-travtrack-cursor": "1791763260000:42",
      })
    );
    const first = await travTrackApi.exportFile(
      { fromDay: "2026-10-12", toDay: "2026-10-12" },
      "json"
    );
    expect(first.rest).toEqual({
      from: "2026-10-12T00:01:00.000Z",
      to: "2026-10-13T00:00:00.000Z",
      cursor: "1791763260000:42",
    });
    get.mockResolvedValue(part({ "x-travtrack-coverage": "complete" }));
    await travTrackApi.exportFile(first.rest!, "json");
    expect(get).toHaveBeenLastCalledWith("/travtrack/export", {
      params: { ...first.rest, format: "json" },
      responseType: "blob",
    });
  });

  it("names no rest without a cursor: a continuation by time alone repeats an instant", async () => {
    get.mockResolvedValue(
      part({
        "x-travtrack-coverage": "truncated",
        "x-travtrack-next": "2026-10-12T00:01:00.000Z",
        "x-travtrack-until": "2026-10-13T00:00:00.000Z",
      })
    );
    const res = await travTrackApi.exportFile(
      { fromDay: "2026-10-12", toDay: "2026-10-12" },
      "json"
    );
    expect(res.rest).toBeNull();
  });
});
