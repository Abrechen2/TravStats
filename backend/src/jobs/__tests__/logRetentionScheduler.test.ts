const enforceLogRetention = jest.fn(async () => {});
const pruneRouteStores = jest.fn(async () => {});
jest.mock("../../services/logRetention", () => ({ enforceLogRetention }));
jest.mock("../../services/routing/routeStore", () => ({ pruneRouteStores }));
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { runLogRetention } from "../logRetentionScheduler";

describe("nightly storage retention", () => {
  beforeEach(() => jest.clearAllMocks());
  // The durable route files had no sweep at all; they ride on this nightly job.
  it("prunes the route files alongside the logs", async () => {
    await runLogRetention();
    expect(enforceLogRetention).toHaveBeenCalledTimes(1);
    expect(pruneRouteStores).toHaveBeenCalledTimes(1);
  });
  it("still prunes routes when the log sweep fails", async () => {
    enforceLogRetention.mockRejectedValueOnce(new Error("disk"));
    await runLogRetention();
    expect(pruneRouteStores).toHaveBeenCalledTimes(1);
  });
});
