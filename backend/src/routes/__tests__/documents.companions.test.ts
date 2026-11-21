import { describe, it, expect, beforeAll } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { createDocument } from "../../services/documents/documentService";
import { addLinks } from "../../services/documents/documentEntryLinks";
import { recordParse } from "../../services/documents/parseRetention";
import { syncCompanionLinks } from "../../services/companions/travellerFacts";
import { mergeCompanions } from "../../services/companions/manageCompanions";
import { resolveCompanions, linkRowsFor } from "../../services/companionService";
import { scopeFileForRemoteMember } from "../../services/trip/exchange/memberScope";
import type { TripFile } from "../../services/trip/exchange/format";

/**
 * Plan D7 (docs/superpowers/specs/2026-11-21-document-links.md): a document is
 * FOR a person on the entry it covers, every domain keeps a companion's own
 * seat/ticket/booking/loyalty facts, and a parsed passenger name assigns the
 * document without the user asking — visibly, and never over a user decision.
 */
const PDF = (tag: string): Buffer => Buffer.from(`%PDF-1.4\n% ${tag}\n%%EOF`);

describe("documents for a person and per-traveller facts (D7)", () => {
  const stamp = Date.now();
  let ownerId: string;
  let strangerId: string;
  let ownerCookie: string;
  let strangerCookie: string;
  let norbert: string;
  let erika: string;
  let strangerCompanion: string;
  const ids: Record<string, string> = {};

  const api = (method: "get" | "put" | "post" | "patch", path: string, cookie = ownerCookie) =>
    request(app)[method](`/api/v1${path}`).set("Cookie", cookie);
  const keep = async (tag: string) =>
    (await createDocument({ userId: ownerId, buffer: PDF(`${stamp}-${tag}`) })).document;
  const flightData = (extra: object = {}) => ({
    userId: ownerId,
    flightNumber: "LH400",
    depIata: "FRA",
    depLat: 50.03,
    depLon: 8.56,
    arrIata: "JFK",
    arrLat: 40.64,
    arrLon: -73.78,
    departureTime: new Date("2024-05-01T08:00:00Z"),
    status: "flown",
    ...extra,
  });
  const station = {
    depStationName: "A",
    depLat: 50.1,
    depLon: 8.6,
    arrStationName: "B",
    arrLat: 50.9,
    arrLon: 6.9,
    departureTime: new Date("2024-05-01T08:00:00Z"),
  };

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    const owner = await prisma.user.create({
      data: {
        username: `d7-owner-${stamp}`,
        passwordHash,
        firstName: "Olga",
        lastName: "Owner",
      },
    });
    ownerId = owner.id;
    strangerId = (
      await prisma.user.create({ data: { username: `d7-stranger-${stamp}`, passwordHash } })
    ).id;
    ownerCookie = `auth_token=${generateToken(ownerId)}`;
    strangerCookie = `auth_token=${generateToken(strangerId)}`;
    const people = await resolveCompanions(ownerId, ["Norbert Nord", "Erika Muster"]);
    norbert = people[0].id;
    erika = people[1].id;
    strangerCompanion = (await resolveCompanions(strangerId, ["Norbert Nord"]))[0].id;
    const both = linkRowsFor([norbert, erika]);

    ids.flight = (await prisma.flight.create({ data: flightData() })).id;
    ids.rail = (await prisma.railJourney.create({ data: { userId: ownerId, ...station } })).id;
    ids.bus = (await prisma.busJourney.create({ data: { userId: ownerId, ...station } })).id;
    ids.ferry = (await prisma.ferryJourney.create({ data: { userId: ownerId, ...station } })).id;
    ids.cruise = (await prisma.cruise.create({ data: { userId: ownerId } })).id;
    ids.rental = (
      await prisma.rentalBooking.create({
        data: {
          userId: ownerId,
          provider: "Sixt",
          pickupStationName: "A",
          pickupLat: 1,
          pickupLon: 1,
          pickupTimezone: "Europe/Berlin",
          returnStationName: "B",
          returnLat: 1,
          returnLon: 1,
          returnTimezone: "Europe/Berlin",
          pickupTime: new Date("2024-05-01T08:00:00Z"),
          returnTime: new Date("2024-05-03T08:00:00Z"),
        },
      })
    ).id;
    const lodging = await prisma.lodging.create({
      data: { userId: ownerId, name: "Inn", city: "Town", country: "DE" },
    });
    ids.stay = (
      await prisma.lodgingStay.create({
        data: {
          lodgingId: lodging.id,
          userId: ownerId,
          checkIn: new Date("2024-05-01T15:00:00Z"),
          checkOut: new Date("2024-05-02T11:00:00Z"),
          companions: ["Norbert Nord", "Erika Muster"],
        },
      })
    ).id;
    await prisma.$transaction(async (tx) => {
      await tx.flightCompanion.createMany({
        data: both.map((r) => ({ ...r, flightId: ids.flight })),
      });
      await tx.railJourneyCompanion.createMany({
        data: both.map((r) => ({ ...r, railJourneyId: ids.rail })),
      });
      await tx.busJourneyCompanion.createMany({
        data: both.map((r) => ({ ...r, busJourneyId: ids.bus })),
      });
      await tx.ferryJourneyCompanion.createMany({
        data: both.map((r) => ({ ...r, ferryJourneyId: ids.ferry })),
      });
      await tx.cruiseCompanion.createMany({
        data: both.map((r) => ({ ...r, cruiseId: ids.cruise })),
      });
      await tx.rentalBookingCompanion.createMany({
        data: both.map((r) => ({ ...r, rentalBookingId: ids.rental })),
      });
    });
  });

  const facts = (type: string, entryId: string, companionId: string, body: object) =>
    api("put", `/entry-travellers/${companionId}`).send({
      entry: { type, id: entryId },
      facts: body,
    });

  describe("per-traveller facts, every domain", () => {
    const cases: Array<[string, string, object]> = [
      [
        "flight",
        "flight",
        {
          seatNumber: "12A",
          seatClass: "business",
          ticketNumber: "T-1",
          bookingReference: "ABC123",
          loyaltyNumber: "LH-99",
        },
      ],
      [
        "railJourney",
        "rail",
        {
          seatNumber: "44",
          seatClass: "2",
          ticketNumber: "T-2",
          bookingReference: "R1",
          loyaltyNumber: "BC-1",
        },
      ],
      [
        "busJourney",
        "bus",
        { seatNumber: "7", ticketNumber: "T-3", bookingReference: "B1", loyaltyNumber: "FL-1" },
      ],
      [
        "ferryJourney",
        "ferry",
        { seatNumber: "K3", ticketNumber: "T-4", bookingReference: "F1", loyaltyNumber: "FJ-1" },
      ],
      ["cruise", "cruise", { cabin: "8042", bookingReference: "C1", loyaltyNumber: "CL-1" }],
      [
        "rentalBooking",
        "rental",
        { isDriver: true, bookingReference: "RB1", loyaltyNumber: "SX-1" },
      ],
      ["lodgingStay", "stay", { bookingReference: "H1", loyaltyNumber: "BV-1" }],
    ];
    it.each(cases)(
      "%s: one companion's facts round trip and stay apart from the other",
      async (type, key, body) => {
        const put = await facts(type, ids[key], norbert, body);
        expect(put.status).toBe(200);
        const list = await api("get", `/entry-travellers?entryType=${type}&entryId=${ids[key]}`);
        expect(list.status).toBe(200);
        const [n, e] = [norbert, erika].map((id) =>
          list.body.data.find((r: { companionId: string }) => r.companionId === id)
        );
        expect(n.facts).toMatchObject(body);
        expect(n.factsSource).toBe("user");
        // The other person on the same entry has recorded nothing.
        expect(Object.values(e.facts).every((v) => v === null)).toBe(true);
      }
    );

    it("clears a fact with null or an empty string", async () => {
      await facts("flight", ids.flight, norbert, { seatNumber: "", loyaltyNumber: null });
      const list = await api("get", `/entry-travellers?entryType=flight&entryId=${ids.flight}`);
      const n = list.body.data.find((r: { companionId: string }) => r.companionId === norbert);
      expect(n.facts.seatNumber).toBeNull();
      expect(n.facts.loyaltyNumber).toBeNull();
      expect(n.facts.ticketNumber).toBe("T-1");
    });

    it("a field the entry type does not have is refused", async () => {
      const res = await facts("cruise", ids.cruise, norbert, { seatNumber: "1" });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("TRAVELLER_FACT_INVALID");
    });

    it("keeps a person's facts when an unrelated edit re-sends the companions (the rows used to be rewritten)", async () => {
      await facts("flight", ids.flight, norbert, { seatNumber: "12A" });
      await prisma.$transaction((tx) =>
        syncCompanionLinks(tx, "flight", ids.flight, [erika, norbert])
      );
      const rows = await prisma.flightCompanion.findMany({
        where: { flightId: ids.flight },
        orderBy: { position: "asc" },
      });
      expect(rows.map((r) => r.companionId)).toEqual([erika, norbert]);
      expect(rows[1].seatNumber).toBe("12A");
      // A person taken off the entry loses their row, and the facts with it.
      await prisma.$transaction((tx) => syncCompanionLinks(tx, "flight", ids.flight, [norbert]));
      expect(await prisma.flightCompanion.count({ where: { flightId: ids.flight } })).toBe(1);
      await prisma.$transaction((tx) =>
        syncCompanionLinks(tx, "flight", ids.flight, [norbert, erika])
      );
    });

    it("a companion who is not on the entry, or not the caller's, is a 404 and nothing is written", async () => {
      const ghost = (await resolveCompanions(ownerId, [`Ghost ${stamp}`]))[0].id;
      expect((await facts("flight", ids.flight, ghost, { seatNumber: "1" })).status).toBe(404);
      expect(
        (await facts("flight", ids.flight, strangerCompanion, { seatNumber: "1" })).status
      ).toBe(404);
      const asStranger = await api(
        "get",
        `/entry-travellers?entryType=flight&entryId=${ids.flight}`,
        strangerCookie
      );
      expect(asStranger.status).toBe(404);
      expect(
        (
          await api("put", `/entry-travellers/${norbert}`, strangerCookie).send({
            entry: { type: "flight", id: ids.flight },
            facts: { seatNumber: "99" },
          })
        ).status
      ).toBe(404);
      expect(
        (
          await prisma.flightCompanion.findFirstOrThrow({
            where: { flightId: ids.flight, companionId: norbert },
          })
        ).seatNumber
      ).toBe("12A");
    });

    it("a stay's facts go when the editor takes the person off the stay", async () => {
      const { pruneStayFacts } = await import("../../services/companions/travellerFacts");
      await prisma.lodgingStay.update({
        where: { id: ids.stay },
        data: { companions: ["Erika Muster"] },
      });
      await prisma.$transaction((tx) => pruneStayFacts(tx, ownerId, ids.stay));
      expect(
        await prisma.lodgingStayCompanion.count({
          where: { lodgingStayId: ids.stay, companionId: norbert },
        })
      ).toBe(0);
      await prisma.lodgingStay.update({
        where: { id: ids.stay },
        data: { companions: ["Norbert Nord", "Erika Muster"] },
      });
    });
  });

  describe("assigning a document to a person", () => {
    it("assign, filter by person, unassign — per link, not per document", async () => {
      const doc = await keep("assign");
      await addLinks(ownerId, doc.id, [
        { entry: { type: "flight", id: ids.flight } },
        { entry: { type: "railJourney", id: ids.rail } },
      ]);

      const put = await api("put", `/documents/${doc.id}/links/companion`).send({
        entry: { type: "flight", id: ids.flight },
        companionId: norbert,
      });
      expect(put.status).toBe(200);
      expect(put.body.data).toEqual({ companionId: norbert, companionSource: "user" });

      const onFlight = await api("get", `/flights/${ids.flight}/documents`);
      const row = onFlight.body.data.find((d: { id: string }) => d.id === doc.id);
      expect(row.forCompanion).toMatchObject({ id: norbert, displayName: "Norbert Nord" });
      const onRail = await api("get", `/rail/${ids.rail}/documents`);
      expect(onRail.body.data.find((d: { id: string }) => d.id === doc.id).forCompanion).toBeNull();

      const forNorbert = await api("get", `/documents?companionId=${norbert}`);
      expect(forNorbert.body.data.documents.map((d: { id: string }) => d.id)).toEqual([doc.id]);
      expect(forNorbert.body.data.total).toBe(1);
      expect(forNorbert.body.data.documents[0].people).toEqual([
        { id: norbert, displayName: "Norbert Nord" },
      ]);
      expect((await api("get", `/documents?companionId=${erika}`)).body.data.total).toBe(0);

      // The traveller row of the person shows their document.
      const t = await api("get", `/entry-travellers?entryType=flight&entryId=${ids.flight}`);
      expect(
        t.body.data
          .find((r: { companionId: string }) => r.companionId === norbert)
          .documents.map((d: { id: string }) => d.id)
      ).toEqual([doc.id]);

      const off = await api("put", `/documents/${doc.id}/links/companion`).send({
        entry: { type: "flight", id: ids.flight },
        companionId: null,
      });
      expect(off.body.data).toEqual({ companionId: null, companionSource: "user" });
      expect((await api("get", `/documents?companionId=${norbert}`)).body.data.total).toBe(0);
    });

    it("another account's companion, document or an unlinked entry is refused", async () => {
      const doc = await keep("refuse");
      await addLinks(ownerId, doc.id, [{ entry: { type: "flight", id: ids.flight } }]);
      const body = (companionId: string | null, type = "flight", id = ids.flight) => ({
        entry: { type, id },
        companionId,
      });
      const put = (b: object, cookie = ownerCookie, docId = doc.id) =>
        api("put", `/documents/${docId}/links/companion`, cookie).send(b);
      const foreign = await put(body(strangerCompanion));
      expect(foreign.status).toBe(404);
      expect(foreign.body.code).toBe("COMPANION_NOT_FOUND");
      expect((await put(body(norbert), strangerCookie)).status).toBe(404);
      const unlinked = await put(body(norbert, "railJourney", ids.rail));
      expect(unlinked.body.code).toBe("DOCUMENT_LINK_NOT_FOUND");
      expect(
        (await prisma.documentLink.findFirstOrThrow({ where: { documentId: doc.id } })).companionId
      ).toBeNull();
    });

    it("a shared-trip member still gets no document and no person from the trip file", () => {
      const file = {
        trip: { private: {} },
        stays: [],
        ferry: [],
        roadtrips: [],
        documents: [
          { key: "d1", file: "documents/d1.pdf", name: "ticket.pdf", companion: "Norbert Nord" },
        ],
      } as unknown as TripFile;
      expect(scopeFileForRemoteMember(file).documents).toEqual([]);
    });
  });

  describe("automatic assignment from a parsed passenger name", () => {
    const reading = (name: string | string[], extra: object = {}) => ({
      domain: "flight",
      flights: [
        {
          flightNumber: "LH400",
          departureTime: "2024-05-01T08:00:00Z",
          bookingReference: "PNR777",
          seat: "21C",
          seatClass: "economy",
          ...(Array.isArray(name) ? { coPassengers: name } : { passengerName: name }),
          ...extra,
        },
      ],
    });
    const parsed = async (tag: string, payload: object) => {
      const doc = await keep(tag);
      await prisma.document.update({
        where: { id: doc.id },
        data: { parsedDomain: "flight", parsedPayload: payload as never },
      });
      return doc;
    };
    const link = (docId: string) =>
      prisma.documentLink.findFirstOrThrow({ where: { documentId: docId, flightId: ids.flight } });

    it("a boarding-pass name matches one companion: document and empty facts are set, marked auto", async () => {
      await prisma.flightCompanion.updateMany({
        where: { flightId: ids.flight, companionId: erika },
        data: { seatNumber: null, seatClass: null, bookingReference: null, factsSource: null },
      });
      const doc = await parsed("auto-match", reading("NORD/NORBERT MR"));
      await addLinks(ownerId, doc.id, [{ entry: { type: "flight", id: ids.flight } }]);
      expect(await link(doc.id)).toMatchObject({ companionId: norbert, companionSource: "auto" });
      const row = await prisma.flightCompanion.findFirstOrThrow({
        where: { flightId: ids.flight, companionId: norbert },
      });
      // What the user typed stays (seat 12A, booking ABC123); a parse never overwrites.
      expect(row.seatNumber).toBe("12A");
      expect(row.bookingReference).toBe("ABC123");
      expect(row.factsSource).toBe("user");
    });

    it("fills an empty person's facts and records them as auto", async () => {
      const doc = await parsed("auto-facts", reading("Erika Muster"));
      await addLinks(ownerId, doc.id, [{ entry: { type: "flight", id: ids.flight } }]);
      const row = await prisma.flightCompanion.findFirstOrThrow({
        where: { flightId: ids.flight, companionId: erika },
      });
      expect(row).toMatchObject({
        seatNumber: "21C",
        seatClass: "economy",
        bookingReference: "PNR777",
        factsSource: "auto",
      });
    });

    it("no match leaves the link undecided for the user to pick", async () => {
      const doc = await parsed("auto-none", reading("Stranger Person"));
      await addLinks(ownerId, doc.id, [{ entry: { type: "flight", id: ids.flight } }]);
      expect(await link(doc.id)).toMatchObject({ companionId: null, companionSource: null });
    });

    it("several people named is a group document: nobody is picked", async () => {
      const doc = await parsed("auto-group", reading(["Norbert Nord", "Erika Muster"]));
      await addLinks(ownerId, doc.id, [{ entry: { type: "flight", id: ids.flight } }]);
      expect(await link(doc.id)).toMatchObject({ companionId: null, companionSource: null });
    });

    it("the owner's own name maps to me: no companion, but recorded as an automatic decision", async () => {
      const doc = await parsed("auto-owner", reading("OWNER/OLGA MS"));
      await addLinks(ownerId, doc.id, [{ entry: { type: "flight", id: ids.flight } }]);
      expect(await link(doc.id)).toMatchObject({ companionId: null, companionSource: "auto" });
    });

    it("a parse recorded on a document that is already linked assigns it", async () => {
      const doc = await keep("auto-late");
      await addLinks(ownerId, doc.id, [{ entry: { type: "flight", id: ids.flight } }]);
      await recordParse({
        userId: ownerId,
        documentId: doc.id,
        parsedDomain: "flight",
        parsedPayload: reading("Nord Norbert"),
      });
      expect(await link(doc.id)).toMatchObject({ companionId: norbert, companionSource: "auto" });
    });

    it("never overrules a user decision, even when the document is parsed again", async () => {
      const doc = await keep("auto-user");
      await addLinks(ownerId, doc.id, [{ entry: { type: "flight", id: ids.flight } }]);
      await api("put", `/documents/${doc.id}/links/companion`).send({
        entry: { type: "flight", id: ids.flight },
        companionId: erika,
      });
      await recordParse({
        userId: ownerId,
        documentId: doc.id,
        parsedDomain: "flight",
        parsedPayload: reading("Norbert Nord"),
      });
      expect(await link(doc.id)).toMatchObject({ companionId: erika, companionSource: "user" });
    });
  });

  describe("merging companions", () => {
    it("the merged-away person's facts and documents move to the target; the target's own value wins", async () => {
      const [a, b] = (
        await resolveCompanions(ownerId, [`Merge A ${stamp}`, `Merge B ${stamp}`])
      ).map((c) => c.id);
      const flight = await prisma.flight.create({ data: flightData() });
      await prisma.flightCompanion.createMany({
        data: [
          {
            flightId: flight.id,
            companionId: a,
            position: 0,
            seatNumber: "1A",
            ticketNumber: "TA",
            factsSource: "user",
          },
          {
            flightId: flight.id,
            companionId: b,
            position: 1,
            seatNumber: "2B",
            loyaltyNumber: "LB",
            factsSource: "user",
          },
        ],
      });
      const doc = await keep("merge");
      await addLinks(ownerId, doc.id, [{ entry: { type: "flight", id: flight.id } }]);
      await api("put", `/documents/${doc.id}/links/companion`).send({
        entry: { type: "flight", id: flight.id },
        companionId: b,
      });

      await mergeCompanions(ownerId, b, a);

      const row = await prisma.flightCompanion.findFirstOrThrow({ where: { flightId: flight.id } });
      expect(row).toMatchObject({
        companionId: a,
        seatNumber: "1A",
        ticketNumber: "TA",
        loyaltyNumber: "LB",
      });
      expect(
        (await prisma.documentLink.findFirstOrThrow({ where: { documentId: doc.id } })).companionId
      ).toBe(a);
    });
  });
});
