import { describe, it, expect } from "@jest/globals";

import { extractPassengerNames, matchPassengers, nameTokens } from "../passengerMatch";

describe("passengerMatch (D7)", () => {
  const people = [
    { id: "n", name: "Norbert Nord" },
    { id: "e", name: "Erika Muster" },
    { id: "m", name: "Max Mustermann" },
  ];

  it("reads a boarding pass's SURNAME/FIRSTNAME TITLE as first and last name", () => {
    expect(nameTokens("NORD/NORBERT MR").sort()).toEqual(["norbert", "nord"]);
    expect(nameTokens("Müller/Jörg Dr").sort()).toEqual(["jorg", "muller"]);
  });

  it("finds names under the keys a reading uses, at any depth, and nothing else", () => {
    expect(
      extractPassengerNames({
        flights: [{ passengerName: "A/B MR", coPassengers: ["C D", { name: "E F" }] }],
        other: { passengerName: "G H" },
        seat: "1A",
      })
    ).toEqual(["A/B MR", "C D", "E F", "G H"]);
    expect(extractPassengerNames(null)).toEqual([]);
    expect(extractPassengerNames("text")).toEqual([]);
  });

  it("one name that fits one companion", () => {
    expect(matchPassengers(["NORD/NORBERT MR"], "Olga Owner", people)).toEqual({
      kind: "companion",
      companionId: "n",
    });
  });

  it("a middle name on the ticket still fits a first-and-last companion", () => {
    expect(matchPassengers(["Max Peter Mustermann"], null, people)).toEqual({
      kind: "companion",
      companionId: "m",
    });
  });

  it("the owner's own name is the owner, not a companion", () => {
    expect(matchPassengers(["OWNER/OLGA MS"], "Olga Owner", people)).toEqual({ kind: "owner" });
  });

  it("abstains for no fit, several people, or two candidates", () => {
    expect(matchPassengers(["Stranger Person"], "Olga Owner", people).kind).toBe("none");
    expect(matchPassengers(["Norbert Nord", "Erika Muster"], null, people).kind).toBe("none");
    // Two catalogue entries with the same name: ambiguous, so neither.
    const twins = [...people, { id: "n2", name: "Norbert Nord" }];
    expect(matchPassengers(["Norbert Nord"], null, twins).kind).toBe("none");
    // A single first name is no identity unless the whole printed name is that one token.
    expect(matchPassengers(["Norbert Nord"], null, [{ id: "x", name: "Norbert" }]).kind).toBe(
      "none"
    );
  });

  it("the same person printed twice is still one person", () => {
    expect(matchPassengers(["NORD/NORBERT", "Norbert Nord"], null, people)).toEqual({
      kind: "companion",
      companionId: "n",
    });
  });
});
