import fs from "fs";
import path from "path";

import { prisma } from "../db";

/**
 * forgejo#430: a rental can be sold inside a package, so `rental_bookings`
 * gains a nullable `booking_id`. The migration is additive — replayed here
 * against rows in the OLD shape (a rental, flight and ferry bookings), which
 * must survive unchanged with `booking_id = NULL`, and the new key must clear
 * itself when its booking goes.
 */
const MIGRATION = path.join(
  __dirname,
  "../../prisma/migrations/20261121185348_package_booking_rentals/migration.sql"
);
const SCHEMA = "migtest_package_booking_rentals";

function statements(): string[] {
  return fs
    .readFileSync(MIGRATION, "utf-8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const PRE_MIGRATION = [
  `CREATE TABLE bookings (id TEXT PRIMARY KEY, price DOUBLE PRECISION, currency TEXT)`,
  `CREATE TABLE flights (id TEXT PRIMARY KEY,
     booking_id TEXT REFERENCES bookings(id) ON DELETE SET NULL)`,
  `CREATE TABLE rental_bookings (id TEXT PRIMARY KEY, price DOUBLE PRECISION, currency TEXT)`,
  `INSERT INTO bookings (id, price, currency) VALUES ('b1', 2870.96, 'EUR'), ('b2', 7238, 'EUR')`,
  `INSERT INTO flights (id, booking_id) VALUES ('f1', 'b1'), ('f2', 'b1')`,
  `INSERT INTO rental_bookings (id, price, currency) VALUES ('r1', 312.5, 'USD')`,
];

type Row = Record<string, unknown>;

describe("migration package_booking_rentals — rentals can join a package (forgejo#430)", () => {
  let after: { rentals: Row[]; flights: Row[]; afterDelete: Row[] };

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${SCHEMA}`);
    after = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO ${SCHEMA}`);
      for (const sql of PRE_MIGRATION) await tx.$executeRawUnsafe(sql);
      for (const sql of statements()) await tx.$executeRawUnsafe(sql);
      const rentals = await tx.$queryRawUnsafe<Row[]>(
        `SELECT id, price, currency, booking_id FROM rental_bookings ORDER BY id`
      );
      const flights = await tx.$queryRawUnsafe<Row[]>(
        `SELECT id, booking_id FROM flights ORDER BY id`
      );
      await tx.$executeRawUnsafe(`UPDATE rental_bookings SET booking_id = 'b2' WHERE id = 'r1'`);
      await tx.$executeRawUnsafe(`DELETE FROM bookings WHERE id = 'b2'`);
      const afterDelete = await tx.$queryRawUnsafe<Row[]>(
        `SELECT id, booking_id FROM rental_bookings ORDER BY id`
      );
      return { rentals, flights, afterDelete };
    });
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await prisma.$disconnect();
  });

  it("keeps every existing rental, unbooked", () => {
    expect(after.rentals).toEqual([{ id: "r1", price: 312.5, currency: "USD", booking_id: null }]);
  });

  it("leaves today's flight bookings exactly as they were", () => {
    expect(after.flights).toEqual([
      { id: "f1", booking_id: "b1" },
      { id: "f2", booking_id: "b1" },
    ]);
  });

  it("un-books a rental when its booking is deleted, never deletes the rental", () => {
    expect(after.afterDelete).toEqual([{ id: "r1", booking_id: null }]);
  });
});
