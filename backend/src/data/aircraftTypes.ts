/**
 * Common commercial aircraft types for autocomplete suggestions.
 * Format: { icao: ICAO type designator, name: display name }
 * Sorted alphabetically by manufacturer, then model.
 */

export interface AircraftType {
  icao: string;
  name: string;
}

export const AIRCRAFT_TYPES: AircraftType[] = [
  // Airbus
  { icao: "BCS1", name: "Airbus A220-100" },
  { icao: "A223", name: "Airbus A220-300" },
  { icao: "A306", name: "Airbus A300-600" },
  { icao: "A310", name: "Airbus A310" },
  { icao: "A318", name: "Airbus A318" },
  { icao: "A319", name: "Airbus A319" },
  { icao: "A19N", name: "Airbus A319neo" },
  { icao: "A320", name: "Airbus A320" },
  { icao: "A20N", name: "Airbus A320neo" },
  { icao: "A321", name: "Airbus A321" },
  { icao: "A21N", name: "Airbus A321neo" },
  { icao: "A332", name: "Airbus A330-200" },
  { icao: "A333", name: "Airbus A330-300" },
  { icao: "A338", name: "Airbus A330-800neo" },
  { icao: "A339", name: "Airbus A330-900neo" },
  { icao: "A342", name: "Airbus A340-200" },
  { icao: "A343", name: "Airbus A340-300" },
  { icao: "A345", name: "Airbus A340-500" },
  { icao: "A346", name: "Airbus A340-600" },
  { icao: "A359", name: "Airbus A350-900" },
  { icao: "A35K", name: "Airbus A350-1000" },
  { icao: "A388", name: "Airbus A380-800" },

  // ATR
  { icao: "AT43", name: "ATR 42-300" },
  { icao: "AT45", name: "ATR 42-500" },
  { icao: "AT46", name: "ATR 42-600" },
  { icao: "AT72", name: "ATR 72-500" },
  { icao: "AT76", name: "ATR 72-600" },

  // Boeing
  { icao: "B712", name: "Boeing 717-200" },
  { icao: "B732", name: "Boeing 737-200" },
  { icao: "B733", name: "Boeing 737-300" },
  { icao: "B734", name: "Boeing 737-400" },
  { icao: "B735", name: "Boeing 737-500" },
  { icao: "B736", name: "Boeing 737-600" },
  { icao: "B737", name: "Boeing 737-700" },
  { icao: "B738", name: "Boeing 737-800" },
  { icao: "B739", name: "Boeing 737-900" },
  { icao: "B37M", name: "Boeing 737 MAX 7" },
  { icao: "B38M", name: "Boeing 737 MAX 8" },
  { icao: "B39M", name: "Boeing 737 MAX 9" },
  { icao: "B3XM", name: "Boeing 737 MAX 10" },
  { icao: "B742", name: "Boeing 747-200" },
  { icao: "B743", name: "Boeing 747-300" },
  { icao: "B744", name: "Boeing 747-400" },
  { icao: "B748", name: "Boeing 747-8" },
  { icao: "B752", name: "Boeing 757-200" },
  { icao: "B753", name: "Boeing 757-300" },
  { icao: "B762", name: "Boeing 767-200" },
  { icao: "B763", name: "Boeing 767-300" },
  { icao: "B764", name: "Boeing 767-400" },
  { icao: "B772", name: "Boeing 777-200" },
  { icao: "B77L", name: "Boeing 777-200LR" },
  { icao: "B77W", name: "Boeing 777-300ER" },
  { icao: "B778", name: "Boeing 777-8" },
  { icao: "B779", name: "Boeing 777-9" },
  { icao: "B788", name: "Boeing 787-8" },
  { icao: "B789", name: "Boeing 787-9" },
  { icao: "B78X", name: "Boeing 787-10" },

  // Bombardier / De Havilland Canada
  { icao: "CRJ1", name: "Bombardier CRJ-100" },
  { icao: "CRJ2", name: "Bombardier CRJ-200" },
  { icao: "CRJ7", name: "Bombardier CRJ-700" },
  { icao: "CRJ9", name: "Bombardier CRJ-900" },
  { icao: "CRJX", name: "Bombardier CRJ-1000" },
  { icao: "DH8A", name: "De Havilland Dash 8-100" },
  { icao: "DH8D", name: "De Havilland Dash 8-400" },

  // Embraer
  { icao: "E170", name: "Embraer E170" },
  { icao: "E75S", name: "Embraer E175" },
  { icao: "E190", name: "Embraer E190" },
  { icao: "E195", name: "Embraer E195" },
  { icao: "E290", name: "Embraer E190-E2" },
  { icao: "E295", name: "Embraer E195-E2" },
  { icao: "E135", name: "Embraer ERJ-135" },
  { icao: "E145", name: "Embraer ERJ-145" },

  // COMAC
  { icao: "C919", name: "COMAC C919" },
  { icao: "AJ27", name: "COMAC ARJ21" },

  // Fokker
  { icao: "F70", name: "Fokker 70" },
  { icao: "F100", name: "Fokker 100" },

  // McDonnell Douglas (legacy, still in service)
  { icao: "MD82", name: "McDonnell Douglas MD-82" },
  { icao: "MD83", name: "McDonnell Douglas MD-83" },
  { icao: "MD87", name: "McDonnell Douglas MD-87" },
  { icao: "MD88", name: "McDonnell Douglas MD-88" },
  { icao: "MD90", name: "McDonnell Douglas MD-90" },
  { icao: "MD11", name: "McDonnell Douglas MD-11" },

  // Saab
  { icao: "SF34", name: "Saab 340" },
  { icao: "SB20", name: "Saab 2000" },

  // Sukhoi
  { icao: "SU95", name: "Sukhoi Superjet 100" },

  // Tupolev
  { icao: "T204", name: "Tupolev Tu-204" },
  { icao: "T214", name: "Tupolev Tu-214" },
];
