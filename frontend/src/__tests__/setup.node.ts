import { afterEach, beforeEach, expect, vi } from "vitest";

// Pure domain tests must not perform HTTP requests, even when application
// code catches the rejection. No browser, React or store setup is needed.
const unexpectedFetch = vi
  .fn<typeof fetch>()
  .mockRejectedValue(new Error("A domain test attempted an unmocked fetch"));

beforeEach(() => {
  unexpectedFetch.mockClear();
  vi.stubGlobal("fetch", unexpectedFetch);
});

afterEach(() => {
  try {
    expect(unexpectedFetch, "Domain tests must mock HTTP requests").not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
