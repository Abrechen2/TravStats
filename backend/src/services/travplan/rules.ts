import { instantMinute } from "./temporal";
import { isSuppressed, routeCoveredNights, routeFindings } from "./routeRules";
import type { PlanBooking, PlanBudget, PlanFinding, PlanState, PlanTransfer } from "./types";
export function transferFingerprint(state: PlanState, fromId: string, toId: string): string {
  const from = state.items.find((i) => i.id === fromId),
    to = state.items.find((i) => i.id === toId),
    booking = state.bookings.find((b) => b.id === from?.bookingId);
  return JSON.stringify([
    booking ? booking.arrivalDay : from?.day,
    booking ? booking.arrivalTime : from?.time,
    booking ? booking.arrivalTimezone : from?.timezone,
    from?.place,
    to?.place,
    to?.title,
    state.bookings.find((b) => b.id === to?.bookingId)?.address,
  ]);
}
export function deriveBudget(state: PlanState): PlanBudget {
  let booked = 0,
    estimates = 0,
    paid = 0,
    unknown = 0;
  let unknownCommitted = false;
  const other = new Set<string>();
  const groups = new Set<string>();
  const bookings = state.bookings.filter((b) => {
    const key = b.priceGroupId || b.actualBookingId;
    if (!key) return true;
    if (groups.has(key)) return false;
    groups.add(key);
    return true;
  });
  // C2: a placeholder only counts while its stage is on the active route;
  // a variant's stages are inactive and so are their estimates.
  const activeStages = new Set(state.stages.map((g) => g.id));
  const counted = (b: PlanBooking) => !b.placeholder || !b.stageId || activeStages.has(b.stageId);
  const placeholders = bookings.filter((b) => b.placeholder && counted(b));
  for (const b of placeholders) {
    if (!b.estimate) unknown++;
    else if (b.estimate.currency !== state.currency) other.add(b.estimate.currency);
    else estimates += Math.round(b.estimate.amount * 100);
  }
  const real = bookings.filter((b) => !b.placeholder);
  for (const row of [...real.map((b) => ({ ...b, kind: "booked" })), ...state.costs]) {
    if (row.currency !== state.currency) {
      other.add(row.currency);
      if (row.kind === "booked") unknownCommitted = true;
      continue;
    }
    if (row.kind === "booked") paid += Math.round(row.paid * 100);
    if (row.amount === null) {
      unknown++;
      if (row.kind === "booked") {
        unknownCommitted = true;
        booked += Math.round(row.paid * 100);
      }
      continue;
    }
    const amount = Math.round(row.amount * 100);
    if (row.kind === "estimate") estimates += amount;
    else booked += amount;
  }
  const total = booked + estimates;
  return {
    currency: state.currency,
    booked: booked / 100,
    estimates: estimates / 100,
    paid: paid / 100,
    due: unknownCommitted ? null : Math.max(0, booked - paid) / 100,
    total: total / 100,
    remaining:
      state.budget === null || unknown > 0 || other.size > 0
        ? null
        : Math.round(state.budget * 100 - total) / 100,
    unknown,
    otherCurrencies: [...other],
  };
}
export function localMinute(day: string | null, time: string | null): number | null {
  if (!day || !time) return null;
  return (
    Date.parse(day + "T00:00:00Z") / 60000 + Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
  );
}
export function checkPlan(state: PlanState, today: string): PlanFinding[] {
  const findings: PlanFinding[] = [];
  function add(
    id: string,
    code: string,
    section: string,
    params: PlanFinding["params"],
    facts: unknown,
    severity: PlanFinding["severity"] = "info"
  ) {
    const fingerprint = JSON.stringify(facts);
    if (isSuppressed(state, id, fingerprint)) return;
    findings.push({ id, code, section, params, fingerprint, severity });
  }
  const active = state.items.filter(
    (i) => i.execution !== "cancelled" && i.execution !== "skipped"
  );
  for (const flight of active.filter((i) => ["flight", "rail", "bus", "ferry"].includes(i.kind))) {
    const arrival = state.bookings.find((b) => b.id === flight.bookingId)?.arrivalDay ?? flight.day;
    const hotel = active
      .filter(
        (i) =>
          i.kind === "hotel" &&
          (!arrival ||
            !i.day ||
            (i.day <= arrival &&
              state.bookings.find((b) => b.id === i.bookingId)?.endDay! > arrival) ||
            i.day >= arrival)
      )
      .sort((a, b) => (a.day || "").localeCompare(b.day || ""))[0];
    if (!hotel) continue;
    const id = "transfer:" + flight.id + ":" + hotel.id,
      transfer = state.transfers.find((x) => x.fromId === flight.id && x.toId === hotel.id);
    if (transfer?.status === "conscious") continue;
    const fingerprint = transferFingerprint(state, flight.id, hotel.id);
    if (!transfer || transfer.status === "open")
      add(
        id,
        "transferOpen",
        "transfer",
        {
          fromId: flight.id,
          toId: hotel.id,
          from: flight.place || flight.title,
          to: hotel.place || hotel.title,
        },
        JSON.parse(fingerprint)
      );
    else if (transfer.fingerprint !== fingerprint)
      add(
        id,
        "transferReview",
        "transfer",
        { fromId: flight.id, toId: hotel.id, mode: transfer.mode },
        JSON.parse(fingerprint),
        "attention"
      );
    const booking = state.bookings.find((b) => b.id === flight.bookingId);
    const start = instantMinute(
      booking?.arrivalDay ?? null,
      booking?.arrivalTime ?? null,
      booking?.arrivalTimezone ?? null
    );
    if (start !== null && transfer?.duration !== null && transfer?.duration !== undefined) {
      const ready = start + transfer.buffer + transfer.duration;
      const first = active
        .filter(
          (i) =>
            i.kind === "activity" &&
            i.execution === "unconfirmed" &&
            !state.freeDays.includes(i.day || "")
        )
        .map((i) => ({ i, start: instantMinute(i.day, i.time, i.timezone) }))
        .filter((x) => x.start !== null && x.start >= start)
        .sort((a, b) => a.start! - b.start!)[0];
      if (first && first.start! < ready)
        add(
          "arrival:" + flight.id,
          "arrivalBuffer",
          "workspace",
          { title: first.i.title, minutes: Math.ceil(ready - first.start!) },
          [
            booking?.arrivalDay,
            booking?.arrivalTime,
            booking?.arrivalTimezone,
            transfer.buffer,
            transfer.duration,
            first.i.day,
            first.i.time,
          ],
          "attention"
        );
    }
  }
  const events = active
    .filter((i) => !["hotel", "free"].includes(i.kind) && i.day && i.time && i.duration !== null)
    .map((i) => ({ i, start: instantMinute(i.day, i.time, i.timezone) }))
    .filter((x): x is { i: (typeof active)[number]; start: number } => x.start !== null)
    .sort((a, b) => a.start - b.start);
  const overlapDays = new Set<string>();
  for (let a = 0; a < events.length; a++)
    for (
      let b = a + 1;
      b < events.length && events[b].start < events[a].start + events[a].i.duration!;
      b++
    ) {
      const x = events[a],
        y = events[b];

      if (!overlapDays.has(y.i.day!)) {
        overlapDays.add(y.i.day!);
        add(
          "overlap:" + x.i.id + ":" + y.i.id,
          "overlap",
          "workspace",
          { first: x.i.title, second: y.i.title },
          [x.i.day, x.i.time, x.i.duration, y.i.day, y.i.time, y.i.duration],
          "attention"
        );
      }
    }
  const loads = new Map<string, number>();
  for (const i of active)
    if (i.kind === "activity" && i.day)
      loads.set(i.day, (loads.get(i.day) || 0) + (i.duration || 0));
  for (const [day, minutes] of loads)
    if (
      minutes > (state.pace === "relaxed" ? 300 : state.pace === "busy" ? 600 : 480) &&
      !overlapDays.has(day) &&
      !state.freeDays.includes(day)
    )
      add("busy:" + day, "busyDay", "workspace", { day, hours: Math.round(minutes / 6) / 10 }, [
        minutes,
        state.pace,
      ]);
  const outside = active.filter(
    (i) =>
      i.day &&
      ((state.startDay && i.day < state.startDay) || (state.endDay && i.day > state.endDay))
  );
  if (outside.length)
    add(
      "outside",
      "outside",
      "workspace",
      { count: outside.length },
      outside.map((i) => [i.id, i.day]),
      "attention"
    );
  const hotels = state.bookings.filter(
    (b) =>
      active.some((i) => i.bookingId === b.id) &&
      (b.kind === "hotel" || b.kind === "cruise" || b.overnight)
  );
  if (hotels.some((h) => !h.day || !h.endDay))
    add(
      "hotelDates",
      "hotelDates",
      "import",
      {},
      hotels.map((h) => [h.id, h.day, h.endDay])
    );
  else if (
    state.startDay &&
    state.endDay &&
    (state.bookings.length || (state.shape === "route" && state.stations.length))
  ) {
    // A route plan also covers a night with a station night or an overnight stage.
    const routeNights = state.shape === "route" ? routeCoveredNights(state) : new Set<string>();
    let missing: string[] = [];
    for (let d = Date.parse(state.startDay); d < Date.parse(state.endDay); d += 864e5) {
      const day = new Date(d).toISOString().slice(0, 10);
      if (
        !state.openNights.includes(day) &&
        !routeNights.has(day) &&
        !hotels.some((h) => h.day! <= day && h.endDay! > day)
      )
        missing.push(day);
    }
    if (missing.length)
      add(
        "nights",
        "nightGap",
        "import",
        { count: missing.length, days: missing.slice(0, 3).join(", ") },
        missing
      );
  }
  const budget = deriveBudget(state);
  if (state.budget !== null && budget.total > state.budget)
    add(
      "budget",
      "budgetOver",
      "budget",
      { amount: budget.total - state.budget!, currency: budget.currency },
      [budget.total, state.budget],
      "attention"
    );
  if (budget.unknown || budget.otherCurrencies.length)
    add(
      "unknownCosts",
      "unknownCosts",
      "budget",
      { count: budget.unknown, currencies: budget.otherCurrencies.join(", ") },
      [budget.unknown, budget.otherCurrencies]
    );
  if (state.shape === "route") findings.push(...routeFindings(state, today));
  return findings.sort(
    (a, b) => (a.severity === "attention" ? 0 : 1) - (b.severity === "attention" ? 0 : 1)
  );
}
export function packingSuggestions(state: PlanState): string[] {
  const days =
    state.forecast?.days.filter(
      (d) =>
        (!state.startDay || d.day >= state.startDay) && (!state.endDay || d.day <= state.endDay)
    ) || [];
  const result: string[] = [];
  if (days.some((d) => d.max !== null && d.max >= 25)) result.push("sun");
  if (days.some((d) => d.rainProbability !== null && d.rainProbability >= 40)) result.push("rain");
  if (days.some((d) => d.min !== null && d.min < 12)) result.push("warm");
  if (state.items.some((i) => /hike|wandern|wanderung|levada/i.test(i.title))) result.push("shoes");
  return result.filter(
    (code) =>
      !state.packing.some((p) => p.category === "suggestion:" + code) &&
      !state.decisions.some((d) => d.id === "packing:" + code)
  );
}
export function transferNeedsReview(state: PlanState, transfer: PlanTransfer): boolean {
  return (
    transfer.status === "organized" &&
    transfer.fingerprint !== transferFingerprint(state, transfer.fromId, transfer.toId)
  );
}
