import fs from "fs";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import * as fx from "../../services/fx/resolver";
import { documentPath } from "../../services/documents/documentStore";
import { EXPENSE_KINDS } from "../../shared/expenses";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * forgejo#150 (owner D6): an expense records who paid, the exchange rate it
 * was converted at, and its receipt. The cases that matter are the ones that
 * could lose or invent money: a failed lookup must be visible, an edit of the
 * note must not replace a typed rate, a changed currency must not keep a rate
 * that converts something else, and the base total must never add a currency
 * nobody recorded a rate for.
 */
// Thirteen writes in one case, on a shared and often busy test database.
jest.setTimeout(30_000);

const PDF = (tag: string): Buffer => Buffer.from(`%PDF-1.4\n% ${tag}\n%%EOF`);

describe("expense details — payer, exchange rate, receipt", () => {
  const stamp = Date.now();
  let userId: string;
  let otherId: string;
  let cookie: string;
  let otherCookie: string;
  let tripId: string;
  let convert: jest.SpiedFunction<typeof fx.convertToBase>;

  const api = (path: string) => `/api/v1${path}`;
  const post = (body: object, as = cookie) =>
    request(app)
      .post(api(`/trips/${tripId}/expenses`))
      .set("Cookie", as)
      .send(body);
  const patch = (id: string, body: object) =>
    request(app)
      .patch(api(`/trips/${tripId}/expenses/${id}`))
      .set("Cookie", cookie)
      .send(body);
  const list = () =>
    request(app)
      .get(api(`/trips/${tripId}/expenses`))
      .set("Cookie", cookie);

  beforeAll(async () => {
    const passwordHash = await hashPassword("password123");
    userId = (await prisma.user.create({ data: { username: `exp-d-${stamp}`, passwordHash } })).id;
    otherId = (await prisma.user.create({ data: { username: `exp-o-${stamp}`, passwordHash } })).id;
    await prisma.userSettings.create({ data: { userId, data: {}, baseCurrency: "EUR" } });
    cookie = `auth_token=${generateToken(userId)}`;
    otherCookie = `auth_token=${generateToken(otherId)}`;
  });

  beforeEach(async () => {
    await prisma.trip.deleteMany({ where: { userId } });
    await prisma.companion.deleteMany({ where: { userId: { in: [userId, otherId] } } });
    tripId = (await prisma.trip.create({ data: { userId, name: "Norwegen" } })).id;
    // No network: every test says what the rate providers answer.
    convert = jest.spyOn(fx, "convertToBase").mockResolvedValue(null);
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    const rows = await prisma.document.findMany({ where: { userId: { in: [userId, otherId] } } });
    for (const row of rows) fs.rmSync(documentPath(row.storedName), { force: true });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    await prisma.$disconnect();
  });

  describe("categories", () => {
    it("accepts every kind of the wider list and refuses one it does not know", async () => {
      for (const kind of EXPENSE_KINDS) {
        const res = await post({ kind, amount: 1, currency: "EUR" });
        expect(res.status).toBe(201);
        expect(res.body.expense.kind).toBe(kind);
      }
      expect((await post({ kind: "lodging", amount: 1, currency: "EUR" })).status).toBe(400);
    });
  });

  describe("payer", () => {
    const companion = (owner: string, name: string) =>
      prisma.companion.create({
        data: {
          userId: owner,
          canonicalName: name.toLowerCase(),
          displayName: name,
          searchName: name.toLowerCase(),
        },
      });

    it("records a plain name, trimmed, and clears it with null", async () => {
      const created = await post({
        kind: "food",
        amount: 30,
        currency: "EUR",
        payer: { name: " Anna " },
      });
      expect(created.status).toBe(201);
      expect(created.body.expense.payer).toEqual({ companionId: null, name: "Anna" });

      const kept = await patch(created.body.expense.id, { note: "Pizza" });
      expect(kept.body.expense.payer).toEqual({ companionId: null, name: "Anna" });

      const cleared = await patch(created.body.expense.id, { payer: null });
      expect(cleared.body.expense.payer).toBeNull();
    });

    it("links a companion, shows its current name, and keeps the name when it is deleted", async () => {
      const anna = await companion(userId, "Anna");
      const created = await post({
        kind: "ferry",
        amount: 90,
        currency: "EUR",
        payer: { companionId: anna.id },
      });
      expect(created.body.expense.payer).toEqual({ companionId: anna.id, name: "Anna" });

      await prisma.companion.update({ where: { id: anna.id }, data: { displayName: "Anna B." } });
      expect((await list()).body.expenses[0].payer).toEqual({
        companionId: anna.id,
        name: "Anna B.",
      });

      await prisma.companion.delete({ where: { id: anna.id } });
      expect((await list()).body.expenses[0].payer).toEqual({ companionId: null, name: "Anna" });
    });

    it("refuses a stranger's companion and a body that names both", async () => {
      const theirs = await companion(otherId, "Bob");
      const res = await post({
        kind: "toll",
        amount: 5,
        currency: "EUR",
        payer: { companionId: theirs.id },
      });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("COMPANION_NOT_FOUND");
      const both = await post({
        kind: "toll",
        amount: 5,
        currency: "EUR",
        payer: { companionId: theirs.id, name: "Bob" },
      });
      expect(both.status).toBe(400);
      expect(await prisma.tripExpense.count({ where: { userId } })).toBe(0);
    });
  });

  describe("exchange rate", () => {
    const CACHED = { rate: 0.0865, rateDate: "2026-07-14", baseCurrency: "EUR", source: "cached" };

    it("stores a client's cached rate as given, without a lookup", async () => {
      const res = await post({
        kind: "ferry",
        amount: 1000,
        currency: "NOK",
        date: "2026-07-15",
        fx: CACHED,
      });
      expect(res.status).toBe(201);
      expect(res.body.fxSnapshot).toBe("supplied");
      expect(res.body.expense.fx).toEqual({
        amountBase: 86.5,
        rate: 0.0865,
        rateDate: "2026-07-14",
        baseCurrency: "EUR",
        source: "cached",
      });
      expect(convert).not.toHaveBeenCalled();
    });

    it("re-prices a stored rate when the amount changes and the lookup fails", async () => {
      const created = await post({
        kind: "ferry",
        amount: 1000,
        currency: "NOK",
        date: "2026-07-15",
        fx: CACHED,
      });
      const res = await patch(created.body.expense.id, { amount: 2000 });
      expect(res.status).toBe(200);
      expect(res.body.fxSnapshot).toBe("keptStoredRate");
      expect(res.body.expense.fx).toMatchObject({
        amountBase: 173,
        rate: 0.0865,
        source: "cached",
      });
    });

    it("looks a rate up for the expense's own day on create", async () => {
      convert.mockResolvedValue({
        baseAmount: 86.5,
        rate: 0.0865,
        rateDate: "2026-07-15",
        source: "ecb",
      });
      const res = await post({ kind: "toll", amount: 1000, currency: "NOK", date: "2026-07-15" });
      expect(res.body.fxSnapshot).toBe("snapshotted");
      expect(res.body.expense.fx).toMatchObject({
        amountBase: 86.5,
        rateDate: "2026-07-15",
        source: "ecb",
      });
      const [, from, base, day] = convert.mock.calls[0];
      expect([from, base, day.toISOString().slice(0, 10)]).toEqual(["NOK", "EUR", "2026-07-15"]);
    });

    it("says so when no rate could be had, and stores none", async () => {
      const res = await post({ kind: "toll", amount: 1000, currency: "NOK", date: "2026-07-15" });
      expect(res.status).toBe(201);
      expect(res.body.fxSnapshot).toBe("lookupFailed");
      expect(res.body.expense.fx).toBeNull();
    });

    it("looks nothing up for an undated expense", async () => {
      const res = await post({ kind: "toll", amount: 1000, currency: "NOK" });
      expect(res.body.fxSnapshot).toBe("undated");
      expect(res.body.expense.fx).toBeNull();
      expect(convert).not.toHaveBeenCalled();
    });

    it("keeps a typed rate when only the note, kind or payer changes", async () => {
      const created = await post({
        kind: "fees",
        amount: 50,
        currency: "VND",
        date: "2026-07-15",
        fx: { ...CACHED, rate: 0.000036, source: "manual" },
      });
      convert.mockResolvedValue({
        baseAmount: 9,
        rate: 0.18,
        rateDate: "2026-07-15",
        source: "cdn",
      });
      const res = await patch(created.body.expense.id, {
        note: "Visa",
        kind: "other",
        payer: { name: "Anna" },
        // The edit dialog sends the unchanged inputs back.
        amount: 50,
        currency: "VND",
        date: "2026-07-15",
      });
      expect(res.body.fxSnapshot).toBe("unchanged");
      expect(res.body.expense.fx).toEqual(created.body.expense.fx);
      expect(convert).not.toHaveBeenCalled();
    });

    it("clears a rate whose currency changed when no new one can be had", async () => {
      const created = await post({
        kind: "ferry",
        amount: 1000,
        currency: "NOK",
        date: "2026-07-15",
        fx: CACHED,
      });
      const res = await patch(created.body.expense.id, { currency: "SEK" });
      expect(res.body.fxSnapshot).toBe("lookupFailed");
      expect(res.body.expense.fx).toBeNull();
    });

    it("removes the record on fx: null, and refuses a currency converted into itself at not 1", async () => {
      const created = await post({
        kind: "ferry",
        amount: 1000,
        currency: "NOK",
        date: "2026-07-15",
        fx: CACHED,
      });
      const removed = await patch(created.body.expense.id, { fx: null });
      expect(removed.body.fxSnapshot).toBe("removed");
      expect(removed.body.expense.fx).toBeNull();

      const self = await post({
        kind: "food",
        amount: 10,
        currency: "EUR",
        fx: { ...CACHED, rate: 1.2 },
      });
      expect(self.status).toBe(400);
    });

    it("adds up in the base currency only through recorded rates", async () => {
      await post({ kind: "food", amount: 10, currency: "EUR" });
      await post({ kind: "ferry", amount: 1000, currency: "NOK", date: "2026-07-15", fx: CACHED });
      // A rate into a base the user has since left converts nothing today.
      await post({
        kind: "toll",
        amount: 200,
        currency: "NOK",
        fx: { rate: 0.08, rateDate: "2026-07-01", baseCurrency: "CHF", source: "manual" },
      });
      await post({ kind: "fuel", amount: 50, currency: "SEK", date: "2026-07-16" });

      const res = await list();
      expect(res.body.totals).toEqual({ EUR: 10, NOK: 1200, SEK: 50 });
      expect(res.body.baseTotal).toEqual({
        currency: "EUR",
        amount: 96.5,
        unconverted: { NOK: 200, SEK: 50 },
      });
    });
  });

  describe("receipts", () => {
    const upload = (expenseId: string | null, tag: string, as = cookie) => {
      const req = request(app).post(api("/documents")).set("Cookie", as);
      if (expenseId) req.field("entryType", "tripExpense").field("entryId", expenseId);
      return req.attach("file", PDF(tag), {
        filename: "Beleg.pdf",
        contentType: "application/pdf",
      });
    };

    it("files a receipt with an expense, lists it, and deletes it with the expense", async () => {
      const expense = (await post({ kind: "fuel", amount: 80, currency: "EUR" })).body.expense;
      expect(expense.documentCount).toBe(0);
      const doc = await upload(expense.id, `fuel-${stamp}`);
      expect(doc.status).toBe(201);
      expect(doc.body.data.entry).toEqual({ type: "tripExpense", id: expense.id });

      const listed = await request(app)
        .get(api(`/expenses/${expense.id}/documents`))
        .set("Cookie", cookie);
      expect(listed.status).toBe(200);
      expect(listed.body.data.map((d: { id: string }) => d.id)).toEqual([doc.body.data.id]);
      expect((await list()).body.expenses[0].documentCount).toBe(1);

      const gone = await request(app)
        .delete(api(`/trips/${tripId}/expenses/${expense.id}`))
        .set("Cookie", cookie);
      expect(gone.status).toBe(204);
      expect(await prisma.document.count({ where: { id: doc.body.data.id } })).toBe(0);
    });

    it("files an earlier upload through documentIds on create", async () => {
      const doc = await upload(null, `early-${stamp}`);
      expect(doc.status).toBe(201);
      const res = await post({
        kind: "pitch",
        amount: 25,
        currency: "EUR",
        documentIds: [doc.body.data.id],
      });
      expect(res.status).toBe(201);
      expect(res.body.expense.documentCount).toBe(1);
    });

    it("refuses a stranger's expense as an owner and as a list", async () => {
      const expense = (await post({ kind: "fuel", amount: 80, currency: "EUR" })).body.expense;
      expect((await upload(expense.id, `stranger-${stamp}`, otherCookie)).status).toBe(404);
      const listed = await request(app)
        .get(api(`/expenses/${expense.id}/documents`))
        .set("Cookie", otherCookie);
      expect(listed.status).toBe(404);
    });
  });
});
