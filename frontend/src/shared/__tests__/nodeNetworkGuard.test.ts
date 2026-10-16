import http from "node:http";
import https from "node:https";
import { get as namedGet } from "node:https";
import { describe, expect, it, vi } from "vitest";

// The domain project's guard (src/__tests__/setup.node.ts) used to stub only
// `fetch`, so a shared rule that reached the network through node:http or
// node:https ran a real request from a "pure" suite and nothing noticed.
describe("the domain test network guard", () => {
  it.each([
    ["http.get", () => http.get("http://127.0.0.1:9/")],
    ["http.request", () => http.request("http://127.0.0.1:9/")],
    ["https.get", () => https.get("https://127.0.0.1:9/")],
    ["https.request", () => https.request("https://127.0.0.1:9/")],
    ["a named https import", () => namedGet("https://127.0.0.1:9/")],
  ])("refuses %s", (_name, call) => {
    expect(call).toThrow(/unmocked/);
    // The guard also fails the test afterwards when a refusal was swallowed;
    // this test expects the call, so it clears the record.
    vi.mocked(http.get).mockClear();
    vi.mocked(http.request).mockClear();
    vi.mocked(https.get).mockClear();
    vi.mocked(https.request).mockClear();
  });
});
