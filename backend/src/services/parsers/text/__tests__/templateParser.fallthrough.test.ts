import fs from "fs";
import path from "path";
import { TemplateParser } from "../templateParser";
import { templateRegistry } from "../../templates/registry";
import type { AirlineTemplate } from "../../templates/types";

const LH_OLD = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "templates",
      "__tests__",
      "fixtures",
      "v1-airlines",
      "LH-old.json"
    ),
    "utf-8"
  )
) as AirlineTemplate;

describe("TemplateParser — walking the detected templates", () => {
  beforeAll(async () => {
    await templateRegistry.initialize();
  });

  it("reads a time split by zero-width spaces, as Lufthansa's 2015 mails print every one", async () => {
    // On screen "07:55 Uhr"; in the mail a U+200B between each digit. Without
    // stripping, LH-old found no time, declined, and the regex read a wrong number.
    const zw = String.fromCharCode(0x200b);
    const input = LH_OLD.testCases[0].input.replace(
      /(\d)(\d):(\d)(\d)/g,
      `$1${zw}$2${zw}:$3${zw}$4`
    );
    expect(input).toContain(zw);
    const r = await new TemplateParser().read("Buchungsdetails", input, "");
    expect(r.flights.map((f) => [f.flightNumber, f.departureTime, f.arrivalTime])).toEqual([
      ["LH2316", "2025-01-16T07:55", "2025-01-16T09:00"],
    ]);
  });

  it("lets a template reached only after another declined answer only with whole legs", async () => {
    // Detected as LH-old (subject) first, then LH (fingerprint). LH-old finds
    // no dated leg and declines; the general LH template would read the bare
    // number below as a routeless, timeless leg — which is worse than handing
    // the mail on, so it must decline too.
    const text = [
      "Lufthansa Buchungscode:",
      "QX7TST",
      "Ihr Reiseverlauf",
      "LH9999",
      "durchgeführt von: LUFTHANSA",
    ].join("\n");
    const r = await new TemplateParser().read("Ihre Buchungsdetails", text, "");
    expect(r).toEqual({ flights: [], nonBooking: false });
  });
});
