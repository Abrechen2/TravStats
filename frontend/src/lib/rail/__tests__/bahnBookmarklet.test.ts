import { describe, expect, it, vi } from "vitest";
import { bahnBookmarkletHref, bahnBookmarkletSource } from "../bahnBookmarklet";
import { decodeBahnHandoff } from "../bahnHandoff";

const ORIGIN = "https://travstats.example";
const VBID = "0f0e0d0c-0b0a-4908-8706-050403020100";
const RECON =
  "¶HKI¶T$A=1@O=Augsburg Hbf@L=8000013@a=128@$A=1@O=München Hbf@L=8000261@a=128@" +
  "$202611030808$202611030854$RB 57099$$1$$$$$$¶KC¶";

interface Run {
  /** Where the bookmarklet sent the browser; null when it stayed. */
  target: string | null;
  fetch: ReturnType<typeof vi.fn>;
}

/**
 * Runs the bookmarklet as the browser would — decoded from its `javascript:`
 * address — against a stand-in bahn.de page: its address, its fetch, its prompt.
 */
async function runOn(
  pageUrl: string,
  answer: () => Promise<Response>,
  promptAnswer: string | null = null,
  promptText = "Link?"
): Promise<Run> {
  const href = bahnBookmarkletHref(ORIGIN, promptText);
  expect(href.startsWith("javascript:")).toBe(true);
  const code = decodeURIComponent(href.slice("javascript:".length));
  const page = new URL(pageUrl);
  const location = { hostname: page.hostname, href: pageUrl };
  const fetch = vi.fn(answer);
  const prompt = vi.fn(() => promptAnswer);
  new Function("location", "fetch", "prompt", code)(location, fetch, prompt);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  return { target: location.href === pageUrl ? null : location.href, fetch };
}

const json = (body: unknown, status = 200): Promise<Response> =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

const fragmentOf = (target: string | null): string => {
  expect(target?.startsWith(`${ORIGIN}/rail/from-bahn#`)).toBe(true);
  return target!.slice(target!.indexOf("#"));
};

describe("the „In TravStats übernehmen“ bookmarklet (forgejo#204)", () => {
  it("fetches the connection same-origin on bahn.de and hands it over in the fragment", async () => {
    const run = await runOn(
      `https://www.bahn.de/buchung/start?vbid=${VBID.replace(/-/g, "%2D")}`,
      () => json({ hinfahrtRecon: RECON, klasse: "KLASSE_2", reisende: [{ alter: 30 }] })
    );
    expect(run.fetch).toHaveBeenCalledTimes(1);
    expect(run.fetch.mock.calls[0][0]).toBe(`/web/api/angebote/verbindung/${VBID}`);
    expect(decodeBahnHandoff(fragmentOf(run.target))).toEqual({
      kind: "answer",
      answer: { hinfahrtRecon: RECON, klasse: "KLASSE_2" },
    });
  });

  it("trims web-client sections to the fields a connection needs", async () => {
    const run = await runOn(`https://www.bahn.de/buchung/start?vbid=${VBID}`, () =>
      json({
        verbindung: {
          verbindungsAbschnitte: [
            {
              abfahrtsOrt: "Augsburg Hbf",
              ankunftsOrt: "München Hbf",
              abfahrtsZeitpunkt: "2026-11-03T08:08:00",
              ankunftsZeitpunkt: "2026-11-03T08:54:00",
              halte: [{ name: "Mering" }],
              verkehrsmittel: { name: "RB 57099", typ: "REGIONALZUEGE", zugattribute: [{}] },
            },
          ],
        },
      })
    );
    const decoded = decodeBahnHandoff(fragmentOf(run.target));
    expect(decoded).toEqual({
      kind: "answer",
      answer: {
        verbindungsAbschnitte: [
          {
            abfahrtsOrt: "Augsburg Hbf",
            ankunftsOrt: "München Hbf",
            abfahrtsZeitpunkt: "2026-11-03T08:08:00",
            ankunftsZeitpunkt: "2026-11-03T08:54:00",
            verkehrsmittel: { name: "RB 57099", typ: "REGIONALZUEGE" },
          },
        ],
      },
    });
  });

  it("asks for the link on a bahn.de page without one, and stops when the user cancels", async () => {
    const asked = await runOn(
      "https://www.bahn.de/",
      () => json({ hinfahrtRecon: RECON }),
      `https://www.bahn.de/buchung/start?vbid=${VBID}`
    );
    expect(asked.fetch).toHaveBeenCalledTimes(1);
    expect(fragmentOf(asked.target)).toMatch(/^#d=/);

    const cancelled = await runOn("https://www.bahn.de/", () => json({}), null);
    expect(cancelled.fetch).not.toHaveBeenCalled();
    expect(cancelled.target).toBeNull();
  });

  it("reports every failure as a code, never fetching off bahn.de", async () => {
    const elsewhere = await runOn(`https://evil.example/?vbid=${VBID}`, () => json({}));
    expect(elsewhere.fetch).not.toHaveBeenCalled();
    expect(fragmentOf(elsewhere.target)).toBe("#e=notBahn");

    const noVbid = await runOn("https://www.bahn.de/", () => json({}), "not a link");
    expect(fragmentOf(noVbid.target)).toBe("#e=noVbid");

    const cases: Array<[() => Promise<Response>, string]> = [
      [() => json({ status: "ERROR", code: "OPS_BLOCKED" }, 403), "#e=blocked"],
      [() => json({}, 404), "#e=expired"],
      [() => json({}, 429), "#e=rateLimited"],
      [() => json({}, 500), "#e=providerError"],
      [() => Promise.resolve(new Response("<html>", { status: 200 })), "#e=unreadable"],
      [() => Promise.reject(new TypeError("Failed to fetch")), "#e=fetchFailed"],
    ];
    for (const [answer, expected] of cases) {
      const run = await runOn(`https://www.bahn.de/buchung/start?vbid=${VBID}`, answer);
      expect(fragmentOf(run.target)).toBe(expected);
    }
  });

  it("refuses to hand over more than TravStats accepts", async () => {
    const run = await runOn(`https://www.bahn.de/buchung/start?vbid=${VBID}`, () =>
      json({ hinfahrtRecon: "¶HKI¶" + "x".repeat(60_000) })
    );
    expect(fragmentOf(run.target)).toBe("#e=tooLarge");
  });

  it("keeps the origin and a translation inside their strings", () => {
    const source = bahnBookmarkletSource('https://a"b', 'Füg ein: "$&" $1 %20 #x');
    expect(source).toContain(JSON.stringify('https://a"b/rail/from-bahn'));
    expect(source).toContain(JSON.stringify('Füg ein: "$&" $1 %20 #x'));
    expect(() => new Function(source)).not.toThrow();
  });
});
