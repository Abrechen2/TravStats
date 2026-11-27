/**
 * Perf audit 2026-11, item 2: every worker thread carries its own heap limit.
 * The HEIC converter was the one that did not, so it inherited the main
 * process's ceiling.
 */
const constructed: Array<{ resourceLimits?: unknown }> = [];

jest.mock("worker_threads", () => {
  const actual = jest.requireActual("worker_threads");
  class RecordingWorker extends actual.Worker {
    constructor(source: string, options: { resourceLimits?: unknown }) {
      constructed.push(options);
      super(source, options);
    }
  }
  return { ...actual, Worker: RecordingWorker };
});

import {
  convertHeicToJpeg,
  HEIC_WORKER_RESOURCE_LIMITS,
  shutdownHeicConverter,
} from "../heicConverter";

afterAll(() => shutdownHeicConverter());

it("starts the HEIC worker with its own resourceLimits", async () => {
  await convertHeicToJpeg(Buffer.from("not a photo")).catch(() => undefined);
  expect(constructed.length).toBeGreaterThan(0);
  expect(constructed[0].resourceLimits).toEqual(HEIC_WORKER_RESOURCE_LIMITS);
});
