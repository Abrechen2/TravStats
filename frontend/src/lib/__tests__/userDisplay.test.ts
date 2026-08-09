import { describe, it, expect } from "vitest";
import { displayName, fullName, initials } from "../userDisplay";

describe("displayName", () => {
  it("prefers the first name", () => {
    expect(displayName({ username: "akuenzel", firstName: "Alex", lastName: "Künzel" })).toBe("Alex");
  });

  it("falls back to the username so the header never greets nobody", () => {
    expect(displayName({ username: "akuenzel", firstName: null, lastName: null })).toBe("akuenzel");
  });

  it("treats whitespace as unset", () => {
    expect(displayName({ username: "akuenzel", firstName: "   " })).toBe("akuenzel");
  });

  it("never greets by surname alone", () => {
    expect(displayName({ username: "akuenzel", lastName: "Künzel" })).toBe("akuenzel");
  });

  it("survives a missing user", () => {
    expect(displayName(null)).toBe("");
    expect(displayName(undefined)).toBe("");
  });
});

describe("fullName", () => {
  it("joins both names", () => {
    expect(fullName({ username: "a", firstName: "Alex", lastName: "Künzel" })).toBe("Alex Künzel");
  });

  it("uses whichever half exists", () => {
    expect(fullName({ username: "a", lastName: "Künzel" })).toBe("Künzel");
  });

  it("falls back to the username", () => {
    expect(fullName({ username: "akuenzel" })).toBe("akuenzel");
  });
});

describe("initials", () => {
  it("takes one letter from each name", () => {
    expect(initials({ username: "a", firstName: "Alex", lastName: "Künzel" })).toBe("AK");
  });

  it("takes one letter when only one name is known", () => {
    expect(initials({ username: "a", firstName: "Alex" })).toBe("A");
    expect(initials({ username: "akuenzel" })).toBe("A");
  });

  // charAt would return half a surrogate pair and render as a replacement box.
  it("keeps a whole character outside the BMP intact", () => {
    expect(initials({ username: "x", firstName: "𝒜lex" })).toBe(Array.from("𝒜lex")[0].toLocaleUpperCase());
    expect(initials({ username: "🙂user" })).toBe("🙂");
  });

  it("upper-cases a lowercase name", () => {
    expect(initials({ username: "a", firstName: "alex", lastName: "künzel" })).toBe("AK");
  });

  it("survives a missing user", () => {
    expect(initials(null)).toBe("");
  });
});
