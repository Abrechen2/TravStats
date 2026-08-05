// Airline/aircraft catalogue types — mirror backend/prisma/schema.prisma
// `Airline` and `Aircraft` models (nullable Prisma columns come back as
// `null`, never `undefined`, so these follow the same convention as
// `types/cruise.ts`).

export interface Airline {
  id: number;
  iata: string | null;
  icao: string | null;
  name: string;
  callsign: string | null;
  country: string | null;
  active: boolean;
  isUserAdded: boolean;
}

export interface Aircraft {
  id: number;
  icao: string | null;
  name: string;
  isUserAdded: boolean;
}
