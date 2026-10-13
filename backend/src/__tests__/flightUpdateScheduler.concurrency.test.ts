import type { ScheduledTask } from "node-cron";

jest.mock("node-cron", () => ({ schedule: jest.fn() }));
jest.mock("../services/flightAutoUpdate", () => ({ checkAndUpdateAllFlights: jest.fn() }));
jest.mock("../services/pendingUpdateService", () => ({ cleanupExpiredUpdates: jest.fn() }));
jest.mock("../shared/time/schedulerZone", () => ({ schedulerZone: () => "UTC" }));
jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import cron from "node-cron";
import { checkAndUpdateAllFlights } from "../services/flightAutoUpdate";
import { cleanupExpiredUpdates } from "../services/pendingUpdateService";
import {
  startFlightUpdateScheduler,
  stopFlightUpdateScheduler,
  runManualUpdateCheck,
} from "../jobs/flightUpdateScheduler";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const update = jest.mocked(checkAndUpdateAllFlights);
const cleanup = jest.mocked(cleanupExpiredUpdates);
let tick: () => Promise<void>;

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(cron.schedule).mockImplementation((_expression, callback) => {
    tick = callback as () => Promise<void>;
    return { stop: jest.fn() } as unknown as ScheduledTask;
  });
  update.mockResolvedValue(2);
  cleanup.mockResolvedValue(3);
});
afterEach(() => stopFlightUpdateScheduler());

it("shares one run between cron ticks and manual callers, then allows a fresh run", async () => {
  const pending = deferred<number>();
  update.mockReturnValueOnce(pending.promise);
  startFlightUpdateScheduler();
  const first = tick();
  const second = tick();
  const manual = runManualUpdateCheck();
  await Promise.resolve();
  expect(update).toHaveBeenCalledTimes(1);
  pending.resolve(7);
  await expect(manual).resolves.toEqual({ updatesCreated: 7, expiredCount: 3 });
  await Promise.all([first, second]);
  expect(cleanup).toHaveBeenCalledTimes(1);
  await expect(runManualUpdateCheck()).resolves.toEqual({ updatesCreated: 2, expiredCount: 3 });
  expect(update).toHaveBeenCalledTimes(2);
});

it("keeps the lock through cleanup and scheduler stop/start", async () => {
  const pending = deferred<number>();
  const cleanupStarted = deferred<void>();
  cleanup.mockImplementationOnce(() => {
    cleanupStarted.resolve();
    return pending.promise;
  });
  startFlightUpdateScheduler();
  const first = tick();
  await cleanupStarted.promise;
  stopFlightUpdateScheduler();
  startFlightUpdateScheduler();
  const second = tick();
  const manual = runManualUpdateCheck();
  pending.resolve(4);
  await Promise.all([first, second]);
  await expect(manual).resolves.toEqual({ updatesCreated: 2, expiredCount: 4 });
  expect(update).toHaveBeenCalledTimes(1);
  expect(cleanup).toHaveBeenCalledTimes(1);
});

it.each(["update", "cleanup"])("releases the lock after a rejected %s", async (step) => {
  const failing = step === "update" ? update : cleanup;
  failing.mockRejectedValueOnce(new Error("failed"));
  const results = await Promise.allSettled([runManualUpdateCheck(), runManualUpdateCheck()]);
  expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
  expect(update).toHaveBeenCalledTimes(1);
  await expect(runManualUpdateCheck()).resolves.toEqual({ updatesCreated: 2, expiredCount: 3 });
  expect(update).toHaveBeenCalledTimes(2);
});
