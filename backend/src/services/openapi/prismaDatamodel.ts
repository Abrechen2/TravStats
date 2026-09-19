/**
 * The datamodel, read from `schema.prisma`.
 *
 * WHY THIS FILE EXISTS
 *   `prismaColumns()` used to read `Prisma.dmmf.datamodel.models`. Prisma 7
 *   removed it: the generated client carries only a `runtimeDataModel`, and
 *   that trimmed structure has `name`, `kind`, `type` and `dbName` per field
 *   and nothing else — measured on this schema, the key set is exactly those
 *   five including `relationName`. Neither `isRequired` nor `isList` survives,
 *   and both decide what the OpenAPI schema says: whether a column is
 *   nullable, and whether `WebAuthnCredential.transports` is a string or an
 *   array of them. A column typed from that structure would be confidently
 *   wrong rather than absent, which is the failure mode forgejo#120 already
 *   cost us once.
 *
 *   So the source of truth moves one step back, to the file the generator
 *   itself reads. `schema.prisma` ships in the production image (the
 *   Dockerfile copies `backend/prisma`), and `dist/services/openapi/` sits the
 *   same three levels below `backend/` that `src/services/openapi/` does, so
 *   one relative path serves the container, the dev server and Jest alike.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   This is not a Prisma parser. It reads `model` and `enum` blocks and the
 *   field lines inside them — the subset this schema uses, with no
 *   `Unsupported(...)`, no composite `type` blocks and no multi-line field
 *   declarations (all three verified absent). Anything it cannot recognise as
 *   a field is skipped rather than guessed at, and a model that goes missing
 *   raises instead of returning an empty column list, because an empty one
 *   would publish a schema with no properties and every guard would still be
 *   green.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Mirrors the three `kind` values the old DMMF reported for a field. */
export type PrismaFieldKind = "scalar" | "enum" | "object";

export interface PrismaModelField {
  name: string;
  kind: PrismaFieldKind;
  /** The declared type: a scalar name (`String`), an enum name, or a model name. */
  type: string;
  /** False for `Type?`. A list is always required in Prisma's own terms. */
  isRequired: boolean;
  /** True for `Type[]`. */
  isList: boolean;
}

const SCHEMA_PATH = resolve(__dirname, "..", "..", "..", "prisma", "schema.prisma");

const BLOCK_START = /^(model|enum)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/;
/** `name Type`, optionally followed by `?` or `[]`; attributes are ignored. */
const FIELD_LINE = /^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)(\[\]|\?)?/;

interface ParsedSchema {
  models: Map<string, PrismaModelField[]>;
  enums: Set<string>;
}

function parseSchema(source: string): ParsedSchema {
  const models = new Map<string, PrismaModelField[]>();
  const enums = new Set<string>();

  let currentModel: string | null = null;
  let currentFields: PrismaModelField[] = [];

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (currentModel === null) {
      const block = BLOCK_START.exec(line);
      if (!block) continue;
      if (block[1] === "enum") {
        enums.add(block[2]);
        continue;
      }
      currentModel = block[2];
      currentFields = [];
      continue;
    }

    if (line === "}") {
      models.set(currentModel, currentFields);
      currentModel = null;
      continue;
    }

    // `//` and `///` comments, and block attributes (`@@index`, `@@map`).
    if (line.startsWith("//") || line.startsWith("@@") || line.length === 0) continue;

    const field = FIELD_LINE.exec(line);
    if (!field) continue;
    currentFields.push({
      name: field[1],
      type: field[2],
      kind: "scalar", // resolved below, once every model and enum name is known
      isList: field[3] === "[]",
      isRequired: field[3] !== "?",
    });
  }

  // A field's kind depends on names that may be declared further down the
  // file, so it can only be settled once the whole schema has been read.
  for (const fields of models.values()) {
    for (const field of fields) {
      field.kind = enums.has(field.type) ? "enum" : models.has(field.type) ? "object" : "scalar";
    }
  }

  return { models, enums };
}

let cached: ParsedSchema | null = null;

function schema(): ParsedSchema {
  // Read once. The OpenAPI document is built on demand and every row schema
  // asks for its model, so re-reading 2 600 lines per call would be the one
  // measurable cost of this move.
  cached ??= parseSchema(readFileSync(SCHEMA_PATH, "utf8"));
  return cached;
}

/** Every field of `model`, relations included — callers filter by `kind`. */
export function prismaModelFields(model: string): PrismaModelField[] {
  const fields = schema().models.get(model);
  if (!fields) throw new Error(`prismaModelFields: no Prisma model named ${model}`);
  return fields;
}

/** Every model name the schema declares. */
export function prismaModelNames(): string[] {
  return [...schema().models.keys()];
}
