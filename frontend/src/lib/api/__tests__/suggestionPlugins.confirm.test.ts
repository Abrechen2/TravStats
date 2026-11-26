import { beforeEach, describe, expect, it, vi } from "vitest";

const http = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../client", () => ({ api: http }));

import { suggestionPluginsApi } from "../suggestionPlugins";

/** Owner rule 2026-11-26: a write only with a ticket bound to the values shown. */
describe("maintenance writes go through a confirmation ticket", () => {
  beforeEach(() => {
    http.get.mockReset();
    http.post.mockReset();
  });

  it("applyLocation asks for a ticket for exactly these values, then writes with it", async () => {
    http.post
      .mockResolvedValueOnce({ data: { token: "t-1" } })
      .mockResolvedValueOnce({ data: { undoId: "u" } });
    await suggestionPluginsApi.applyLocation("p1", {
      rowId: "7",
      lat: 1.5,
      lon: 2.5,
      street: "Neue Str. 3",
      town: "Ort",
      source: "manual",
    });
    expect(http.post.mock.calls[0][0]).toBe("/settings/suggestion-plugins/p1/maintenance/confirm");
    expect(http.post.mock.calls[0][1]).toEqual({
      kind: "apply",
      rowId: "7",
      lat: 1.5,
      lon: 2.5,
      street: "Neue Str. 3",
      town: "Ort",
    });
    expect(http.post.mock.calls[1][0]).toBe("/settings/suggestion-plugins/p1/maintenance/apply");
    expect(http.post.mock.calls[1][1]).toMatchObject({
      rowId: "7",
      source: "manual",
      token: "t-1",
    });
  });

  it("a refused ticket writes nothing", async () => {
    http.post.mockRejectedValueOnce({ response: { status: 400, data: { error: "notFound" } } });
    await expect(
      suggestionPluginsApi.applyLocation("p1", { rowId: "404", lat: 1, lon: 2, source: "stop" })
    ).rejects.toBeTruthy();
    expect(http.post).toHaveBeenCalledTimes(1);
  });

  it("undoLocation needs its own ticket", async () => {
    http.post.mockResolvedValueOnce({ data: { token: "t-2" } }).mockResolvedValueOnce({ data: {} });
    await suggestionPluginsApi.undoLocation("p1", "u-1");
    expect(http.post.mock.calls[0][1]).toEqual({ kind: "undo", undoId: "u-1" });
    expect(http.post.mock.calls[1][1]).toEqual({ undoId: "u-1", token: "t-2" });
  });
});
