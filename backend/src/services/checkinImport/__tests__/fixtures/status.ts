/** One synthetic Träwelling export status in the real shape (see travelling.ts). */
const STATIONS: Record<string, { id: number; lat?: number; lon?: number; ibnr?: string }> = {
  "Alpha Hbf": { id: 11, lat: 52.5, lon: 13.4, ibnr: "8999001" },
  "Beta Hbf": { id: 12, lat: 53.5, lon: 10 },
  // No position: a name the catalogue does not know stays unresolved.
  "Nowhere Nord": { id: 31 },
};

const station = (name: string) => {
  const s = STATIONS[name] ?? { id: 99 };
  return {
    id: s.id,
    name,
    latitude: s.lat,
    longitude: s.lon,
    identifiers: s.ibnr ? [{ type: "de_db_ibnr", identifier: s.ibnr }] : [],
  };
};

export function status(o: {
  category?: string;
  lineName?: string;
  journeyNumber?: string;
  from?: string;
  to?: string;
  dep: string;
  arr?: string;
}) {
  const from = o.from ?? "Alpha Hbf";
  const to = o.to ?? "Beta Hbf";
  return {
    id: 1,
    body: "",
    checkin: {
      category: o.category ?? "regional",
      lineName: o.lineName,
      journeyNumber: o.journeyNumber,
      origin: { id: station(from).id, name: from, departurePlanned: o.dep },
      destination: { id: station(to).id, name: to, arrivalPlanned: o.arr ?? null },
      tripOrigin: station(from),
      tripDestination: station(to),
    },
  };
}
