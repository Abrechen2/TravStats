import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../client";
import {
  REMOTE_PLAN_ENDED_EVENT,
  RemotePlanRouteRefused,
  mapRemotePath,
  remotePlanHttp,
  remotePlanPath,
  setRemotePlanSource,
} from "../remotePlans";

const source = {
  connectionId: "11111111-1111-4111-8111-111111111111",
  planId: "22222222-2222-4222-8222-222222222222",
  tripId: "33333333-3333-4333-8333-333333333333",
};
const base = `/remote-plans/${source.connectionId}/${source.planId}`;
const DOC = "44444444-4444-4444-8444-444444444444";

afterEach(() => {
  setRemotePlanSource(null);
  vi.restoreAllMocks();
});

describe("mapRemotePath", () => {
  it.each([
    [`/trips/${source.tripId}/plan`, base],
    [`/trips/${source.tripId}/plan/mutations`, `${base}/mutations`],
    [`/trips/${source.tripId}/plan/collab`, `${base}/collab`],
    [`/trips/${source.tripId}/plan/notices/read`, `${base}/notices/read`],
    [`/trips/${source.tripId}/plan/documents`, `${base}/documents`],
    [`/trips/${source.tripId}/plan/documents/${DOC}/file`, `${base}/documents/${DOC}/file`],
    [`/trips/${source.tripId}/plan/export`, `${base}/export`],
  ])("maps %s", (url, expected) => {
    expect(mapRemotePath(url, source)).toBe(expected);
  });

  it.each([
    "/trips/other/plan",
    `/trips/${source.tripId}/plan/forecast`,
    `/trips/${source.tripId}/plan/members`,
    `/trips/${source.tripId}/plan/proposals`,
    `/trips/${source.tripId}/plan/delete-preview`,
    `/trips/${source.tripId}/plan/documents/not-an-id/file`,
    "/travplan/places",
    "/travplan/plans",
    "/auth/me",
  ])("refuses %s: a member is offered nothing the host does not serve", (url) => {
    expect(mapRemotePath(url, source)).toBeNull();
  });

  it("builds the plan's address on the member's server", () => {
    expect(remotePlanPath(source)).toBe(`/plan/remote/${source.connectionId}/${source.planId}`);
  });
});

describe("remotePlanHttp", () => {
  it("unwraps the envelope and keeps the status, headers and a 304 without a body", async () => {
    setRemotePlanSource(source);
    const get = vi
      .spyOn(api, "get")
      .mockResolvedValueOnce({ status: 200, data: { success: true, data: { revision: 4 } } })
      .mockResolvedValueOnce({ status: 304, data: "" });
    const first = await remotePlanHttp.get(`/trips/${source.tripId}/plan`);
    expect(first.data).toEqual({ revision: 4 });
    expect(get).toHaveBeenCalledWith(
      base,
      expect.objectContaining({ timeout: expect.any(Number) })
    );
    const second = await remotePlanHttp.get(`/trips/${source.tripId}/plan`, {
      headers: { "If-None-Match": '"4-x"' },
    });
    expect(second.status).toBe(304);
    expect(second.data).toBe("");
  });

  it("refuses a path the host does not serve before any request leaves", async () => {
    setRemotePlanSource(source);
    const post = vi.spyOn(api, "post");
    await expect(
      remotePlanHttp.post(`/trips/${source.tripId}/plan/forecast`, {})
    ).rejects.toBeInstanceOf(RemotePlanRouteRefused);
    await expect(remotePlanHttp.get("/travplan/places")).rejects.toMatchObject({
      code: "REMOTE_PLAN_ROUTE_REFUSED",
    });
    expect(post).not.toHaveBeenCalled();
  });

  it("refuses everything while no remote plan is open", async () => {
    await expect(remotePlanHttp.get(`/trips/${source.tripId}/plan`)).rejects.toBeInstanceOf(
      RemotePlanRouteRefused
    );
  });

  it("announces that the plan ended when the host or this server says it is no longer shared", async () => {
    setRemotePlanSource(source);
    const ended = vi.fn();
    window.addEventListener(REMOTE_PLAN_ENDED_EVENT, ended);
    const failure = (status: number, code: string) =>
      Object.assign(new Error("x"), {
        isAxiosError: true,
        response: { status, data: { code } },
      });
    vi.spyOn(api, "get")
      .mockRejectedValueOnce(failure(503, "REMOTE_PLAN_UNREACHABLE"))
      .mockRejectedValueOnce(failure(403, "REMOTE_PLAN_NOT_SHARED"));
    await expect(remotePlanHttp.get(`/trips/${source.tripId}/plan`)).rejects.toBeDefined();
    // A host that is offline ends nothing: the queue and the cache stay.
    expect(ended).not.toHaveBeenCalled();
    await expect(remotePlanHttp.get(`/trips/${source.tripId}/plan`)).rejects.toBeDefined();
    expect(ended).toHaveBeenCalledTimes(1);
    window.removeEventListener(REMOTE_PLAN_ENDED_EVENT, ended);
  });
});
