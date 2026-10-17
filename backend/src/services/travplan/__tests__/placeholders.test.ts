import { randomUUID } from "crypto";
import { emptyState, bookingSchema } from "../schema";
import { applyOperation } from "../operations";
import { deriveBudget } from "../rules";
import { matchPlaceholders, replacePlaceholder } from "../placeholders";
import type { PlanBooking, PlanPlace, PlanStage, PlanState, PlanStation } from "../types";

const uid = () => randomUUID();
const place = (name: string, lat: number, lon: number): PlanPlace => ({
  name,
  lat,
  lon,
  country: null,
  zone: null,
  ref: null,
});
const station = (title: string, p: PlanPlace, extra: Partial<PlanStation> = {}): PlanStation => ({
  id: uid(),
  title,
  place: p,
  nights: 1,
  pinnedDay: null,
  night: { kind: "spontaneous" },
  note: "",
  ...extra,
});
const stage = (from: string, to: string, extra: Partial<PlanStage> = {}): PlanStage => ({
  id: uid(),
  fromStationId: from,
  toStationId: to,
  mode: "ferry",
  departDay: "2027-05-19",
  departTime: null,
  durationMinutes: null,
  distanceKm: null,
  metricsSource: null,
  fallbackReason: null,
  bookingId: null,
  overnight: false,
  note: "",
  ...extra,
});
const booking = (extra: Record<string, unknown> = {}): PlanBooking =>
  bookingSchema.parse({
    id: uid(),
    kind: "ferry",
    title: "Palermo to Genoa",
    reference: null,
    provider: "",
    day: "2027-05-19",
    endDay: null,
    time: null,
    timezone: null,
    amount: null,
    paid: 0,
    currency: "EUR",
    place: "Genoa",
    originPlace: "Palermo",
    documentIds: [],
    source: "manual",
    details: {},
    ...extra,
  });

const palermo = place("Palermo", 38.12, 13.36);
const genoa = place("Genoa", 44.41, 8.93);
function planWithPlaceholder() {
  const a = station("Palermo", palermo),
    b = station("Genoa", genoa),
    g = stage(a.id, b.id);
  const ph = booking({
    placeholder: true,
    estimate: { amount: 520, currency: "EUR" },
    stageId: g.id,
    title: "Ferry to Genoa",
  });
  const state: PlanState = {
    ...emptyState(),
    shape: "route",
    stations: [a, b],
    stages: [g],
    bookings: [ph],
  };
  return { state, ph, a, b, g };
}

describe("placeholders", () => {
  it("replacing keeps the id so stage and night still point at it", () => {
    const { state, ph, g } = planWithPlaceholder();
    state.stages = [{ ...g, bookingId: ph.id }];
    const real = booking({ amount: 548, provider: "Grimaldi", day: "2027-05-20" });
    const next = replacePlaceholder(state, ph.id, real, null);
    expect(next.bookings).toHaveLength(1);
    const row = next.bookings[0];
    expect(row.id).toBe(ph.id);
    expect(row.stageId).toBe(g.id);
    expect(row.placeholder).toBe(false);
    expect(row.estimate).toBeNull();
    expect(row.provider).toBe("Grimaldi");
    expect(row.details.replaced).toMatchObject({ estimate: { amount: 520, currency: "EUR" } });
    expect((row.details.replaced as { by?: string }).by).toBeUndefined();
    expect(next.stages[0].bookingId).toBe(ph.id);
  });

  it("records who replaced it only when a label is given", () => {
    const { state, ph } = planWithPlaceholder();
    const next = replacePlaceholder(state, ph.id, booking(), "Alex");
    expect((next.bookings[0].details.replaced as { by?: string }).by).toBe("Alex");
  });

  it("refuses to replace a booking that is not a placeholder", () => {
    const { state, ph } = planWithPlaceholder();
    const real = replacePlaceholder(state, ph.id, booking(), null);
    expect(() => replacePlaceholder(real, ph.id, booking(), null)).toThrow(/not a placeholder/);
  });

  it("budget counts the estimate before and only the booking after", () => {
    const { state, ph } = planWithPlaceholder();
    expect(deriveBudget(state)).toMatchObject({ estimates: 520, booked: 0, paid: 0 });
    const next = applyOperation(
      state,
      { type: "replace_placeholder", placeholderId: ph.id, value: booking({ amount: 548 }) },
      1
    );
    expect(deriveBudget(next)).toMatchObject({ estimates: 0, booked: 548, total: 548 });
  });

  it("budget skips a placeholder whose stage is only in an inactive variant", () => {
    const { state, g } = planWithPlaceholder();
    const inactive: PlanState = {
      ...state,
      stages: [],
      variants: [{ id: uid(), name: "B", stations: [], stages: [g] }],
    };
    expect(deriveBudget(inactive).estimates).toBe(0);
  });

  it("counts a placeholder without an estimate as an unknown cost", () => {
    const { state } = planWithPlaceholder();
    state.bookings[0] = { ...state.bookings[0], estimate: null };
    expect(deriveBudget(state)).toMatchObject({ estimates: 0, booked: 0, unknown: 1 });
  });

  it("matches Palermo→Genoa ferry on the day before", () => {
    const { state, ph } = planWithPlaceholder();
    const matches = matchPlaceholders(
      booking({ day: "2027-05-20", amount: 548, provider: "Grimaldi" }),
      state
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].bookingId).toBe(ph.id);
    expect(matches[0].variant).toBe("active");
    expect(matches[0].reasons).toEqual(expect.arrayContaining(["kind", "endpoints", "day"]));
  });

  it("does not match across kinds", () => {
    const { state } = planWithPlaceholder();
    expect(matchPlaceholders(booking({ kind: "rail" }), state)).toEqual([]);
  });

  it("does not match ports 80 km apart", () => {
    const { state } = planWithPlaceholder();
    const far = booking({
      details: {
        origin: { lat: 38.12, lon: 13.36 },
        destination: { lat: 44.41 + 0.72, lon: 8.93 },
      },
    });
    expect(matchPlaceholders(far, state)).toEqual([]);
  });

  it("matches ports a few km apart when both sides carry coordinates", () => {
    const { state } = planWithPlaceholder();
    const near = booking({
      place: "Genova Voltri",
      details: {
        origin: { lat: 38.13, lon: 13.37 },
        destination: { lat: 44.42, lon: 8.94 },
      },
    });
    expect(matchPlaceholders(near, state)).toHaveLength(1);
  });

  it("does not match a different day or different names without coordinates", () => {
    const { state } = planWithPlaceholder();
    expect(matchPlaceholders(booking({ day: "2027-05-22" }), state)).toEqual([]);
    expect(matchPlaceholders(booking({ place: "Livorno" }), state)).toEqual([]);
  });

  it("matches names without coordinates after normalising diacritics and port words", () => {
    const { state } = planWithPlaceholder();
    state.bookings[0] = { ...state.bookings[0], place: "Genöa", originPlace: "Hafen Palermo" };
    const ok = matchPlaceholders(
      booking({ originPlace: "Porto di Palermo", place: "Genoa" }),
      state
    );
    expect(ok).toHaveLength(1);
  });

  it("marks a placeholder in an inactive variant as inactive", () => {
    const { state, g } = planWithPlaceholder();
    const variantState: PlanState = {
      ...state,
      stages: [],
      variants: [{ id: uid(), name: "B", stations: [], stages: [g] }],
    };
    const m = matchPlaceholders(booking(), variantState);
    expect(m[0].variant).toBe("inactive");
  });

  it("differences mark operator as new and price as changed", () => {
    const { state } = planWithPlaceholder();
    const [m] = matchPlaceholders(booking({ provider: "Grimaldi", amount: 548 }), state);
    expect(m.differences).toEqual(
      expect.arrayContaining([
        { field: "provider", plan: null, booking: "Grimaldi", change: "new" },
        { field: "amount", plan: "520", booking: "548", change: "changed" },
      ])
    );
  });

  it("lodging must overlap the nights of its station", () => {
    const s = station("Genoa", genoa, { nights: 2, pinnedDay: "2027-05-20" });
    const g = stage(s.id, s.id);
    const hotel = (extra: Record<string, unknown>) =>
      booking({ kind: "hotel", originPlace: "", place: "Genoa", ...extra });
    const ph = hotel({
      placeholder: true,
      stageId: g.id,
      day: "2027-05-20",
      endDay: "2027-05-22",
    });
    const state: PlanState = {
      ...emptyState(),
      shape: "route",
      stations: [s],
      stages: [g],
      bookings: [ph],
    };
    expect(
      matchPlaceholders(hotel({ day: "2027-05-21", endDay: "2027-05-23" }), state)
    ).toHaveLength(1);
    expect(matchPlaceholders(hotel({ day: "2027-05-22", endDay: "2027-05-24" }), state)).toEqual(
      []
    );
  });
});
