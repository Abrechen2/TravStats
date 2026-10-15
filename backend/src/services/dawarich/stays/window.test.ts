import { readStayWindow } from "./window";
import type { DawarichClient, DawarichPoint } from "../dawarichClient";
const point: DawarichPoint = {
  id: 1,
  timestampMs: Date.parse("2026-10-14T05:00:00Z"),
  latitude: 33,
  longitude: 126,
  velocity: 1,
  accuracy: 1,
  altitude: null,
  trackId: null,
};
it("recovers a capped full window by reading days and retaining original ids", async () => {
  const getPoints = jest
    .fn()
    .mockResolvedValueOnce({ points: [], truncated: true })
    .mockResolvedValue({ points: [point], truncated: false });
  const client = { getPoints, checkHealth: jest.fn() } as DawarichClient;
  const result = await readStayWindow(
    client,
    new Date("2026-10-13"),
    new Date("2026-10-15"),
    async () => true
  );
  expect(result.points).toEqual([point]);
  expect(result.truncated).toBe(false);
  expect(getPoints).toHaveBeenCalledTimes(3);
});
it("stops a backfill when consent is revoked between windows", async () => {
  let allowed = true;
  const client = {
    getPoints: jest.fn(async () => {
      allowed = false;
      return { points: [], truncated: false };
    }),
    checkHealth: jest.fn(),
  } as DawarichClient;
  const result = await readStayWindow(
    client,
    new Date("2026-10-01"),
    new Date("2026-10-15"),
    async () => allowed
  );
  expect(client.getPoints).toHaveBeenCalledTimes(1);
  expect(result.cancelled).toBe(true);
});
