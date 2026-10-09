/**
 * `GET /stats/cruise-insights` (forgejo#257).
 *
 * MIRRORS `backend/src/schemas/statsCruiseInsights.ts`; change both together.
 */

export interface CruiseRef {
  id: string;
  /** Route, ship or line — the user's own name. */
  label: string;
  startDate: string | null;
}

export type CruiseEvent =
  "equator" | "dateline" | "birthdayAtSea" | "newYearAtSea" | "canal" | "polar";

export type CruiseType = "seaHeavy" | "balanced" | "portIntensive";

export interface PortStay {
  cruise: CruiseRef;
  stopId: string;
  portName: string;
  day: string | null;
  minutes: number;
}

export interface LinkedTour {
  id: string;
  name: string;
  activity: string | null;
  day: string;
  portName: string;
  /** From the recordings; a tour with no recording carries `plannedKm` instead. */
  recordedKm: number | null;
  plannedKm: number | null;
  ascentM: number | null;
}

export interface CruiseInsights {
  year: number | null;
  cruises: number;
  events: {
    birthdayKnown: boolean;
    list: Array<{ event: CruiseEvent; cruises: CruiseRef[] }>;
  };
  ports: {
    years: Array<{
      year: number;
      cruises: number;
      ports: number;
      newPorts: Array<{ id: number; name: string }>;
      revisitedPorts: number;
    }>;
    perCruise: Array<{
      cruise: CruiseRef;
      ports: number;
      newPorts: number;
      revisitedPorts: number;
      unresolvedCalls: number;
    }>;
    longestReunion: {
      portId: number;
      portName: string;
      fromCruise: CruiseRef;
      toCruise: CruiseRef;
      fromDay: string;
      toDay: string;
      days: number;
    } | null;
    repeatPorts: Array<{ portId: number; portName: string; cruises: CruiseRef[] }>;
    undatedCruises: number;
    unresolvedCalls: number;
  };
  portStays: {
    calls: number;
    measured: number;
    missingTime: number;
    inconsistent: number;
    totalMinutes: number;
    /** Over measured calls only; null when none was measured. */
    averageMinutes: number | null;
    longest: PortStay | null;
    shortest: PortStay | null;
  };
  excursions: {
    toursVisible: boolean;
    linkRuleKm: number;
    cruisesWithExcursions: number;
    documentedCalls: number;
    portsWithExcursions: number;
    perCruise: Array<{
      cruise: CruiseRef;
      calls: number;
      notedCalls: number;
      documentedCalls: number;
      /** Null while the reader does not see tours. */
      tours: LinkedTour[] | null;
      activities: Record<string, number> | null;
      /** Recorded and planned kilometres, summed apart — never one figure. */
      recordedKm: number | null;
      plannedKm: number | null;
      onFootRecordedKm: number | null;
      onFootPlannedKm: number | null;
      ascentM: number | null;
    }>;
  };
  dayPattern: {
    years: Array<{
      year: number;
      cruises: number;
      seaDays: number;
      portDays: number;
      seaHeavy: number;
      balanced: number;
      portIntensive: number;
      unclassified: number;
    }>;
    perCruise: Array<{
      cruise: CruiseRef;
      seaDays: number;
      portDays: number;
      listedDays: number;
      unlistedDays: number | null;
      type: CruiseType | null;
    }>;
  };
  repeatedItineraries: Array<{ ports: Array<{ id: number; name: string }>; cruises: CruiseRef[] }>;
}
