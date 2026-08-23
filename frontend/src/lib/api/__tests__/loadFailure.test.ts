/**
 * The distinction this file exists for: a 404 says the record is gone, and
 * NOTHING else does. Both detail pages used to turn every failure into
 * "nicht gefunden", so a dropped connection denied a cruise that existed.
 */
import { describe, it, expect } from "vitest";
import { AxiosError, AxiosHeaders } from "axios";
import { classifyLoadFailure, isNotFound } from "../loadFailure";

function axiosErrorWithStatus(status: number): AxiosError {
  const err = new AxiosError("boom");
  err.response = {
    status,
    statusText: "",
    data: null,
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  };
  return err;
}

describe("classifyLoadFailure", () => {
  it("calls a 404 not-found", () => {
    expect(classifyLoadFailure(axiosErrorWithStatus(404))).toBe("notFound");
    expect(isNotFound(axiosErrorWithStatus(404))).toBe(true);
  });

  it("calls a server error a load error, not a missing record", () => {
    expect(classifyLoadFailure(axiosErrorWithStatus(500))).toBe("loadError");
    expect(classifyLoadFailure(axiosErrorWithStatus(502))).toBe("loadError");
  });

  it("calls a network drop a load error — it says nothing about existence", () => {
    // No `response` at all: this is the shape axios produces when the request
    // never reached anyone. It was the case that used to render "nicht
    // gefunden", which is the one claim it cannot support.
    expect(classifyLoadFailure(new AxiosError("Network Error"))).toBe("loadError");
    expect(isNotFound(new AxiosError("Network Error"))).toBe(false);
  });

  it("calls a non-axios throw a load error", () => {
    expect(classifyLoadFailure(new TypeError("undefined is not a function"))).toBe("loadError");
    expect(classifyLoadFailure(null)).toBe("loadError");
    expect(classifyLoadFailure("kaputt")).toBe("loadError");
  });

  it("does not treat a 403 as absence — forbidden is not gone", () => {
    expect(classifyLoadFailure(axiosErrorWithStatus(403))).toBe("loadError");
  });
});
