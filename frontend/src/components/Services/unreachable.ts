/**
 * What the app does when a service does not answer (forgejo#88): the sentence
 * each card of an outside service carries, as the key under
 * `settings:unreachable`. A service with no entry is the server's own (mail,
 * push, the other servers) or has no fallback worth a sentence.
 */
export const UNREACHABLE_NOTE: Readonly<Record<string, string>> = {
  airlabs: "flightProvider",
  aviationstack: "flightProvider",
  aerodatabox: "aerodatabox",
  aeroapi: "flightProvider",
  opensky: "flightProvider",
  adsblol: "flightProvider",
  adsbx: "flightProvider",
  openrouteservice: "routing",
  graphhopper: "routing",
  selfHostedRouting: "routing",
  railTimetables: "rail",
  immich: "immich",
  dawarich: "dawarich",
  strava: "strava",
  openData: "openData",
};
