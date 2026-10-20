import { prisma } from "../../db";
import { templateRegistry } from "../parsers/templates/registry";
import type { TemplateEnvelope } from "../parsers/templates/v2/envelope";
import { envelopeMatches } from "../parsers/templates/v2/runners";
import { loadActiveWorkshopTemplates } from "../parsers/userTemplates/v2UserTemplates";
import {
  applyV2RideTicketTemplate,
  type ParsedRideTicket,
  type RideTicketDomain,
} from "./v2RideTicket";

/**
 * Why a bus or ferry document was not read, as a stable code the client
 * words in its own language:
 *  - `noTemplate`  no template of this domain claims the document — neither
 *                  the repository's nor one of the user's own;
 *  - `nothingRead` a template claimed it, but read no complete ride from it.
 */
export type RideTicketFallbackCode = "noTemplate" | "nothingRead";

export type RideTicketReading =
  | { ticket: ParsedRideTicket; fallbackCode?: undefined }
  | { ticket: null; fallbackCode: RideTicketFallbackCode };

async function homeCountryOf(userId: string | undefined): Promise<string | null> {
  if (userId === undefined) return null;
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { homeCountry: true },
  });
  return settings?.homeCountry ?? null;
}

/**
 * The templates tried on a `domain` document, in the order they are tried:
 * the repository's first (home market first), then the caller's own ACTIVE
 * workshop templates — the precedence rail, rental, cruise and lodging use. A
 * template measured against a corpus keeps the first look; a personal one
 * proven by a single preview takes what those decline.
 */
export async function rideTicketTemplates(
  domain: RideTicketDomain,
  userId: string | undefined
): Promise<TemplateEnvelope[]> {
  const repository = templateRegistry.getActiveV2({
    domain,
    homeCountry: await homeCountryOf(userId),
  });
  const workshop = userId === undefined ? [] : await loadActiveWorkshopTemplates(userId, domain);
  return [...repository, ...workshop];
}

/**
 * Read a coach or ferry ticket with templates only — template or decline, as
 * the rental reader does. There is no model fallback here: the ferry preview
 * keeps its own labelled-facts and model path behind this one
 * (`ferry/ticketPreview.ts`).
 */
export async function readRideTicket(
  domain: RideTicketDomain,
  document: string,
  userId: string | undefined,
  templates?: readonly TemplateEnvelope[]
): Promise<RideTicketReading> {
  const candidates = templates ?? (await rideTicketTemplates(domain, userId));
  if (candidates.length === 0) return { ticket: null, fallbackCode: "noTemplate" };
  let claimed = false;
  for (const template of candidates) {
    const ticket = applyV2RideTicketTemplate(template, document);
    if (ticket) return { ticket };
    claimed ||= envelopeMatches(template, document);
  }
  return { ticket: null, fallbackCode: claimed ? "nothingRead" : "noTemplate" };
}
