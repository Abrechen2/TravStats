import { getService } from "../catalogue";
import { toColumnValue } from "../fields";

/** The own-receiver address (forgejo#408 phase 3): the egress rule of forgejo#411. */
describe("tar1090 catalogue entry", () => {
  const service = getService("tar1090")!;
  const field = service.fields.find((f) => f.key === "baseUrl")!;

  it("is off until an address is saved: nothing required but the address", () => {
    expect(service.requiredFields).toEqual(["baseUrl"]);
    expect(service.keyless).toBe(false);
    expect(service.accountFields.map((f) => f.column)).toEqual(["tar1090BaseUrl"]);
  });

  it("lets an admin name a LAN receiver and strips the trailing slash", () => {
    expect(
      toColumnValue(service, field, "http://192.168.1.50/tar1090/", { allowPrivate: true })
    ).toBe("http://192.168.1.50/tar1090");
  });

  it("refuses a LAN, loopback or local-name receiver for an ordinary account with PRIVATE_TARGET", () => {
    for (const url of [
      "http://192.168.1.50",
      "http://localhost:8080",
      "http://127.0.0.1",
      "http://pi.local",
    ]) {
      expect(() => toColumnValue(service, field, url, { allowPrivate: false })).toThrow(
        expect.objectContaining({ code: "PRIVATE_TARGET" })
      );
    }
    expect(toColumnValue(service, field, "https://tar.example.org", { allowPrivate: false })).toBe(
      "https://tar.example.org"
    );
  });

  it("rejects what is not an http(s) URL", () => {
    for (const bad of ["not a url", "ftp://x.example.org"]) {
      expect(() => toColumnValue(service, field, bad, { allowPrivate: true })).toThrow(
        expect.objectContaining({ code: "VALIDATION_FAILED" })
      );
    }
  });
});

describe("ADS-B providers an account may bring a key to (forgejo#408)", () => {
  it.each([
    ["adsbx", "adsbxApiKey"],
    ["adsblol", "adsblolApiKey"],
  ])("%s has an account key column", (id, column) => {
    expect(getService(id)!.accountFields.map((f) => f.column)).toEqual([column]);
  });
});
