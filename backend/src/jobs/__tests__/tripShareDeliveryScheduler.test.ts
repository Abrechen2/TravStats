/**
 * The trip-share delivery scheduler (spec 2026-10-20 F7): a pass at start, every 30 seconds, and
 * a second after something was queued — never two nudges into two passes, and nothing once it is
 * stopped. What a pass does is `outbox.ts`'s, mocked here.
 */
jest.mock("../../services/sharing/federation/outbox", () => ({
  runDeliveries: jest.fn().mockResolvedValue({ sent: 0, failed: 0, parked: 0, dropped: 0 }),
}));

import { runDeliveries } from "../../services/sharing/federation/outbox";
import { kickDelivery } from "../../services/sharing/federation/deliveryKick";
import {
  startTripShareDeliveryScheduler,
  stopTripShareDeliveryScheduler,
} from "../tripShareDeliveryScheduler";

const run = runDeliveries as jest.MockedFunction<typeof runDeliveries>;

beforeEach(() => {
  jest.useFakeTimers();
  run.mockClear();
});
afterEach(() => {
  stopTripShareDeliveryScheduler();
  jest.useRealTimers();
});

describe("trip-share delivery scheduler", () => {
  it("runs a pass at start and every 30 seconds", () => {
    startTripShareDeliveryScheduler();
    expect(run).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(30_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("turns any number of nudges within a second into one pass", () => {
    startTripShareDeliveryScheduler();
    run.mockClear();
    kickDelivery();
    kickDelivery();
    kickDelivery();
    expect(run).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("ignores nudges while stopped (tests and a process that never started it)", () => {
    startTripShareDeliveryScheduler();
    stopTripShareDeliveryScheduler();
    run.mockClear();
    kickDelivery();
    jest.advanceTimersByTime(60_000);
    expect(run).not.toHaveBeenCalled();
  });
});
