/**
 * The columns of a Prisma model, as OpenAPI properties.
 *
 * A response that returns a Prisma row returns every column of it. The
 * schemas that describe those responses were written by hand, and by
 * 2026-09-17 they had fallen far behind: `Flight` published 36 of its 94
 * columns, `Stay` described two fields the model has never had, and
 * `Achievement` said `unlocked` where the route sends `isUnlocked`. The
 * Companion's contract test found 51 of the gaps from the client side
 * (forgejo#120).
 *
 * So the columns are no longer typed by hand. A schema spreads
 * `prismaColumns("Model")` and adds, after it, only what a column cannot say:
 * a description, a narrower type such as an enum, or a field the route
 * computes. A new column is published the day its migration lands.
 * `openapi.modelColumns.test.ts` pins that every column appears.
 */

import type { Prisma } from "../../prisma";
import { z } from "zod";
import { prismaModelFields, type PrismaModelField } from "./prismaDatamodel";

function columnType(field: PrismaModelField): z.ZodTypeAny {
  const base: z.ZodTypeAny =
    field.type === "String"
      ? z.string()
      : field.type === "Int" || field.type === "BigInt"
        ? z.number().int()
        : field.type === "Float" || field.type === "Decimal"
          ? z.number()
          : field.type === "Boolean"
            ? z.boolean()
            : field.type === "DateTime"
              ? z.string().datetime()
              : z.unknown();
  const listed = field.isList ? z.array(base) : base;
  return field.isRequired || field.isList ? listed : listed.nullable();
}

/** Every scalar column of `model`, typed and nullable as the schema declares it. */
export function prismaColumns(model: Prisma.ModelName): Record<string, z.ZodTypeAny> {
  return Object.fromEntries(
    prismaModelFields(model)
      .filter((field) => field.kind !== "object")
      .map((field) => [field.name, columnType(field)])
  );
}

/** Scalar column names of `model` — for the guard test. */
export function prismaColumnNames(model: Prisma.ModelName): string[] {
  return Object.keys(prismaColumns(model));
}

/** A related row a route includes, described loosely rather than duplicated. */
export const includedRow = (what: string) =>
  z.record(z.string(), z.unknown()).describe(`The ${what} row, as the route includes it`);
