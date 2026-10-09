/**
 * The input and output shapes of the lodging insights (forgejo#258). Pure
 * types — the loader is `services/stats/insights/lodgingInsightData.ts`, the
 * arithmetic the sibling files of this one.
 */

/** One stay, with the house and the trip it belongs to. */
export interface InsightStay {
  id: string;
  lodgingId: string;
  lodgingName: string;
  /** Lodging.type: hotel | campsite | guesthouse | apartment | hostel | … */
  type: string;
  checkIn: Date | null;
  checkOut: Date | null;
  datePrecision: string;
  nights: number | null;
  status: string;
  roomCategory: string | null;
  board: string | null;
  currency: string;
  totalPrice: number | null;
  isAwardStay: boolean;
  trip: InsightTrip | null;
}

export interface InsightTrip {
  id: string;
  name: string;
  /** vacation | business | weekend | family | other — or null: nobody said. */
  category: string | null;
  /** The trip's last day as recorded, or null. */
  endDate: Date | null;
}

export interface SleepStyleYear {
  year: number;
  /** Nights per house type, only types with nights — never a 0 key. */
  nightsByType: Record<string, number>;
  nights: number;
}

export interface SleepStyle {
  byYear: SleepStyleYear[];
  /** Known nights of stays that cannot be placed in any year. */
  unplacedNights: number;
  /** Counted stays whose length nobody recorded — in no share. */
  unknownLengthStays: number;
}

export interface RevisitHouse {
  lodgingId: string;
  name: string;
  /** Calendar years with a counted stay, ascending. */
  years: number[];
  stays: number;
}

export interface RevisitGap {
  lodgingId: string;
  name: string;
  days: number;
  fromStayId: string;
  toStayId: string;
  /** `YYYY-MM-DD` — the check-out that opened the gap and the check-in that closed it. */
  from: string;
  to: string;
}

export interface Revisits {
  /** Houses with counted stays in at least two calendar years, most years first. */
  houses: RevisitHouse[];
  longestGap: RevisitGap | null;
  /** Most distinct calendar years at one house — the "Jahrelang willkommen" measure. */
  sameHouseYearsMax: number;
  /** Houses with two or more counted stays (any years). */
  returnedHouses: number;
}

export interface TripBase {
  tripId: string;
  tripName: string;
  /** Year of the trip's first counted check-in. */
  year: number;
  houses: number;
  /** Moves from one house to another, in check-in order; the first arrival is none. */
  changes: number;
  /** Longest run of nights at one house without a move, touching stays merged. */
  longestBaseNights: number;
  longestBaseLodgingId: string;
  longestBaseName: string;
  /** Nights booked at two houses at once — counted once in every night total. */
  overlapNights: number;
  /** Distinct house types slept in on this trip. */
  types: string[];
  /** Every stay of the trip is over, and the trip's own end (if recorded) is past. */
  completed: boolean;
}

export interface TripBases {
  trips: TripBase[];
  /** Counted stays filed under no trip — outside this analysis by definition. */
  staysWithoutTrip: number;
  /** Counted trip stays without two real dates — they cannot be put in order. */
  undatedTripStays: number;
  /** Most distinct house types on one completed trip. */
  typesPerCompletedTripMax: number;
}

export interface PricePoint {
  stayId: string;
  /** As precise as the stay's own date: `YYYY-MM-DD`, `YYYY-MM` or `YYYY`. */
  date: string;
  perNight: number;
}

export interface PriceTrend {
  lodgingId: string;
  name: string;
  roomCategory: string | null;
  board: string | null;
  currency: string;
  stays: number;
  first: PricePoint;
  last: PricePoint;
  /** (last − first) / first, rounded to a tenth of a percent. */
  changePct: number;
  /** Fewer than three priced stays: a trend of two points is two prices. */
  thin: boolean;
}

export interface PriceTrends {
  groups: PriceTrend[];
  /** Counted stays with a known length and a price that compared with nothing. */
  singlePricedStays: number;
  /** Counted stays carrying no price, or a length nobody knows. */
  unpricedStays: number;
  /** Paid with points — a price of 0 is not a price. */
  awardStays: number;
  /** Priced, but with no date to put them in order against another price. */
  undatedPricedStays: number;
}

export interface WeekRhythmYear {
  year: number;
  weekendNights: number;
  weekdayNights: number;
  businessNights: number;
  nightsBySeason: Record<string, number>;
}

export interface WeekRhythm {
  byYear: WeekRhythmYear[];
  weekendNights: number;
  weekdayNights: number;
  /** Nights on trips the user marked as business — never guessed from the weekday. */
  businessNights: number;
  /** Nights on stays whose trip says nothing about its purpose. */
  unlabelledNights: number;
  /** Known nights that could not be put on a weekday (month/year precision, undated). */
  notWalkableNights: number;
}

export interface CalendarYear {
  year: number;
  /** 1–12, ascending: months holding at least one night that is known to be there. */
  months: number[];
}

export interface CalendarCoverage {
  byYear: CalendarYear[];
  fullYears: number[];
  monthsInYearMax: number;
}

export interface LodgingInsights {
  sleepStyle: SleepStyle;
  revisits: Revisits;
  tripBases: TripBases;
  priceTrends: PriceTrends;
  weekRhythm: WeekRhythm;
  calendar: CalendarCoverage;
}
