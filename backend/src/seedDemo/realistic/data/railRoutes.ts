import type { StationKey } from "./stations";

/**
 * The lines the demo account's train rides are drawn with: one per station
 * pair, routed ONCE over the OpenStreetMap rail network by BRouter's `rail`
 * profile (`scripts/demo/generateDemoRailGeometry.ts`) and stored in
 * `seedData/demo/rail-lines.json.gz`. A ride in the other direction uses the
 * same line reversed.
 *
 * `via` are points the real service passes and the shortest track would not
 * (the high-speed line instead of the Rhine valley, the Brenner instead of
 * the Tauern): without them the line is a possible route over the tracks, not
 * the train's. `[lat, lon]`, like the route specs of the tours.
 */

export interface RailRouteSpec {
  from: StationKey;
  to: StationKey;
  via: ReadonlyArray<readonly [number, number]>;
}

export const RAIL_ROUTES: readonly RailRouteSpec[] = [
  // ICE Köln – Berlin over Hagen, Hamm, Bielefeld, Hannover, Wolfsburg.
  {
    from: "koeln",
    to: "berlin",
    via: [
      [51.6781, 7.8083],
      [52.3765, 9.741],
      [52.4298, 10.7878],
    ],
  },
  // ICE Köln – München over the high-speed line, Frankfurt, Mannheim, Stuttgart, Ulm.
  {
    from: "koeln",
    to: "muenchen",
    via: [
      [50.053, 8.57],
      [49.4795, 8.4697],
      [48.7843, 9.1817],
      [48.3994, 9.9829],
    ],
  },
  // ICE Köln – Hamburg over Dortmund, Münster, Osnabrück, Bremen.
  {
    from: "koeln",
    to: "hamburg",
    via: [
      [51.5178, 7.459],
      [51.9567, 7.6352],
      [52.2728, 8.0616],
      [53.0831, 8.8134],
    ],
  },
  { from: "hamburg", to: "kiel", via: [[54.0676, 9.9807]] },
  // ICE Köln – Frankfurt Flughafen on the Köln–Rhein/Main high-speed line (Siegburg, Montabaur).
  {
    from: "koeln",
    to: "frankfurtAirport",
    via: [
      [50.7938, 7.2031],
      [50.4452, 7.8255],
    ],
  },
  // Nightjet Köln – Wien over Frankfurt (Süd), Würzburg, Nürnberg, Passau, Linz.
  {
    from: "koeln",
    to: "wien",
    via: [
      [50.0993, 8.6862],
      [49.8018, 9.9359],
      [49.4458, 11.0823],
      [48.5739, 13.4508],
      [48.2904, 14.2918],
    ],
  },
  // ICE Köln – Amsterdam over Düsseldorf, Oberhausen, Arnhem, Utrecht.
  {
    from: "koeln",
    to: "amsterdam",
    via: [
      [51.2199, 6.7943],
      [51.4746, 6.8514],
      [51.9848, 5.8998],
      [52.0894, 5.1101],
    ],
  },
  // ICE / Thalys Köln – Brussels / Paris over Aachen and Liège.
  {
    from: "koeln",
    to: "bruxellesMidi",
    via: [
      [50.7679, 6.0912],
      [50.6245, 5.5667],
    ],
  },
  {
    from: "koeln",
    to: "parisNord",
    via: [
      [50.7679, 6.0912],
      [50.6245, 5.5667],
      [50.8356, 4.3365],
    ],
  },
  { from: "bruxellesMidi", to: "brugge", via: [[51.0357, 3.7108]] },
  // Regional: the Eifel line to Trier, the left Rhine line (Remagen) to Koblenz.
  {
    from: "koeln",
    to: "trier",
    via: [
      [50.6588, 6.7911],
      [50.2226, 6.6645],
    ],
  },
  { from: "koblenz", to: "koeln", via: [[50.5768, 7.2303]] },
  // ICE Köln – Basel over Mannheim, Karlsruhe, Freiburg.
  {
    from: "koeln",
    to: "basel",
    via: [
      [50.053, 8.57],
      [49.4795, 8.4697],
      [48.9935, 8.4003],
      [47.9977, 7.8412],
    ],
  },
  // Basel – Visp over Bern and the Lötschberg base tunnel.
  {
    from: "basel",
    to: "visp",
    via: [
      [46.9489, 7.4391],
      [46.6887, 7.6802],
    ],
  },
  { from: "visp", to: "zermatt", via: [] },
  // Glacier Express: Brig, the Furka base tunnel, Andermatt, Oberalp, Disentis, Albula.
  {
    from: "zermatt",
    to: "stMoritz",
    via: [
      [46.3196, 7.9884],
      [46.6364, 8.5942],
      [46.7038, 8.8519],
      [46.6989, 9.4434],
      [46.6378, 9.6727],
    ],
  },
  {
    from: "stMoritz",
    to: "chur",
    via: [
      [46.6378, 9.6727],
      [46.6989, 9.4434],
    ],
  },
  { from: "chur", to: "basel", via: [[47.3779, 8.5403]] },
  // EC München – Brenner – Franzensfeste over Rosenheim, Kufstein, Innsbruck.
  {
    from: "muenchen",
    to: "franzensfeste",
    via: [
      [47.8499, 12.1197],
      [47.5831, 12.1653],
      [47.2633, 11.4008],
      [47.0024, 11.5073],
    ],
  },
  // Thailand's Northern Line over Ayutthaya, Phitsanulok, Lampang.
  {
    from: "bangkok",
    to: "chiangMai",
    via: [
      [14.3563, 100.5846],
      [16.8154, 100.2638],
      [18.2787, 99.5063],
    ],
  },
  // Tōkaidō and San'yō corridor. Shin-Yokohama and Shin-Osaka are not used as
  // via points: BRouter snaps them to a track that leaves the corridor and
  // came back 100–170 km longer (measured 2026-09-27); Shinagawa, Kawasaki,
  // Takatsuki and Ōsaka keep the line beside the Shinkansen instead.
  {
    from: "tokyo",
    to: "kyoto",
    via: [
      [35.6285, 139.7387],
      [35.5313, 139.6969],
      [35.1709, 136.8816],
    ],
  },
  {
    from: "kyoto",
    to: "hiroshima",
    via: [
      [34.8515, 135.6178],
      [34.7025, 135.4959],
      [34.6664, 133.9181],
    ],
  },
  {
    from: "tokyo",
    to: "hiroshima",
    via: [
      [35.6285, 139.7387],
      [35.5313, 139.6969],
      [35.1709, 136.8816],
      [34.9858, 135.7588],
      [34.8515, 135.6178],
      [34.7025, 135.4959],
      [34.6664, 133.9181],
    ],
  },
];

/** The stored line's key: the pair in the order `RAIL_ROUTES` names it. */
export const railRouteKey = (from: StationKey, to: StationKey): string => `${from}>${to}`;
