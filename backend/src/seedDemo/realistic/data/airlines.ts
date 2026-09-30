/**
 * Airlines by the IATA prefix of their flight numbers — the only airlines the
 * demo traveller flew. A flight number whose prefix is missing here is a
 * broken seed, and the writer says so.
 */
export const AIRLINES: Readonly<Record<string, { name: string; icao: string }>> = {
  EW: { name: "Eurowings", icao: "EWG" },
  LH: { name: "Lufthansa", icao: "DLH" },
  OS: { name: "Austrian Airlines", icao: "AUA" },
  LX: { name: "Swiss", icao: "SWR" },
  BA: { name: "British Airways", icao: "BAW" },
  KL: { name: "KLM", icao: "KLM" },
  SK: { name: "SAS", icao: "SAS" },
  TP: { name: "TAP Air Portugal", icao: "TAP" },
  TK: { name: "Turkish Airlines", icao: "THY" },
  EK: { name: "Emirates", icao: "UAE" },
  TG: { name: "Thai Airways", icao: "THA" },
  NH: { name: "ANA", icao: "ANA" },
  VN: { name: "Vietnam Airlines", icao: "HVN" },
  DE: { name: "Condor", icao: "CFG" },
  EI: { name: "Aer Lingus", icao: "EIN" },
  FI: { name: "Icelandair", icao: "ICE" },
  FR: { name: "Ryanair", icao: "RYR" },
  U2: { name: "easyJet", icao: "EZY" },
  DY: { name: "Norwegian", icao: "NOZ" },
  WF: { name: "Widerøe", icao: "WIF" },
  FD: { name: "Thai AirAsia", icao: "AIQ" },
};
