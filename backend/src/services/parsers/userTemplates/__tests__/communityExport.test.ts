import { describe, it, expect } from "@jest/globals";
import {
  buildCommunityExport,
  githubNewFileUrl,
  templateSlug,
  type CommunityExportInput,
} from "../communityExport";
import { deriveBusTemplate } from "../rideDeriver";
import { applyV2RideTicketTemplate } from "../../../rides/v2RideTicket";
import { templateEnvelopeSchema, workshopEnvelopeSchema } from "../../templates/v2/envelope";
import type { TemplateEnvelope } from "../../templates/v2/envelope";
import { select } from "./workshopSamples";
import {
  BUS_HELD_OUT,
  BUS_SELECTIONS,
  BUS_SOURCE,
  BUS_SUBJECT,
  FERRY_SELECTIONS,
  FERRY_SOURCE,
  FERRY_SUBJECT,
} from "./rideSamples";
import { RAIL_SELECTIONS, RAIL_SOURCE, RAIL_SUBJECT } from "./railSamples";
import { RENTAL_SELECTIONS, RENTAL_SOURCE, RENTAL_SUBJECT } from "./rentalSamples";
import { PACKAGE_SELECTIONS, PACKAGE_SOURCE, PACKAGE_SUBJECT } from "./packageSamples";
import {
  CRUISE_SELECTIONS,
  CRUISE_SOURCE,
  CRUISE_SUBJECT,
  PLACE_SELECTIONS,
  PLACE_SOURCE,
  PLACE_SUBJECT,
} from "./workshopSamples";
import { deriveFerryTemplate } from "../rideDeriver";
import { deriveRailTemplate } from "../railDeriver";
import { deriveRentalTemplate } from "../rentalDeriver";
import { derivePackageTemplate } from "../packageDeriver";
import { deriveCruiseTemplate } from "../cruiseDeriver";
import { derivePlaceTemplate } from "../placeDeriver";
import type { AnnotationSelection } from "../annotations";

/**
 * forgejo#309, spec package 4: a workshop template becomes a repository file
 * with nothing of the user's in it — the marked values of their own document,
 * their names and addresses. Removable hits are removed and reported; a hit
 * the template reads with refuses the export.
 */
const SELECTIONS = [...BUS_SELECTIONS, select(BUS_SOURCE, "Fernbus Probeland", "operator")];

function workshopTemplate(): TemplateEnvelope {
  const result = deriveBusTemplate({
    trainingDataId: "td-share-0042",
    subject: BUS_SUBJECT,
    fullText: BUS_SOURCE,
    selections: SELECTIONS,
  });
  if (!result.ok) throw new Error(result.refusal);
  return result.template;
}

const input = (envelope: TemplateEnvelope, identity: string[] = []): CommunityExportInput => ({
  envelope,
  personal: { marked: SELECTIONS, identity },
  appVersion: "2.9.0",
  today: "2026-10-20",
});

describe("buildCommunityExport", () => {
  it("writes the repository envelope: a new id, today's version, no workshop traces", () => {
    const result = buildCommunityExport(input(workshopTemplate()));
    if (!result.ok) throw new Error(result.refusal);
    const file = result.template;
    expect(file).toMatchObject({
      id: "bus:fernbus-probeland",
      domain: "bus",
      version: "2026.10.20",
      minAppVersion: "2.9.0",
      testCases: [],
    });
    expect(result.filename).toBe("fernbus-probeland.json");
    expect(file.extraction.fields?.source).toBeUndefined();
    expect(workshopEnvelopeSchema.safeParse(file).success).toBe(true);
    // The repository's own gate still needs the invented match + decline case.
    expect(templateEnvelopeSchema.safeParse(file).success).toBe(false);
    const json = JSON.stringify(file);
    expect(json).not.toContain("td-share-0042");
    expect(json).not.toContain("FBP-204711");
    expect(json).not.toContain("workshop");
  });

  it("still reads the operator's tickets once shared", () => {
    const result = buildCommunityExport(input(workshopTemplate()));
    if (!result.ok) throw new Error(result.refusal);
    const ticket = applyV2RideTicketTemplate(result.template, `${BUS_SUBJECT}\n${BUS_HELD_OUT}`);
    expect(ticket).toMatchObject({ bookingReference: "FBP-309922", source: "repository" });
    expect(ticket?.rides).toHaveLength(3);
  });

  it("removes a marker, an anchor or a sender domain that holds personal data, and says so", () => {
    const base = workshopTemplate();
    const envelope: TemplateEnvelope = {
      ...base,
      issuer: { ...base.issuer, keys: { senderDomains: ["probemann-familie.de"] } },
      match: {
        ...base.match,
        markers: [...base.match.markers, "Reisender: Max Probemann"],
        anchors: [...base.match.anchors, "max.probemann@example.org"],
      },
    };
    const result = buildCommunityExport(
      input(envelope, ["probemann", "Max Probemann", "max.probemann@probemann-familie.de"])
    );
    if (!result.ok) throw new Error(result.refusal);
    const json = JSON.stringify(result.template);
    expect(json).not.toMatch(/probemann/i);
    expect(result.template.match.anchors).toEqual(base.match.anchors);
    expect(result.template.issuer.keys).toBeUndefined();
    expect(result.removed.map((r) => r.path)).toEqual(
      expect.arrayContaining([
        `match.markers[${base.match.markers.length}]`,
        `match.anchors[${base.match.anchors.length}]`,
        "issuer.keys.senderDomains[0]",
      ])
    );
  });

  it("refuses when a value the user marked stands in a rule the template reads with", () => {
    const base = workshopTemplate();
    const envelope: TemplateEnvelope = {
      ...base,
      extraction: {
        ...base.extraction,
        fields: {
          ...base.extraction.fields,
          bookingReference: { patterns: ["Buchungsnummer: (FBP\\-204711)"], flags: "im" },
        },
      },
    };
    const result = buildCommunityExport(input(envelope));
    expect(result).toEqual({
      ok: false,
      refusal: "containsPersonalData",
      found: [
        {
          kind: "bookingReference",
          path: "extraction.fields.bookingReference.patterns[0]",
        },
      ],
    });
  });

  it("refuses when removing the personal anchors would leave none", () => {
    const base = workshopTemplate();
    const envelope: TemplateEnvelope = {
      ...base,
      match: { ...base.match, anchors: ["Max Probemann"] },
    };
    const result = buildCommunityExport(input(envelope, ["Max Probemann"]));
    expect(result).toMatchObject({ ok: false, refusal: "containsPersonalData" });
  });

  it("refuses an e-mail address or a long number anywhere it cannot be removed", () => {
    const base = workshopTemplate();
    const envelope: TemplateEnvelope = {
      ...base,
      extraction: {
        ...base.extraction,
        fields: { ...base.extraction.fields, phone: { value: "+49 1701234567" } },
      },
    };
    expect(buildCommunityExport(input(envelope))).toMatchObject({
      ok: false,
      found: [{ kind: "number", path: "extraction.fields.phone.value" }],
    });
  });
});

describe("every v2 workshop domain shares without a false alarm", () => {
  type Derive = (i: {
    trainingDataId: string;
    subject: string;
    fullText: string;
    selections: AnnotationSelection[];
  }) => { ok: true; template: TemplateEnvelope } | { ok: false; refusal: string };
  const cases: [string, Derive, string, string, AnnotationSelection[]][] = [
    ["rail", deriveRailTemplate, RAIL_SUBJECT, RAIL_SOURCE, RAIL_SELECTIONS],
    ["rental", deriveRentalTemplate, RENTAL_SUBJECT, RENTAL_SOURCE, RENTAL_SELECTIONS],
    ["package", derivePackageTemplate, PACKAGE_SUBJECT, PACKAGE_SOURCE, PACKAGE_SELECTIONS],
    ["cruise", deriveCruiseTemplate, CRUISE_SUBJECT, CRUISE_SOURCE, CRUISE_SELECTIONS],
    ["place", derivePlaceTemplate, PLACE_SUBJECT, PLACE_SOURCE, PLACE_SELECTIONS],
    ["ferry", deriveFerryTemplate, FERRY_SUBJECT, FERRY_SOURCE, FERRY_SELECTIONS],
  ];
  it.each(cases)("%s", (domain, derive, subject, fullText, selections) => {
    const derived = derive({ trainingDataId: `td-${domain}`, subject, fullText, selections });
    if (!derived.ok) throw new Error(derived.refusal);
    const result = buildCommunityExport({
      envelope: derived.template,
      personal: { marked: selections, identity: [] },
      appVersion: "2.9.0",
      today: "2026-10-20",
    });
    expect(result).toMatchObject({ ok: true, removed: [] });
    if (result.ok) expect(result.template.id.startsWith(`${domain}:`)).toBe(true);
  });
});

describe("the share target", () => {
  it("slugs the issuer's name the way the repository names its files", () => {
    expect(templateSlug("Inselfähren Probesee AG", "ferry")).toBe("inselfahren-probesee-ag");
    expect(templateSlug("Straße & Söhne", "bus")).toBe("strasse-sohne");
    expect(templateSlug("!!!", "bus")).toBe("bus-template");
  });

  it("opens GitHub's new-file page in the domain's folder", () => {
    expect(githubNewFileUrl("ferry", "inselfahren-probesee-ag.json")).toBe(
      "https://github.com/Abrechen2/travstats-templates/new/main/ferry?filename=inselfahren-probesee-ag.json"
    );
  });
});
