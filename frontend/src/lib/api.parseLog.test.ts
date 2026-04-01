import { describe, it, expect, vi } from "vitest";

vi.mock("./api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./api")>();
  return {
    ...mod,
    trainingApi: {
      ...mod.trainingApi,
      getParseLogStats: vi.fn(),
      exportParseLogs: vi.fn(),
      promoteCorrections: vi.fn(),
    },
  };
});

import { trainingApi } from "./api";

describe("trainingApi parse log methods", () => {
  it("getParseLogStats is defined", () => {
    expect(typeof trainingApi.getParseLogStats).toBe("function");
  });

  it("exportParseLogs is defined", () => {
    expect(typeof trainingApi.exportParseLogs).toBe("function");
  });

  it("promoteCorrections is defined", () => {
    expect(typeof trainingApi.promoteCorrections).toBe("function");
  });
});
