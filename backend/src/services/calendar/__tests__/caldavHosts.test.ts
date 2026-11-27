import { discoverCollections, resolveHref } from "../caldav";
import type { FetchLike } from "../../egress/boundedFetch";

const BASE = "https://caldav.icloud.com/";

describe("CalDAV host switch (iCloud)", () => {
  it("accepts an https host of the same registrable domain", () => {
    expect(resolveHref(BASE, "https://p42-caldav.icloud.com/123/calendars/")).toBe(
      "https://p42-caldav.icloud.com/123/calendars/"
    );
  });

  it.each([
    "https://caldav.evil.com/x/",
    "https://icloud.com.evil.io/x/",
    "https://evilicloud.com/x/",
    "https://icloud.com@evil.io/x/",
    "http://p42-caldav.icloud.com/x/",
    "https://p42-caldav.icloud.com:8443/x/",
  ])("still refuses %s", (href) => {
    expect(() => resolveHref(BASE, href)).toThrow(/CALENDAR_FOREIGN_HREF/);
  });

  it("does not widen a public-suffix base to everything under it", () => {
    expect(() => resolveHref("https://dav.example.co.uk/", "https://other.co.uk/x")).toThrow();
    expect(resolveHref("https://dav.example.co.uk/", "https://p1.example.co.uk/x")).toContain("p1");
  });

  it("never widens an IP base", () => {
    expect(() => resolveHref("https://10.0.0.1/", "https://10.0.0.2/x")).toThrow();
  });

  it("discovers through the iCloud host switch, sending the request to the new host", async () => {
    const seen: string[] = [];
    const xml = (body: string) =>
      `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${body}</d:multistatus>`;
    const answers = [
      xml(
        `<d:response><d:href>/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>/123/principal/</d:href></d:current-user-principal></d:prop></d:propstat></d:response>`
      ),
      xml(
        `<d:response><d:href>/123/principal/</d:href><d:propstat><d:prop><c:calendar-home-set><d:href>https://p42-caldav.icloud.com/123/calendars/</d:href></c:calendar-home-set></d:prop></d:propstat></d:response>`
      ),
      xml(
        `<d:response><d:href>/123/calendars/home/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Home</d:displayname></d:prop></d:propstat></d:response>`
      ),
    ];
    const fetchImpl: FetchLike = async (url) => {
      seen.push(String(url));
      return new Response(answers[seen.length - 1], { status: 207 });
    };
    const found = await discoverCollections(
      { url: BASE, username: "u", password: "app-pw" },
      { allowPrivate: false } as never,
      fetchImpl
    );
    expect(seen[2]).toContain("https://p42-caldav.icloud.com/123/calendars/");
    expect(found[0].href).toBe("https://p42-caldav.icloud.com/123/calendars/home/");
  });
});
