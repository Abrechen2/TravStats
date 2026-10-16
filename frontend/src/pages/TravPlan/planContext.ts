import { appLocale } from "../../lib/units";
import type { TravelDocument } from "../../lib/api/documents";
import type { PlanCollection, PlanOperation, PlanState, PlanView } from "../../lib/api/travplan";
import type { EditorState } from "./PlanEditor";

/** What every planning section reads from the page that owns the plan. */
export interface PlanCtx {
  plan: PlanView;
  state: PlanState;
  busy: boolean;
  prefix: string;
  tripId: string;
  day: string | null;
  setDay: (day: string | null) => void;
  days: string[];
  mutate: (op: PlanOperation) => Promise<boolean>;
  edit: (key: PlanCollection, row?: object, extras?: Partial<EditorState>) => void;
  onError: (e: unknown) => void;
  setPlan: (plan: PlanView) => void;
  documents: TravelDocument[];
  query: string;
  setQuery: (query: string) => void;
  weatherBusy: boolean;
  setWeatherBusy: (busy: boolean) => void;
  suggestions: string[];
  setSuggestions: (suggestions: string[]) => void;
}

const MAX_CALENDAR_DAYS = 366;
const DAY_MS = 864e5;

export function calendarDays(start: string | null, end: string | null): string[] {
  if (!start || !end) return [];
  const days: string[] = [];
  for (
    let d = Date.parse(start);
    d <= Date.parse(end) && days.length < MAX_CALENDAR_DAYS;
    d += DAY_MS
  )
    days.push(new Date(d).toISOString().slice(0, 10));
  return days;
}

export const entryRecord = (row: object) => row as unknown as Record<string, unknown>;

export function formatMoney(n: number | null, currency: string): string {
  return n === null ? "—" : n.toLocaleString(appLocale(), { style: "currency", currency });
}
