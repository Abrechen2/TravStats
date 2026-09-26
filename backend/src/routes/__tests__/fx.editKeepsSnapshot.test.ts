import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import * as fx from "../../services/fx/resolver";
import { flightFxColumnsIfChanged } from "../../services/xlsxImport/fxSnapshot";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

/**
 * An edit keeps a good FX snapshot (silent-failure fixes, 2026-09-26).
 *
 * "Did the price change?" was answered by "was the price SENT?". The edit
 * dialogs send price, currency and date on every save, so changing only the
 * seat re-snapshotted the flight — and with the rate providers down, the
 * failed lookup wrote nulls over `priceBase` and `fxRate`, dropping the flight
 * out of every converted total. The same happened to every row of an export
 * imported back. These pin what the stored row holds afterwards, with the
 * rate lookup failing (`convertToBase` → null; no network is reached).
 */
describe("editing a priced record while the FX lookup fails", () => {
  let userId: string;
  let cookie: string;
  let portId: number;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "fx-edit-keeps" } });
    const user = await prisma.user.create({
      data: { username: "fx-edit-keeps", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    await prisma.userSettings.create({ data: { userId, data: {}, baseCurrency: "EUR" } });
    const port = await prisma.port.findFirst({ where: { isUserAdded: false } });
    if (!port) throw new Error("Missing seeded port — run seeders first");
    portId = port.id;
  });

  beforeEach(() => {
    jest.spyOn(fx, "convertToBase").mockResolvedValue(null);
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const SNAPSHOT = {
    priceBase: 276,
    fxRate: 0.92,
    fxRateDate: new Date("2026-06-01T00:00:00Z"),
    fxBaseCurrency: "EUR",
    fxSource: "ecb",
  };

  const flight = () =>
    prisma.flight.create({
      data: {
        userId,
        flightNumber: "LH400",
        airline: "Lufthansa",
        depIata: "FRA",
        depLat: 50.03,
        depLon: 8.56,
        arrIata: "JFK",
        arrLat: 40.64,
        arrLon: -73.78,
        departureTime: new Date("2026-06-01T09:00:00Z"),
        status: "scheduled",
        price: 300,
        currency: "USD",
        ...SNAPSHOT,
      },
    });

  /** What the flight dialog sends on every save, whatever changed. */
  const dialogSave = (id: string, changes: Record<string, unknown>) =>
    request(app)
      .put(`/api/v1/flights/${id}`)
      .set("Cookie", cookie)
      .send({
        price: 300,
        currency: "USD",
        departureLocal: "2026-06-01T11:00",
        depTimezone: "Europe/Berlin",
        ...changes,
      });

  it("a seat-only save keeps the snapshot and asks for no rate", async () => {
    const f = await flight();
    const res = await dialogSave(f.id, { seatNumber: "12A" });

    expect(res.status).toBe(200);
    expect(res.body.fxSnapshot).toBe("unchanged");
    const stored = await prisma.flight.findUniqueOrThrow({ where: { id: f.id } });
    expect(stored).toMatchObject({ seatNumber: "12A", priceBase: 276, fxRate: 0.92 });
    expect(fx.convertToBase).not.toHaveBeenCalled();
  });

  it("a new price re-priced with the stored rate when no new rate can be had, and says so", async () => {
    const f = await flight();
    const res = await dialogSave(f.id, { price: 400 });

    expect(res.body.fxSnapshot).toBe("keptStoredRate");
    const stored = await prisma.flight.findUniqueOrThrow({ where: { id: f.id } });
    expect(stored).toMatchObject({ price: 400, priceBase: 368, fxRate: 0.92, fxSource: "ecb" });
  });

  it("a new currency leaves no rate to keep: cleared, and reported as a failed lookup", async () => {
    const f = await flight();
    const res = await dialogSave(f.id, { currency: "GBP" });

    expect(res.body.fxSnapshot).toBe("lookupFailed");
    const stored = await prisma.flight.findUniqueOrThrow({ where: { id: f.id } });
    expect(stored).toMatchObject({ currency: "GBP", priceBase: null, fxRate: null });
  });

  it("a cruise's cabin-only save keeps its snapshot", async () => {
    const cruise = await prisma.cruise.create({
      data: {
        userId,
        departurePortId: portId,
        arrivalPortId: portId,
        startDate: new Date("2026-08-01T12:00:00Z"),
        endDate: new Date("2026-08-08T10:00:00Z"),
        status: "scheduled",
        price: 300,
        currency: "USD",
        ...SNAPSHOT,
      },
    });

    const res = await request(app)
      .patch(`/api/v1/cruises/${cruise.id}`)
      .set("Cookie", cookie)
      .send({
        price: 300,
        currency: "USD",
        startDate: "2026-08-01T12:00:00Z",
        cabinNumber: "8123",
      });

    expect(res.status).toBe(200);
    expect(res.body.fxSnapshot).toBe("unchanged");
    expect(res.body.data).toMatchObject({ cabinNumber: "8123", priceBase: 276, fxRate: 0.92 });
  });

  it("the spreadsheet import leaves an unchanged row's snapshot alone", async () => {
    const f = await flight();
    const refresh = await flightFxColumnsIfChanged(
      userId,
      { price: 300, currency: "USD", departureTime: new Date("2026-06-01T09:00:00Z") },
      f
    );
    expect(refresh).toEqual({ columns: {}, outcome: "unchanged" });
    expect(fx.convertToBase).not.toHaveBeenCalled();
  });
});
