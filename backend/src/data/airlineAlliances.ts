/**
 * Full members of the three global airline alliances, by IATA designator —
 * the ONE list both the Alliance All-Star achievement and the loyalty pickers
 * read (forgejo#133). Before this, the membership lived only inside the
 * achievement table, keyed by a mix of display names and codes, and the
 * Companion had to mirror it by hand; a mirror drifts.
 *
 * Full members only. Affiliates and regional operators that fly under a
 * member's code (United Express, Air Canada Rouge, ...) share that member's
 * designator and are covered by it; a suspended member (Aeroflot, SkyTeam,
 * since 28.04.2022) is left out, because a programme cannot be credited on it.
 *
 * Source, measured 2026-09-26: Wikidata property P114 "airline alliance"
 * (CC0) for the membership statements and their start/end qualifiers, cross-
 * checked against the member tables of the English Wikipedia articles and,
 * for oneworld, the alliance's own member page (https://www.oneworld.com/members).
 * Membership is factual data; nothing here is copied prose.
 *
 * Movements this list encodes, each with its date, because a stale entry here
 * silently credits the wrong alliance:
 *   - SAS (SK): left Star Alliance 31.08.2024, SkyTeam since 01.09.2024.
 *   - ITA Airways (AZ): left SkyTeam 30.04.2025, Star Alliance since 01.04.2026.
 *   - Fiji Airways (FJ): oneworld full member since 01.04.2025 (was Connect).
 *   - Oman Air (WY): oneworld since 30.06.2025.
 *   - Hawaiian Airlines (HA): oneworld since 23.04.2026, under Alaska Air Group.
 *   - NOT yet listed: Philippine Airlines (PR), invited to oneworld 06/2026 but
 *     not a member.
 *   - Asiana (OZ) leaves Star Alliance on 17.12.2026 (integration into Korean
 *     Air). Its entry carries `until: "2026-12-17"`, the first day it is no
 *     longer a member, so the list resolves itself on that date.
 *
 * An entry is a bare designator, or `{ code, until }` for a membership with a
 * known end. `until` is a UTC calendar day and EXCLUSIVE. Every reader asks
 * for the list AT a moment (`allianceMembersAt`), never for a frozen constant.
 */

export const ALLIANCE_IDS = ["star", "skyteam", "oneworld"] as const;
export type AllianceId = (typeof ALLIANCE_IDS)[number];

/** The date the membership below was last checked against its sources. */
export const ALLIANCE_MEMBERSHIP_AS_OF = "2026-09-26";

/** A designator, or a designator whose membership ends (exclusive UTC day). */
export type MemberEntry = string | { code: string; until: string };

const MEMBER_ENTRIES: Readonly<Record<AllianceId, readonly MemberEntry[]>> = {
  star: [
    "A3", // Aegean Airlines
    "AC", // Air Canada
    "CA", // Air China
    "AI", // Air India
    "NZ", // Air New Zealand
    "NH", // All Nippon Airways
    { code: "OZ", until: "2026-12-17" }, // Asiana Airlines
    "OS", // Austrian Airlines
    "AV", // Avianca
    "SN", // Brussels Airlines
    "CM", // Copa Airlines
    "OU", // Croatia Airlines
    "MS", // EgyptAir
    "ET", // Ethiopian Airlines
    "BR", // EVA Air
    "AZ", // ITA Airways
    "LO", // LOT Polish Airlines
    "LH", // Lufthansa
    "ZH", // Shenzhen Airlines
    "SQ", // Singapore Airlines
    "SA", // South African Airways
    "LX", // Swiss International Air Lines
    "TP", // TAP Air Portugal
    "TG", // Thai Airways International
    "TK", // Turkish Airlines
    "UA", // United Airlines
  ],
  skyteam: [
    "AR", // Aerolíneas Argentinas
    "AM", // Aeroméxico
    "UX", // Air Europa
    "AF", // Air France
    "CI", // China Airlines
    "MU", // China Eastern Airlines
    "DL", // Delta Air Lines
    "GA", // Garuda Indonesia
    "KQ", // Kenya Airways
    "KL", // KLM
    "KE", // Korean Air
    "ME", // Middle East Airlines
    "SV", // Saudia
    "SK", // Scandinavian Airlines
    "RO", // TAROM
    "VN", // Vietnam Airlines
    "VS", // Virgin Atlantic
    "MF", // XiamenAir
  ],
  oneworld: [
    "AS", // Alaska Airlines
    "AA", // American Airlines
    "BA", // British Airways
    "CX", // Cathay Pacific
    "FJ", // Fiji Airways
    "AY", // Finnair
    "HA", // Hawaiian Airlines
    "IB", // Iberia
    "JL", // Japan Airlines
    "MH", // Malaysia Airlines
    "WY", // Oman Air
    "QF", // Qantas
    "QR", // Qatar Airways
    "AT", // Royal Air Maroc
    "RJ", // Royal Jordanian
    "UL", // SriLankan Airlines
  ],
};

const isMemberAt = (entry: MemberEntry, day: string): boolean =>
  typeof entry === "string" || day < entry.until;
const codeOf = (entry: MemberEntry): string => (typeof entry === "string" ? entry : entry.code);

/** The full members of each alliance at `now` (an ended membership is gone). */
export function allianceMembersAt(now: Date = new Date()): Record<AllianceId, string[]> {
  const day = now.toISOString().slice(0, 10);
  const at = (id: AllianceId): string[] =>
    MEMBER_ENTRIES[id].filter((e) => isMemberAt(e, day)).map(codeOf);
  return { star: at("star"), skyteam: at("skyteam"), oneworld: at("oneworld") };
}

/** The alliance an IATA airline designator belongs to at `now`, or null. */
export function allianceOfIata(code: string, now: Date = new Date()): AllianceId | null {
  const up = code.trim().toUpperCase();
  const members = allianceMembersAt(now);
  return ALLIANCE_IDS.find((id) => members[id].includes(up)) ?? null;
}
