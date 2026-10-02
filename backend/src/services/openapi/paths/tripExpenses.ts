/**
 * Expenses (forgejo#140, owner 2026-10-01): a ferry ticket, a toll, a pitch
 * fee, fuel. One store, three path families — a trip's, a roadtrip's and any
 * section's (`/tours/{routeId}`), because an expense sits on a trip OR on a
 * section and a standalone roadtrip has no trip to be reached through.
 */

import { z } from "zod";

import { registry } from "../registry";
import { errorContent } from "./shared";
import {
  createExpenseSchema,
  expenseListSchema,
  expenseSchema,
  updateExpenseSchema,
} from "../../../schemas/expense";

const expense = registry.register("TripExpense", expenseSchema);
const createInput = registry.register(
  "TripExpenseInput",
  createExpenseSchema.openapi("TripExpenseInput", {
    example: { kind: "ferry", amount: 1290, currency: "NOK", date: "2026-07-16" },
  })
);
const updateInput = registry.register(
  "TripExpenseUpdate",
  updateExpenseSchema.openapi("TripExpenseUpdate", {
    description: "Every field optional; an omitted one is left alone, null clears it.",
  })
);

const FAMILIES = [
  {
    path: "/trips/{id}/expenses",
    params: { id: z.string().uuid() },
    owner: "trip",
    listDescription:
      "The trip's trip-wide expenses AND those of its sections (roadtrips, tours), " +
      "with their totals per currency.",
    createDescription:
      "Trip-wide by default (a vignette). With `routeId` it lands on that section of " +
      "this trip instead, and moves with it if the section later changes trip; its stops " +
      "must then be the section's. Without, they must be the trip's own stops.",
  },
  {
    path: "/roadtrips/{id}/expenses",
    params: { id: z.string().uuid() },
    owner: "roadtrip (404 for a tour id)",
    listDescription: "The roadtrip's own expenses, with their totals per currency.",
    createDescription: "Its stops must be this roadtrip's stations; `routeId` is refused.",
  },
  {
    path: "/tours/{routeId}/expenses",
    params: { routeId: z.string().uuid() },
    owner: "section, of either kind",
    listDescription: "Any section's expenses — a standalone tour's tolls moved here from its legs.",
    createDescription: "Its stops must be this section's; `routeId` is refused.",
  },
] as const;

const expenseIdParam = { expenseId: z.string().uuid() };

for (const family of FAMILIES) {
  const params = z.object(family.params);
  const itemParams = z.object({ ...family.params, ...expenseIdParam });
  const notFound = {
    description: `The ${family.owner}, the expense or a named stop is not the caller's`,
    content: errorContent,
  };

  registry.registerPath({
    method: "get",
    path: family.path,
    summary: `List the expenses of a ${family.owner}`,
    description:
      family.listDescription +
      " Totals are per ISO 4217 code and NEVER summed across currencies — an expense " +
      "carries no FX snapshot. Dated ones by day, undated ones last.",
    tags: ["Expenses"],
    request: { params },
    responses: {
      200: {
        description: "The expenses",
        content: { "application/json": { schema: expenseListSchema } },
      },
      404: notFound,
    },
  });

  registry.registerPath({
    method: "post",
    path: family.path,
    summary: `Record an expense on a ${family.owner}`,
    description:
      family.createDescription +
      " Optionally pinned to ONE station (`stopId`, not a route correction) OR to the way " +
      "between two (`legFromStopId` + `legToStopId`), never both.",
    tags: ["Expenses"],
    request: { params, body: { content: { "application/json": { schema: createInput } } } },
    responses: {
      201: {
        description: "Recorded",
        content: { "application/json": { schema: z.object({ expense }) } },
      },
      400: {
        description:
          "Validation failed — an unknown kind or currency, a negative amount, half a leg, " +
          "a station and a leg together, or a stop outside the trip or section",
        content: errorContent,
      },
      404: notFound,
    },
  });

  registry.registerPath({
    method: "patch",
    path: `${family.path}/{expenseId}`,
    summary: `Change an expense of a ${family.owner}`,
    description:
      "Partial. The expense stays where it is (trip or section); move it by deleting and " +
      "recording it again.",
    tags: ["Expenses"],
    request: {
      params: itemParams,
      body: { content: { "application/json": { schema: updateInput } } },
    },
    responses: {
      200: {
        description: "Changed",
        content: { "application/json": { schema: z.object({ expense }) } },
      },
      400: { description: "Validation failed", content: errorContent },
      404: notFound,
    },
  });

  registry.registerPath({
    method: "delete",
    path: `${family.path}/{expenseId}`,
    summary: `Delete an expense of a ${family.owner}`,
    tags: ["Expenses"],
    request: { params: itemParams },
    responses: {
      204: { description: "Deleted" },
      404: notFound,
    },
  });
}
