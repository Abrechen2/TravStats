import { api } from "./client";

interface Envelope<T> {
  success: boolean;
  data: T;
}

const base = "/place-lists/smart";

export interface RuleBrand {
  brandWikidataId: string;
  brandName: string;
}
export interface RuleSettings {
  minDwellMinutes: number;
  maxDwellMinutes: number;
  maxDistanceM: number;
  autoAccept: boolean;
}
export type ListRule = { listId: string; brands: RuleBrand[] } & RuleSettings;
export type ListRuleInput = { brands: RuleBrand[] } & RuleSettings;

/** Defaults for a food chain (spec 2026-11-22-brand-lists.md); auto-accept is off. */
export const DEFAULT_RULE_SETTINGS: RuleSettings = {
  minDwellMinutes: 5,
  maxDwellMinutes: 60,
  maxDistanceM: 60,
  autoAccept: false,
};

export interface BrandHit {
  id: string;
  label: string;
  description: string | null;
}

/** One TravTrack visit suggestion as the place page and the list show it: the inbox's own row. */
export interface SmartSuggestion {
  id: string;
  placeId: string | null;
  name: string | null;
  startAt: string;
  endAt: string;
  /** Wall clock at the place, `YYYY-MM-DDTHH:mm`. */
  startLocal: string;
  endLocal: string;
  zone: string;
  durationMinutes: number;
  distanceM: number | null;
  source: "travtrack";
  strength: "id" | "name";
  lists: { listId: string; listName: string }[];
  lat: number;
  lon: number;
}

export interface UndoResult {
  removedVisit: boolean;
  removedEntries: number;
  removedPlace: boolean;
  keptVisit: "notes" | "notAutomatic" | null;
}

export async function searchBrands(q: string, lang: "de" | "en"): Promise<BrandHit[]> {
  return (await api.get<Envelope<BrandHit[]>>(`${base}/brands`, { params: { q, lang } })).data.data;
}
export async function getListRule(listId: string): Promise<ListRule | null> {
  return (await api.get<Envelope<ListRule | null>>(`${base}/${listId}/rule`)).data.data;
}
export async function saveListRule(listId: string, input: ListRuleInput): Promise<ListRule> {
  return (await api.put<Envelope<ListRule>>(`${base}/${listId}/rule`, input)).data.data;
}
export async function clearListRule(listId: string): Promise<void> {
  await api.delete(`${base}/${listId}/rule`);
}
export async function listNewOutlets(listId: string): Promise<SmartSuggestion[]> {
  return (await api.get<Envelope<SmartSuggestion[]>>(`${base}/${listId}/suggestions`)).data.data;
}
export async function listAutoAccepted(listId: string): Promise<SmartSuggestion[]> {
  return (await api.get<Envelope<SmartSuggestion[]>>(`${base}/${listId}/auto`)).data.data;
}
export async function undoAutoAccepted(stayId: string): Promise<UndoResult> {
  return (await api.post<Envelope<UndoResult>>(`${base}/auto/${stayId}/undo`, {})).data.data;
}
export async function listPlaceSuggestions(placeId: string): Promise<SmartSuggestion[]> {
  return (await api.get<Envelope<SmartSuggestion[]>>(`${base}/place/${placeId}/suggestions`)).data
    .data;
}
