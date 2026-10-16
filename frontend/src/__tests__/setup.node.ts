import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { afterEach, beforeEach, expect, vi, type MockInstance } from "vitest";

// Pure domain tests must not perform HTTP requests, even when application
// code catches the rejection. No browser, React or store setup is needed.
const unexpectedFetch = vi
  .fn<typeof fetch>()
  .mockRejectedValue(new Error("A domain test attempted an unmocked fetch"));

// `fetch` alone left node:http and node:https open: a shared rule reaching the
// network through them ran a real request from a "pure" suite unnoticed.
const refuse = (name: string) => (): never => {
  throw new Error(`A domain test attempted an unmocked ${name}`);
};
let nodeRequests: MockInstance[] = [];

beforeEach(() => {
  unexpectedFetch.mockClear();
  vi.stubGlobal("fetch", unexpectedFetch);
  nodeRequests = [
    vi.spyOn(http, "request").mockImplementation(refuse("http.request")),
    vi.spyOn(http, "get").mockImplementation(refuse("http.get")),
    vi.spyOn(https, "request").mockImplementation(refuse("https.request")),
    vi.spyOn(https, "get").mockImplementation(refuse("https.get")),
  ];
  // Named imports (`import { get } from "node:https"`) read the ESM view.
  syncBuiltinESMExports();
});

afterEach(() => {
  try {
    expect(unexpectedFetch, "Domain tests must mock HTTP requests").not.toHaveBeenCalled();
    for (const spy of nodeRequests) {
      expect(spy, "Domain tests must mock node:http/node:https requests").not.toHaveBeenCalled();
    }
  } finally {
    vi.unstubAllGlobals();
    for (const spy of nodeRequests) spy.mockRestore();
    syncBuiltinESMExports();
  }
});
