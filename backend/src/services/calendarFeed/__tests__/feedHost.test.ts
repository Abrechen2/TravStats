import { chooseFeedBaseUrl, isUnreachableHost } from "../feedHost";

/**
 * Which address the calendar link is built on (owner, 2026-10-26: "wenn ein
 * dyn name bekannt ist dann den link damit machen statt IP"): the first
 * candidate with a DNS name, else the first one there is — and a flag when
 * that address is one a calendar service on the internet cannot reach.
 */
describe("calendar feed link host", () => {
  it("prefers a named frontend URL over an IP public URL", () => {
    expect(
      chooseFeedBaseUrl({
        publicUrl: "http://192.168.178.120:3010/",
        frontendUrl: "https://trav.example.org",
        requestUrl: "http://192.168.178.120:3010",
      })
    ).toEqual({ baseUrl: "https://trav.example.org", reachableFromInternet: true });
  });

  it("falls back to the request host's name when neither setting has one", () => {
    expect(
      chooseFeedBaseUrl({
        publicUrl: "http://10.0.0.5",
        frontendUrl: null,
        requestUrl: "https://travstats.home.example",
      })
    ).toEqual({ baseUrl: "https://travstats.home.example", reachableFromInternet: true });
  });

  it("keeps the first address when none has a name, flagged when it is private", () => {
    expect(
      chooseFeedBaseUrl({
        publicUrl: "http://192.168.178.120:3010",
        frontendUrl: "http://[::1]:3000",
        requestUrl: "http://127.0.0.1:8000",
      })
    ).toEqual({ baseUrl: "http://192.168.178.120:3010", reachableFromInternet: false });
    expect(
      chooseFeedBaseUrl({ publicUrl: null, frontendUrl: null, requestUrl: "http://localhost:8000" })
    ).toEqual({ baseUrl: "http://localhost:8000", reachableFromInternet: false });
  });

  it("raises no flag for a name, nor for a public IP", () => {
    expect(
      chooseFeedBaseUrl({
        publicUrl: "https://trav.example.org",
        frontendUrl: null,
        requestUrl: "x",
      }).reachableFromInternet
    ).toBe(true);
    expect(
      chooseFeedBaseUrl({ publicUrl: "http://93.184.216.34", frontendUrl: null, requestUrl: "x" })
    ).toEqual({ baseUrl: "http://93.184.216.34", reachableFromInternet: true });
  });

  it.each([
    ["10.1.2.3", true],
    ["172.16.0.1", true],
    ["172.32.0.1", false],
    ["192.168.1.1", true],
    ["127.0.0.1", true],
    ["169.254.1.1", true],
    ["100.64.0.1", true],
    ["localhost", true],
    ["app.localhost", true],
    ["[::1]", true],
    ["[fd00::1]", true],
    ["[fe80::1]", true],
    ["[2001:db8::1]", false],
    ["8.8.8.8", false],
    ["trav.example.org", false],
  ])("judges %s unreachable: %s", (host, expected) => {
    expect(isUnreachableHost(host)).toBe(expected);
  });
});
