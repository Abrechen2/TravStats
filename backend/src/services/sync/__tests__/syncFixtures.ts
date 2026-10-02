import request from "supertest";

import app from "../../../index";
import { prisma } from "../../../db";

/** A registered account with a session cookie and the domains it shows. */
export interface SyncTestUser {
  id: string;
  cookie: string[];
}

export async function registerUser(
  username: string,
  enabledDomains: string[] = ["flight", "cruise", "lodging", "poi", "roadtrip", "rail"]
): Promise<SyncTestUser> {
  const registration = await request(app)
    .post("/api/v1/auth/register")
    .send({ username, password: "password123" })
    .expect(201);
  const user = await prisma.user.findUniqueOrThrow({ where: { username } });
  await prisma.userSettings.upsert({
    where: { userId: user.id },
    create: { userId: user.id, enabledDomains, data: {} },
    update: { enabledDomains },
  });
  return { id: user.id, cookie: registration.headers["set-cookie"] as unknown as string[] };
}

export function createFlight(userId: string, extra: Record<string, unknown> = {}) {
  return prisma.flight.create({
    data: { userId, depLat: 50, depLon: 8, arrLat: 52, arrLon: 13, ...extra },
  });
}

/** The account's change rows, oldest first, as `entity:op` strings. */
export async function changeLog(userId: string): Promise<string[]> {
  const rows = await prisma.syncChange.findMany({
    where: { userId },
    orderBy: [{ xid: "asc" }, { seq: "asc" }],
  });
  return rows.map((row) => `${row.entity}:${row.op}`);
}

export async function wipe(): Promise<void> {
  await prisma.user.deleteMany();
  await prisma.syncChange.deleteMany();
}

export interface FeedAnswer {
  status: number;
  body: {
    success: boolean;
    data?: {
      mode: string;
      cursor: string;
      hasMore: boolean;
      changes: Array<{
        entity: string;
        id: string;
        op: string;
        version?: string | null;
        record?: Record<string, unknown>;
      }>;
    };
    code?: string;
    reason?: string;
  };
}

export async function readFeed(
  user: SyncTestUser,
  since?: string,
  limit?: number
): Promise<FeedAnswer> {
  const query: Record<string, string> = {};
  if (since !== undefined) query.since = since;
  if (limit !== undefined) query.limit = String(limit);
  const response = await request(app)
    .get("/api/v1/sync/changes")
    .query(query)
    .set("Cookie", user.cookie);
  return { status: response.status, body: response.body as FeedAnswer["body"] };
}

/** Reads until `hasMore` is false; returns every item and the final cursor. */
export async function drainFeed(
  user: SyncTestUser,
  since?: string,
  limit?: number
): Promise<{ items: NonNullable<FeedAnswer["body"]["data"]>["changes"]; cursor: string }> {
  const items: NonNullable<FeedAnswer["body"]["data"]>["changes"] = [];
  let cursor = since;
  for (let page = 0; page < 100; page += 1) {
    const answer = await readFeed(user, cursor, limit);
    if (answer.status !== 200 || !answer.body.data) {
      throw new Error(`feed answered ${answer.status}: ${JSON.stringify(answer.body)}`);
    }
    items.push(...answer.body.data.changes);
    cursor = answer.body.data.cursor;
    if (!answer.body.data.hasMore) return { items, cursor };
  }
  throw new Error("feed never reported hasMore=false");
}
