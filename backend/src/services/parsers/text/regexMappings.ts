/**
 * Static data constants used by the regex parser:
 * city-to-IATA mappings, PNR false positives, month names,
 * IATA context patterns, valid IATA code whitelist, and
 * flight-number false-positive prefixes.
 */

// City name to IATA code mapping (common German/European cities)
export const CITY_TO_IATA: Record<string, string> = {
  münchen: 'MUC', munchen: 'MUC', muenchen: 'MUC', munich: 'MUC',
  frankfurt: 'FRA',
  berlin: 'BER', 'berlin-tegel': 'TXL',
  hamburg: 'HAM',
  düsseldorf: 'DUS', dusseldorf: 'DUS', duesseldorf: 'DUS',
  köln: 'CGN', koln: 'CGN', koeln: 'CGN', cologne: 'CGN',
  stuttgart: 'STR', hannover: 'HAJ',
  nürnberg: 'NUE', nurnberg: 'NUE', nuernberg: 'NUE', nuremberg: 'NUE',
  leipzig: 'LEJ', dresden: 'DRS', bremen: 'BRE',
  luxemburg: 'LUX', luxembourg: 'LUX',
  paris: 'CDG', london: 'LHR', amsterdam: 'AMS',
  brüssel: 'BRU', brussel: 'BRU', bruessel: 'BRU', brussels: 'BRU',
  wien: 'VIE', vienna: 'VIE',
  salzburg: 'SZG',
  graz: 'GRZ',
  innsbruck: 'INN',
  linz: 'LNZ',
  basel: 'BSL',
  bern: 'BRN',
  zürich: 'ZRH', zurich: 'ZRH', genf: 'GVA', geneva: 'GVA',
  rom: 'FCO', rome: 'FCO', mailand: 'MXP', milan: 'MXP',
  barcelona: 'BCN', madrid: 'MAD', lissabon: 'LIS', lisbon: 'LIS',
  kopenhagen: 'CPH', copenhagen: 'CPH', stockholm: 'ARN', oslo: 'OSL',
  prag: 'PRG', prague: 'PRG', warschau: 'WAW', warsaw: 'WAW',
  budapest: 'BUD', istanbul: 'IST', athen: 'ATH', athens: 'ATH',
  helsinki: 'HEL',
  osaka: 'KIX', 'osaka-kansai': 'KIX', kansai: 'KIX',
  tokyo: 'NRT', tokio: 'NRT', narita: 'NRT',
  'tokyo-haneda': 'HND', haneda: 'HND',
  dubai: 'DXB', 'abu dhabi': 'AUH', abudhabi: 'AUH', doha: 'DOH',
  singapur: 'SIN', singapore: 'SIN',
  bangkok: 'BKK',
  seoul: 'ICN', hongkong: 'HKG', 'hong kong': 'HKG',
  peking: 'PEK', beijing: 'PEK', schanghai: 'PVG', shanghai: 'PVG',
  delhi: 'DEL', mumbai: 'BOM', bombay: 'BOM',
  'new york': 'JFK', 'new york jfk': 'JFK', 'new york newark': 'EWR',
  'los angeles': 'LAX', chicago: 'ORD', miami: 'MIA',
  toronto: 'YYZ', montreal: 'YUL', vancouver: 'YVR',
  sydney: 'SYD', melbourne: 'MEL',
};

// PNR false positives (German words that match 6-char alphanumeric pattern)
export const PNR_FALSE_POSITIVES = new Set([
  'VIELEN', 'DANKEN', 'SEHREN', 'WICHTIG', 'BESTEN', 'GRUSS', 'GRUESSE',
  'HERZLI', 'FREUND', 'SCHONEN', 'GUTEN', 'GUTER', 'GUTES', 'NEUEN',
  'NEUER', 'NEUES', 'ALTE', 'ALTEN', 'ALTES', 'GROSS', 'GROSSE',
  'KLEIN', 'KLEINE', 'SCHON', 'SCHONE', 'SCHONER', 'SCHONES', 'NEUE',
]);

export const MONTH_NAMES: Record<string, string> = {
  'JAN': '01', 'FEB': '02', 'MAR': '03', 'APR': '04', 'MAI': '05', 'MAY': '05',
  'JUN': '06', 'JUL': '07', 'AUG': '08', 'SEP': '09', 'OKT': '10', 'OCT': '10',
  'NOV': '11', 'DEZ': '12', 'DEC': '12',
  'JANUAR': '01', 'JANUARY': '01', 'FEBRUAR': '02', 'FEBRUARY': '02',
  'MÄRZ': '03', 'MÄR': '03', 'MAERZ': '03', 'MARCH': '03',
  'APRIL': '04', 'JUNI': '06', 'JUNE': '06', 'JULI': '07', 'JULY': '07', 'AUGUST': '08',
  'SEPTEMBER': '09', 'OKTOBER': '10', 'OCTOBER': '10', 'NOVEMBER': '11',
  'DEZEMBER': '12', 'DECEMBER': '12',
};

// Context-aware IATA code extraction patterns
export const IATA_CONTEXT_PATTERNS = [
  /(?:von|ab|from|dep(?:arture)?)\s+([A-Z]{3})/g,
  /([A-Z]{3})\s+(?:nach|to|arr(?:ival)?)/g,
  /(?:nach|to|arr(?:ival)?)\s+([A-Z]{3})/g,
  /([A-Z]{3})\s*(?:->|-|\u2192|\u2194|\u2013|\u2014|\u27f6)\s*([A-Z]{3})/g,
];

// Common valid IATA airport codes (filters out false positives)
export const VALID_IATA_CODES = new Set([
  // Major European airports
  'MUC', 'FRA', 'BER', 'HAM', 'DUS', 'CGN', 'STR', 'HAJ', 'NUE', 'LEJ', 'DRS', 'BRE',
  'LUX', 'CDG', 'ORY', 'LHR', 'LGW', 'STN', 'AMS', 'BRU', 'VIE', 'ZRH', 'GVA',
  'FCO', 'MXP', 'BCN', 'MAD', 'LIS', 'CPH', 'ARN', 'OSL', 'PRG', 'WAW', 'BUD', 'IST', 'ATH',
  'HEL', 'DUB', 'EDI', 'MAN', 'BHX', 'BRS', 'NCL', 'LPL', 'EMA', 'SOU',
  // DACH airports
  'SZG', 'GRZ', 'INN', 'LNZ', 'BSL', 'BRN',
  // Major US airports
  'JFK', 'EWR', 'LGA', 'LAX', 'SFO', 'ORD', 'DFW', 'DEN', 'ATL', 'MIA', 'SEA', 'BOS', 'IAD', 'DCA',
  'PHX', 'LAS', 'MCO', 'CLT', 'DTW', 'PHL', 'MSP', 'BWI', 'SLC', 'HNL',
  // Major Asian airports
  'NRT', 'HND', 'ICN', 'PEK', 'PVG', 'HKG', 'SIN', 'BKK', 'KUL', 'DXB', 'DOH', 'AUH',
  'KIX', 'TPE', 'MNL', 'CGK', 'BOM', 'DEL', 'CCU', 'MAA', 'BLR', 'HYD',
  // Major airports in other regions
  'SYD', 'MEL', 'BNE', 'PER', 'ADL', 'AKL', 'WLG', 'YVR', 'YYZ', 'YUL', 'YOW', 'YEG', 'YYC',
  'GRU', 'GIG', 'EZE', 'SCL', 'LIM', 'BOG', 'MEX', 'CUN', 'PTY', 'SJO',
  'JNB', 'CPT', 'CAI', 'NBO', 'LOS', 'ACC', 'ADD', 'CMN', 'TUN', 'ALG',
]);

// IATA code false positives (common German/English words matching 3-letter patterns)
export const IATA_FALSE_POSITIVES = [
  'UND', 'DER', 'DIE', 'DAS', 'VON', 'BIS', 'FUR', 'MIT', 'AUF', 'AUS',
  'FUR', 'FÜR', 'EIN', 'EINE', 'EINER', 'EINEM', 'EINEN', 'EINES',
  'OGO', 'CRA', 'DAN', 'VIEL', 'DANK', 'SEHR', 'WICHT', 'BEST',
  'GRU', 'HER', 'FRE', 'SCH', 'GUT', 'NEU', 'ALT', 'GRO', 'KLE',
  'THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'YOU', 'ALL', 'CAN', 'HER',
  'WAS', 'ONE', 'OUR', 'OUT', 'DAY', 'GET', 'HAS', 'HIM', 'HIS', 'HOW',
  'ITS', 'MAY', 'NEW', 'NOW', 'OLD', 'SEE', 'TWO', 'WAY', 'WHO', 'BOY',
  'DID', 'ITS', 'LET', 'PUT', 'SAY', 'SHE', 'TOO', 'USE', 'YET', 'ZUR',
];

/**
 * Word prefixes that are common false positives for flight numbers.
 *
 * Compared against the WHOLE alphabetic prefix of a candidate, which is why
 * three-letter entries belong here too: the check used to look at the first two
 * characters only, so "Nur 7 Tage gültig" became flight NUR7 — the subject line
 * of the very promotion Forgejo #35 was filed about.
 *
 * Kept separate from IATA_FALSE_POSITIVES on purpose, even though both hold
 * German filler words: NUR is also Nuremberg's airport code, and banning it
 * there would cost a real airport to save a fake flight.
 */
export const FLIGHT_NUMBER_FALSE_PREFIXES = [
  'NUR',
  'AB', 'AM', 'PM', 'VI', 'AN', 'IN', 'ON', 'AT', 'TO', 'OF', 'OR',
  'IS', 'AS', 'BE', 'WE', 'HE', 'ME', 'MY', 'BY', 'GO', 'NO', 'SO',
  'UP', 'US', 'IT', 'IF', 'DO', 'OK', 'HI', 'OH', 'AH', 'EH', 'UM',
  'ER', 'OR', 'UR', 'YA', 'YE', 'YO', 'ZA', 'ZE', 'ZO',
];
