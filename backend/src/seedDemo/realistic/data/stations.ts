/**
 * The railway stations of the demo account's journeys, with their UIC codes
 * where the station has one. The seed links a journey to the station
 * catalogue by that code when the catalogue is loaded, and keeps the name and
 * coordinates on the row either way — the catalogue is seeded by the server
 * and may not exist yet when the demo is written.
 */

export interface StationSpec {
  name: string;
  uic: string | null;
  lat: number;
  lon: number;
  country: string;
}

// The DE/AT rows below used to carry the station's DB "Bahnhofsnummer" (EVA
// number, e.g. 8000207 for Köln Hbf) in the `uic` field. That is the wrong
// identifier: the catalogue's `uic` column is the international UIC code
// (8015458 for the same station), a different number series. The mistake was
// silent in two ways — mostly the EVA number matches no `uic` value at all,
// so the journey's station link stayed null; but for Berlin Hbf the EVA
// number (8011160) happens to equal Offenbach (Main) Ost's real UIC code, so
// the journey linked to a station 350 km away in a different city instead of
// abstaining. Values below are the catalogue's actual `uic` column (verified
// against data/rail/stations.csv.gz); Koblenz Hbf has none in that catalogue
// snapshot, so it stays null rather than guessing.
export const STATIONS = {
  koeln: { name: "Köln Hbf", uic: "8015458", lat: 50.943, lon: 6.9589, country: "DE" },
  berlin: { name: "Berlin Hbf", uic: "8065969", lat: 52.525, lon: 13.3694, country: "DE" },
  muenchen: { name: "München Hbf", uic: "8020347", lat: 48.1402, lon: 11.5586, country: "DE" },
  hamburg: { name: "Hamburg Hbf", uic: "8001071", lat: 53.553, lon: 10.0067, country: "DE" },
  kiel: { name: "Kiel Hbf", uic: "8001304", lat: 54.3143, lon: 10.1319, country: "DE" },
  frankfurtAirport: {
    name: "Frankfurt(M) Flughafen Fernbf",
    uic: "8061676",
    lat: 50.053,
    lon: 8.57,
    country: "DE",
  },
  trier: { name: "Trier Hbf", uic: "8025181", lat: 49.7567, lon: 6.6522, country: "DE" },
  koblenz: { name: "Koblenz Hbf", uic: null, lat: 50.351, lon: 7.5885, country: "DE" },
  bruxellesMidi: {
    name: "Bruxelles-Midi",
    uic: "8814001",
    lat: 50.8356,
    lon: 4.3365,
    country: "BE",
  },
  brugge: { name: "Brugge", uic: "8891009", lat: 51.1972, lon: 3.217, country: "BE" },
  amsterdam: { name: "Amsterdam Centraal", uic: "8400058", lat: 52.3789, lon: 4.9, country: "NL" },
  parisNord: { name: "Paris Nord", uic: "8727100", lat: 48.8809, lon: 2.3553, country: "FR" },
  wien: { name: "Wien Hbf", uic: "8101003", lat: 48.1852, lon: 16.3782, country: "AT" },
  basel: { name: "Basel SBB", uic: "8500010", lat: 47.5474, lon: 7.5896, country: "CH" },
  visp: { name: "Visp", uic: "8501605", lat: 46.2941, lon: 7.8815, country: "CH" },
  zermatt: { name: "Zermatt", uic: "8501689", lat: 46.024, lon: 7.7476, country: "CH" },
  stMoritz: { name: "St. Moritz", uic: "8509253", lat: 46.4984, lon: 9.8453, country: "CH" },
  chur: { name: "Chur", uic: "8509000", lat: 46.8532, lon: 9.529, country: "CH" },
  franzensfeste: {
    name: "Franzensfeste/Fortezza",
    uic: null,
    lat: 46.7894,
    lon: 11.6121,
    country: "IT",
  },
  bangkok: { name: "Krung Thep Aphiwat", uic: null, lat: 13.8046, lon: 100.5402, country: "TH" },
  chiangMai: { name: "Chiang Mai", uic: null, lat: 18.7836, lon: 99.0136, country: "TH" },
  tokyo: { name: "Tokyo", uic: null, lat: 35.6812, lon: 139.7671, country: "JP" },
  kyoto: { name: "Kyoto", uic: null, lat: 34.9858, lon: 135.7588, country: "JP" },
  hiroshima: { name: "Hiroshima", uic: null, lat: 34.3976, lon: 132.4755, country: "JP" },
} satisfies Record<string, StationSpec>;

export type StationKey = keyof typeof STATIONS;
