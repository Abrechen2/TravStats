import { ALL_ACCOR, BONVOY, MILES_AND_MORE, place } from "./build";
import type { PlaceSpec } from "./types";
import type { Anchor } from "../time";

/**
 * What belongs to the traveller rather than to one trip: the three loyalty
 * cards (with the status held today — the loyalty rework keeps no history),
 * the places near home, the wish list, and the checklists subscribed to.
 */

export interface MembershipSpec {
  domain: "flight" | "lodging";
  programName: string;
  /** Made-up numbers in the programmes' own formats. */
  membershipNumber: string;
  tier: string;
  airlineCodes?: string[];
  /** Catalogue chains the card covers, by name. */
  chains?: string[];
}

export const MEMBERSHIPS: readonly MembershipSpec[] = [
  {
    domain: "flight",
    programName: MILES_AND_MORE,
    membershipNumber: "992003447188265",
    tier: "Frequent Traveller",
    airlineCodes: ["LH", "LX", "OS", "EW", "SK", "TK", "TP", "NH"],
  },
  {
    domain: "lodging",
    programName: BONVOY,
    membershipNumber: "847219563",
    tier: "Gold Elite",
    chains: ["Marriott"],
  },
  {
    domain: "lodging",
    programName: ALL_ACCOR,
    membershipNumber: "3081031722956644",
    tier: "Silver",
    chains: ["Accor"],
  },
];

const KOELN = ["Köln", "Deutschland", "DE"] as const;

/**
 * Visited at home, on no trip — a home café is not a journey. Each on a day
 * no trip covers, or the inbox would propose adding it to that trip.
 */
export const HOME_PLACES: ReadonlyArray<{ place: PlaceSpec; on: Anchor }> = [
  {
    place: place("Café Reichard", "restaurant", 50.9406, 6.9567, KOELN, 0, 4),
    on: { yearsAgo: 3, month: 12, day: 20 },
  },
  {
    place: place("Törtchen Törtchen", "restaurant", 50.9365, 6.9443, KOELN, 0, 5),
    on: { daysFromNow: -20 },
  },
  {
    place: place("Kölner Dom", "landmark", 50.9413, 6.9583, KOELN, 0, 5, {
      curated: "world-heritage:292",
    }),
    on: { yearsAgo: 2, month: 12, day: 27 },
  },
  {
    place: place(
      "Nationalpark Eifel",
      "nature",
      50.5667,
      6.4167,
      ["Eifel", "Deutschland", "DE"],
      0,
      5,
      {
        curated: "nationalparks-de:Q705097",
      }
    ),
    on: { yearsAgo: 1, month: 4, day: 12 },
  },
];

/** Not visited yet: the wish list. */
export const WISHLIST: readonly PlaceSpec[] = [
  place("Machu Picchu", "landmark", -13.1631, -72.545, ["Cusco", "Peru", "PE"], null, undefined, {
    curated: "world-heritage:274",
  }),
  place("Petra", "landmark", 30.3285, 35.4444, ["Wadi Musa", "Jordanien", "JO"], null, undefined, {
    curated: "world-heritage:326",
  }),
  place("Moraine Lake", "nature", 51.3217, -116.186, ["Banff", "Kanada", "CA"], null, undefined, {
    curated: "world-heritage:304",
  }),
  place(
    "Galápagos-Inseln",
    "nature",
    -0.9538,
    -90.9656,
    ["Galápagos", "Ecuador", "EC"],
    null,
    undefined,
    {
      curated: "world-heritage:1",
    }
  ),
];

export interface OwnListSpec {
  name: string;
  color: string;
  icon: string;
  description: string;
  /** Places by name, from anywhere in the account. */
  members: readonly string[];
}

export const OWN_LISTS: readonly OwnListSpec[] = [
  {
    name: "Bucket List",
    color: "#f59e0b",
    icon: "⭐",
    description: "Irgendwann, bestimmt.",
    members: ["Machu Picchu", "Petra", "Moraine Lake", "Galápagos-Inseln", "Fuji", "Burg Eltz"],
  },
  {
    name: "Lieblingscafés",
    color: "#a16207",
    icon: "☕",
    description: "Wo ich immer wieder hingehe.",
    members: ["Café Reichard", "Törtchen Törtchen", "Café Sperl", "Torvehallerne"],
  },
  {
    name: "Die schönsten Aussichten",
    color: "#0ea5e9",
    icon: "🔭",
    description: "",
    members: [
      "Tunnel View",
      "Preikestolen",
      "Stilfser Joch",
      "Cinque Torri",
      "Arthur's Seat",
      "Tafelberg",
    ],
  },
];

/** Curated checklists the traveller follows. */
export const SUBSCRIBED_CHECKLISTS = ["world-heritage", "nationalparks-us"] as const;
