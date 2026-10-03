import { afterEach, describe, expect, it, vi } from "vitest";
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";

import { api } from "../../api/client";
import {
  ATTACH_FAILURES,
  attachEntry,
  attachFailureReason,
  type AttachableEntry,
} from "../attachableEntries";
import de from "../../../i18n/resources/de/trips.json";
import en from "../../../i18n/resources/en/trips.json";

const TRIP = "11111111-1111-4111-8111-111111111111";

function httpError(status: number, data: unknown = {}): AxiosError {
  const config = {} as InternalAxiosRequestConfig;
  const response = { status, data, statusText: "", headers: {}, config } as AxiosResponse;
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", config, {}, response);
}

const entry = (domain: AttachableEntry["domain"], parentId?: string): AttachableEntry => ({
  domain,
  id: "e-1",
  parentId,
  title: "x",
  subtitle: null,
  day: null,
  endDay: null,
  tripId: null,
});

describe("attachFailureReason", () => {
  it.each([
    [new AxiosError("Network Error", "ERR_NETWORK"), "network"],
    [new AxiosError("timeout of 10000ms exceeded", "ECONNABORTED"), "timeout"],
    [httpError(404, { error: "Trip not found" }), "notFound"],
    [httpError(403, { error: "DEMO_ACCOUNT_FORBIDDEN", message: "…" }), "demo"],
    [httpError(403, { error: "API token lacks write scope" }), "readOnly"],
    [httpError(409, { error: "…", code: "ROADTRIP_HAS_TRIP_PHOTOS" }), "roadtripPhotos"],
    [httpError(409, { error: "built from a trip's timeline stops" }), "conflict"],
    [httpError(400, { error: "Only a roadtrip can be attached" }), "invalid"],
    [httpError(429), "rateLimited"],
    [httpError(500), "server"],
    [new Error("not an HTTP failure at all"), "server"],
  ])("reads %o as %s", (error, reason) => {
    expect(attachFailureReason(error)).toBe(reason);
  });

  it("has DE and EN copy for every reason, so none can reach the screen as a key", () => {
    for (const reason of ATTACH_FAILURES) {
      expect(de.addExisting.failure[reason], `de ${reason}`).toEqual(expect.any(String));
      expect(en.addExisting.failure[reason], `en ${reason}`).toEqual(expect.any(String));
    }
  });
});

describe("attachEntry", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends each domain's entry through that domain's own write, with the trip and nothing else", async () => {
    const patch = vi.spyOn(api, "patch").mockResolvedValue({ data: { data: {}, route: {} } });
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: {} });

    await attachEntry(TRIP, entry("flight"));
    expect(post).toHaveBeenCalledWith(`/trips/${TRIP}/flights`, {
      flightIds: ["e-1"],
      action: "add",
    });

    await attachEntry(TRIP, entry("cruise"));
    await attachEntry(TRIP, entry("lodging", "l-1"));
    await attachEntry(TRIP, entry("poi", "p-1"));
    await attachEntry(TRIP, entry("rail"));
    await attachEntry(TRIP, entry("rental"));
    await attachEntry(TRIP, entry("roadtrip"));
    expect(patch.mock.calls).toEqual([
      ["/cruises/e-1", { tripId: TRIP }],
      ["/lodging/l-1/stays/e-1", { tripId: TRIP }],
      ["/places/visits/e-1", { tripId: TRIP }],
      ["/rail/e-1", { tripId: TRIP }],
      ["/rentals/e-1", { tripId: TRIP }],
      ["/tours/e-1", { tripId: TRIP }],
    ]);
  });
});
