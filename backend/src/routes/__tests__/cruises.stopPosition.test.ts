/**
 * forgejo#438: two stops on one day without times had no stable order — the
 * random uuid decided. `position` is the explicit order within the cruise.
 */
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

const USER = "cruisestopposition";

type Stop = { id: string; unresolvedPortName: string | null; position: number };

describe("cruise stop position (forgejo#438)", () => {
  let cookie: string;

  const cleanup = async (): Promise<void> => {
    await prisma.cruise.deleteMany({ where: { user: { username: USER } } });
    await prisma.user.deleteMany({ where: { username: USER } });
  };

  beforeAll(async () => {
    await cleanup();
    const u = await prisma.user.create({
      data: { username: USER, passwordHash: await hashPassword("password123") },
    });
    cookie = `auth_token=${generateToken(u.id)}`;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  const names = ["Zeta", "Alpha", "Mike", "Bravo", "Yankee", "Charlie"];
  const sameDay = (order: string[], withPosition = false) =>
    order.map((unresolvedPortName, i) => ({
      dayNumber: 2,
      isAtSea: false,
      unresolvedPortName,
      ...(withPosition ? { position: i } : {}),
    }));
  const orderOf = (stops: Stop[]): string[] => stops.map((s) => s.unresolvedPortName ?? "");

  it("keeps same-day stops without times in the order they were sent, not uuid order", async () => {
    const res = await request(app)
      .post("/api/v1/cruises")
      .set("Cookie", cookie)
      .send({ cruiseLine: "Testreederei", startDate: "2026-07-01", stops: sameDay(names) });
    expect(res.status).toBe(201);
    expect(orderOf(res.body.data.stops)).toEqual(names);
    expect(res.body.data.stops.map((s: Stop) => s.position)).toEqual([0, 1, 2, 3, 4, 5]);

    const again = await request(app)
      .get(`/api/v1/cruises/${res.body.data.id}`)
      .set("Cookie", cookie);
    expect(orderOf(again.body.data.stops)).toEqual(names);
  });

  it("persists a reorder within the day", async () => {
    const created = await request(app)
      .post("/api/v1/cruises")
      .set("Cookie", cookie)
      .send({ cruiseLine: "Testreederei", startDate: "2026-07-01", stops: sameDay(names) });
    const reordered = [...names].reverse();
    const res = await request(app)
      .patch(`/api/v1/cruises/${created.body.data.id}`)
      .set("Cookie", cookie)
      .send({ stops: sameDay(reordered, true) });
    expect(res.status).toBe(200);
    expect(orderOf(res.body.data.stops)).toEqual(reordered);
  });

  it("gives an old client that omits position the next positions, in array order", async () => {
    const created = await request(app)
      .post("/api/v1/cruises")
      .set("Cookie", cookie)
      .send({ cruiseLine: "Testreederei", startDate: "2026-07-01", stops: sameDay(names) });
    const res = await request(app)
      .patch(`/api/v1/cruises/${created.body.data.id}`)
      .set("Cookie", cookie)
      .send({ stops: sameDay([...names, "Omega"]) });
    expect(res.status).toBe(200);
    expect(orderOf(res.body.data.stops)).toEqual([...names, "Omega"]);
  });
});
