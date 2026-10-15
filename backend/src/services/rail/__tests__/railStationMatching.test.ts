import { catalogueStationAt } from "../railStations";
import { prisma } from "../../../db";
jest.mock("../../../db", () => ({ prisma: { railStation: { findMany: jest.fn() } } }));
it("matches Munich Hbf (tief) at its own position instead of the nearby UIC-coded main station", async () => {
  const main = { id: 7480, name: "München Hbf", uic: "8020347", lat: 48.140228, lon: 11.558338 };
  const deep = { id: 16779, name: "München Hbf (tief)", uic: null, lat: 48.141172, lon: 11.560496 };
  jest.mocked(prisma.railStation.findMany).mockResolvedValue([main, deep] as never);
  expect(await catalogueStationAt(deep.lat, deep.lon)).toEqual(deep);
  expect(await catalogueStationAt(main.lat, main.lon)).toEqual(main);
  expect(await catalogueStationAt(49, 12)).toBeNull();
});
