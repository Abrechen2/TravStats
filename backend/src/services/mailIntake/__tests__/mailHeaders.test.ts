import { describe, it, expect } from "@jest/globals";

import { dmarcOf, fromAddressOf, readHeaders, singleAddress } from "../mailHeaders";
import { buildMail } from "./helpers";

describe("singleAddress — the addr-spec of exactly one mailbox", () => {
  it.each([
    ["me@gmail.example", "me@gmail.example"],
    ["Me <Me@Gmail.Example>", "me@gmail.example"],
    ['"Doe, John" <john@x.example>', "john@x.example"],
    // A display name that looks like an address is a name, not the sender.
    ['"allowed@gmail.example" <mallory@evil.example>', "mallory@evil.example"],
    ["allowed@gmail.example <mallory@evil.example>", "mallory@evil.example"],
    ["Mallory (allowed@gmail.example) <mallory@evil.example>", "mallory@evil.example"],
    ["<mallory@evil.example>", "mallory@evil.example"],
  ])("%s", (value, expected) => {
    expect(singleAddress(value)).toBe(expected);
  });

  it.each([
    ["two mailboxes", "a@x.example, b@y.example"],
    ["a group", "friends: a@x.example, b@y.example;"],
    ["a group with one member", "friends: a@x.example;"],
    ["an unterminated quote", '"Mallory <a@x.example>'],
    ["no address", "Just A Name"],
    ["an address with a space", "<a b@x.example>"],
    ["empty", ""],
  ])("refuses %s", (_name, value) => {
    expect(singleAddress(value)).toBeNull();
  });
});

describe("fromAddressOf / readHeaders", () => {
  it("takes the address from the raw header, not from a decoded display name", () => {
    // The encoded word decodes to `x <allowed@gmail.example>`.
    const encoded = `=?utf-8?B?${Buffer.from("x <allowed@gmail.example>").toString("base64")}?=`;
    const raw = buildMail({ from: `${encoded} <mallory@evil.example>` });
    expect(readHeaders(raw).from).toBe("mallory@evil.example");
  });

  it("refuses a mail with two From headers", () => {
    const raw = buildMail({
      extraHeaders: ["From: allowed@gmail.example"],
      from: "mallory@evil.example",
    });
    expect(fromAddressOf(raw)).toBeNull();
  });

  it("refuses a From naming two addresses", () => {
    expect(
      readHeaders(buildMail({ from: "allowed@gmail.example, mallory@evil.example" })).from
    ).toBeNull();
  });
});

describe("dmarcOf", () => {
  it("passes only for the From domain", () => {
    expect(dmarcOf("mx; dmarc=pass header.from=gmail.example", "me@gmail.example")).toBe("pass");
    expect(dmarcOf("mx; dmarc=pass header.from=other.example", "me@gmail.example")).toBe("none");
  });
  it("a pass without header.from is no pass", () => {
    expect(dmarcOf("mx; dmarc=pass", "me@gmail.example")).toBe("none");
    expect(dmarcOf("mx; dmarc=pass (p=none)", "me@gmail.example")).toBe("none");
  });
  it("a fail stays a fail", () => {
    expect(dmarcOf("mx; dmarc=fail header.from=gmail.example", "me@gmail.example")).toBe("fail");
  });
});
