import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { prisma } from "../../../db";
import { JWT_SECRET } from "../../../utils/jwtSecret";
import travplanRouter from "../../../routes/travplan";
import { errorHandler } from "../../../middleware/errorHandler";

// The instance beta switch is a global row other suites flip; the gate itself is tested in
// travplanBetaGate.integration.test.ts.
jest.mock("../availability", () => ({
  travPlanOffered: async () => true,
  assertTravPlanOffered: async () => undefined,
  travPlanUserEnabled: async () => true,
  assertTravPlanForUser: async () => undefined,
}));
import { bookingSchema } from "../schema";

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api/v1", travplanRouter);
app.use(errorHandler);
let owner: string;
const cookie = () => "auth_token=" + jwt.sign({ userId: owner, epoch: 0 }, JWT_SECRET);
const post = (url: string, body: object) =>
  request(app)
    .post("/api/v1" + url)
    .set("Cookie", cookie())
    .send(body);
beforeAll(async () => {
  owner = (
    await prisma.user.create({
      data: { username: "plan-exec-" + randomUUID(), passwordHash: "not-a-login-password" },
    })
  ).id;
  await prisma.travelPlanConfig.upsert({
    where: { id: "default" },
    create: { enabled: true },
    update: { enabled: true },
  });
});
afterAll(async () => {
  await prisma.user.delete({ where: { id: owner } });
  await prisma.$disconnect();
});
async function create() {
  const response = await post("/travplan/plans", {
    name: "Execution trip",
    clientRef: randomUUID(),
    settings: { destination: "Tokyo", startDay: "2026-01-01", endDay: "2026-01-05" },
  });
  expect(response.status).toBe(201);
  return response.body;
}
const write = (plan: { tripId: string; revision: number }, operation: unknown) =>
  post("/trips/" + plan.tripId + "/plan/mutations", {
    operation,
    clientRef: randomUUID(),
    baseRevision: plan.revision,
  });
const hotel = (extra: Record<string, unknown> = {}) =>
  bookingSchema.parse({
    id: randomUUID(),
    kind: "hotel",
    title: "Plan execution hotel " + randomUUID(),
    reference: null,
    provider: "",
    day: "2026-01-01",
    endDay: "2026-01-03",
    time: "15:00",
    timezone: "Asia/Tokyo",
    amount: 300,
    paid: 300,
    currency: "EUR",
    place: "Tokyo",
    documentIds: [],
    source: "manual",
    details: { checkOutTime: "11:00" },
    ...extra,
  });
async function confirmHotel(booking: ReturnType<typeof hotel>) {
  const p = await create();
  const a = await write(p, { type: "upsert", collection: "bookings", value: booking });
  expect(a.status).toBe(200);
  const item = a.body.state.items.find((i: { bookingId: string }) => i.bookingId === booking.id);
  const b = await write(a.body, { type: "execution", id: item.id, execution: "confirmed" });
  expect(b.status).toBe(200);
  return { p, item, confirmed: b.body };
}

it("confirms a hotel again when an un-confirmation is undone", async () => {
  // Un-confirming deleted the actual Booking row; undo restored a state that still named it,
  // and actualBooking refused the missing row with 409 every time.
  const { p, item, confirmed } = await confirmHotel(hotel());
  const unconfirmed = await write(confirmed, {
    type: "execution",
    id: item.id,
    execution: "unconfirmed",
  });
  expect(unconfirmed.status).toBe(200);
  expect(await prisma.lodgingStay.count({ where: { tripId: p.tripId } })).toBe(0);
  expect(await prisma.booking.count({ where: { tripId: p.tripId } })).toBe(0);
  const undone = await write(unconfirmed.body, {
    type: "undo",
    mutationId: unconfirmed.body.lastMutationId,
  });
  expect(undone.status).toBe(200);
  expect(await prisma.lodgingStay.count({ where: { tripId: p.tripId } })).toBe(1);
  const booking = await prisma.booking.findFirstOrThrow({ where: { tripId: p.tripId } });
  expect(undone.body.state.bookings[0].actualBookingId).toBe(booking.id);
});

it("leaves a package hotel's stay unpriced and keeps the package price on the booking", async () => {
  // Every booking of a package carries the PACKAGE total; writing it onto the stay counted the
  // whole holiday as hotel spend, once per hotel.
  const { p } = await confirmHotel(
    hotel({ amount: 1800, paid: 0, priceGroupId: randomUUID(), details: { packageTotal: true } })
  );
  const stay = await prisma.lodgingStay.findFirstOrThrow({ where: { tripId: p.tripId } });
  expect(stay.totalPrice).toBeNull();
  expect(stay.totalPriceBase).toBeNull();
  const booking = await prisma.booking.findFirstOrThrow({ where: { tripId: p.tripId } });
  expect(booking.price).toBe(1800);
});

it("writes a confirmed hotel stay through the stay derivations, with real instants", async () => {
  // The plan wrote its own stay row: no checkInAt/checkOutAt instants, no checkOutTime, and none
  // of the derivations every other stay writer goes through.
  const { p } = await confirmHotel(hotel());
  const stay = await prisma.lodgingStay.findFirstOrThrow({ where: { tripId: p.tripId } });
  expect(stay.checkInAt?.toISOString()).toBe("2026-01-01T06:00:00.000Z");
  expect(stay.checkOutAt?.toISOString()).toBe("2026-01-03T02:00:00.000Z");
  expect(stay.checkOutTime).toBe("11:00");
  expect(stay.stayZone).toBe("Asia/Tokyo");
  expect(stay.totalPrice).toBe(300);
  const lodging = await prisma.lodging.findUniqueOrThrow({ where: { id: stay.lodgingId } });
  expect(lodging.dataSource).toBe("manual");
  expect(lodging.visited).toBe(true);
});
