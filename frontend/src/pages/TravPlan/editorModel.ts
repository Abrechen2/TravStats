import { newPlanId } from "../../lib/travplanId";
import type { PlanCollection, PlanItem } from "../../lib/api/travplan";
export type Field = {
  key: string;
  type?: string;
  options?: string[];
  required?: boolean;
  max?: number;
  nullable?: boolean;
};
const field = (key: string, type = "text", nullable = false): Field => ({ key, type, nullable });
export const editors: Record<PlanCollection, Field[]> = {
  items: [
    { key: "title", required: true, max: 200 },
    { key: "kind", options: ["activity", "free"] },
    field("day", "date", true),
    field("time", "time", true),
    field("duration", "number", true),
    field("timezone", "text", true),
    field("place"),
    field("note", "textarea"),
  ],
  ideas: [
    { key: "title", required: true, max: 200 },
    field("category"),
    { key: "priority", options: ["must", "optional", "maybe"] },
    field("note", "textarea"),
  ],
  bookings: [
    { key: "title", required: true, max: 200 },
    { key: "kind", options: ["flight", "hotel", "rail", "bus", "ferry", "cruise", "rental"] },
    field("reference", "text", true),
    field("provider"),
    field("day", "date", true),
    field("endDay", "date", true),
    field("time", "time", true),
    field("timezone", "text", true),
    field("place"),
    field("country"),
    field("city"),
    field("address"),
    field("originPlace"),
    field("arrivalDay", "date", true),
    field("arrivalTime", "time", true),
    field("arrivalTimezone", "text", true),
    field("overnight", "checkbox"),
    field("amount", "number", true),
    field("paid", "number"),
    field("currency"),
  ],
  transfers: [
    { key: "mode", required: true },
    field("duration", "number", true),
    field("buffer", "number"),
    { key: "status", options: ["organized", "open", "conscious"] },
    field("note", "textarea"),
  ],
  packing: [
    { key: "label", required: true, max: 120 },
    field("category"),
    field("quantity", "number"),
    { key: "scope", options: ["personal", "shared"] },
    field("note", "textarea"),
  ],
  tasks: [{ key: "title", required: true, max: 200 }, field("due", "date", true)],
  costs: [
    { key: "title", required: true, max: 200 },
    { key: "kind", options: ["estimate", "booked"] },
    field("amount", "number", true),
    field("paid", "number"),
    field("currency"),
  ],
};
export function newEntry(
  key: PlanCollection,
  timezone: string | null,
  currency: string,
  day: string | null
): Record<string, unknown> {
  const id = newPlanId();
  const common = { id };
  switch (key) {
    case "items":
      return {
        ...common,
        title: "",
        kind: "activity",
        day,
        time: null,
        duration: 60,
        timezone,
        place: "",
        note: "",
        booked: false,
        bookingId: null,
        execution: "unconfirmed",
        source: null,
      } satisfies PlanItem;
    case "ideas":
      return { ...common, title: "", category: "", priority: "optional", note: "", itemId: null };
    case "bookings":
      return {
        ...common,
        kind: "flight",
        title: "",
        reference: null,
        provider: "",
        day,
        endDay: null,
        time: null,
        timezone: null,
        amount: null,
        paid: 0,
        currency,
        place: "",
        documentIds: [],
        source: "manual",
        details: {},
      };
    case "transfers":
      return {
        ...common,
        fromId: "",
        toId: "",
        status: "organized",
        mode: "",
        note: "",
        duration: null,
        buffer: 60,
        fingerprint: null,
      };
    case "packing":
      return {
        ...common,
        label: "",
        category: "",
        quantity: 1,
        packed: false,
        scope: "personal",
        note: "",
        manual: true,
      };
    case "tasks":
      return { ...common, title: "", due: null, done: false };
    case "costs":
      return { ...common, title: "", amount: null, currency, paid: 0, kind: "estimate" };
  }
}
export const settingFields: Field[] = [
  { key: "name", required: true, max: 200 },
  field("destination"),
  field("startDay", "date", true),
  field("endDay", "date", true),
  field("timezone", "text", true),
  field("travelers", "number"),
  { key: "pace", options: ["relaxed", "balanced", "busy"] },
  field("budget", "number", true),
  field("currency"),
];
