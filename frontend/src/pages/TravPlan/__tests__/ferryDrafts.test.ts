import { describe, it, expect } from "vitest";
import { bookingDrafts } from "../bookingDrafts";
import { ferryCandidates } from "../ferryDrafts";
import type { PlanView } from "../../../lib/api/travplan";

const plan = {
  state: { timezone: "Europe/Rome", currency: "EUR", destination: "Sardinia" },
} as PlanView;

describe("Ferry booking import into a plan (spec §7)", () => {
  it("maps a template-read ticket to one ferry booking per crossing, the price only on a single crossing", () => {
    const body = {
      domain: "ferry",
      tickets: [
        {
          operator: "Grimaldi",
          bookingReference: "GR123",
          price: 200,
          currency: "EUR",
          rides: [
            {
              depName: "Livorno",
              arrName: "Olbia",
              departureLocal: "2027-05-01T21:00",
              arrivalLocal: "2027-05-02T07:30",
              carrier: "Cruise Sardegna",
            },
            {
              depName: "Olbia",
              arrName: "Livorno",
              departureLocal: "2027-05-09T20:00",
              arrivalLocal: "2027-05-10T07:00",
            },
          ],
        },
      ],
    };
    const rows = bookingDrafts(ferryCandidates(body), plan);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      kind: "ferry",
      title: "Livorno → Olbia",
      provider: "Grimaldi",
      reference: "GR123",
      day: "2027-05-01",
      time: "21:00",
      arrivalDay: "2027-05-02",
      originPlace: "Livorno",
      place: "Olbia",
      amount: null,
    });
    const single = bookingDrafts(
      ferryCandidates({ tickets: [{ ...body.tickets[0], rides: [body.tickets[0].rides[0]] }] }),
      plan
    );
    expect(single[0]).toMatchObject({ amount: 200, currency: "EUR" });
  });

  it("maps the ticket preview's crossings and drops what was not read instead of inventing it", () => {
    const rows = bookingDrafts(
      ferryCandidates({
        crossings: [
          {
            departurePort: { value: "Piraeus", evidence: "Piraeus" },
            arrivalPort: { value: "Naxos", evidence: "Naxos" },
            departureLocal: { value: "2027-06-03T07:25", evidence: "03.06.2027 07:25" },
            price: { value: "54.5", evidence: "54,50" },
            currency: { value: "EUR", evidence: "EUR" },
          },
        ],
      }),
      plan
    );
    expect(rows[0]).toMatchObject({
      kind: "ferry",
      title: "Piraeus → Naxos",
      day: "2027-06-03",
      amount: 54.5,
      arrivalDay: null,
      reference: null,
    });
  });

  it("answers an empty reading with no candidate at all", () => {
    expect(ferryCandidates({ crossings: [] }).candidates).toEqual([]);
    expect(ferryCandidates({ tickets: [] }).candidates).toEqual([]);
    expect(ferryCandidates(null).candidates).toEqual([]);
  });
});
