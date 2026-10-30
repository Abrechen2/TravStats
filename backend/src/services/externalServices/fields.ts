/**
 * Field read/write for the external-services façade (forgejo#392).
 *
 * The façade owns no store: a field is a column of `admin_settings`,
 * `user_settings` or `smtp_config`, written with the same helpers the old
 * per-service routes use (`encryptUnlessMasked`, `decryptApiKey`) so a value
 * saved here reads back there and the other way round.
 */
import { AppError } from "../../middleware/errorHandler";
import { decryptApiKey } from "../../utils/encryption";
import { encryptUnlessMasked } from "../../utils/maskedKey";
import { checkLlmBaseUrl } from "../llm/llmEndpoint";
import { normalizeDawarichBaseUrl } from "../dawarich/errors";
import { normalizeImmichBaseUrl } from "../immich/types";
import { normalizeRelayUrl } from "../../schemas/pushAdmin";
import type { FieldDef, ServiceDef } from "./types";

export type FieldValue = string | number | boolean | null;
export interface FieldView {
  key: string;
  kind: FieldDef["kind"];
  value: FieldValue;
  masked?: boolean;
  expert: boolean;
  /** `select` fields: the allowed values. */
  options?: string[];
}

/** `•••• last4` for a stored secret; a short secret shows no tail at all. */
export function maskSecret(plain: string): string {
  return plain.length <= 8 ? "••••" : `•••• ${plain.slice(-4)}`;
}

/** The echo of a masked value (ours or the legacy `abcd****wxyz`) means "unchanged". */
export function isMaskedEcho(v: string): boolean {
  return v.startsWith("••••") || v.includes("****");
}

const NON_NULLABLE = new Set([
  "aeroapiTier",
  "aviationstackDailyBudget",
  "pushRelayUrl",
  "webdavBackupPath",
]);

export interface FieldSource {
  admin?: Record<string, unknown> | null;
  user?: Record<string, unknown> | null;
  smtp?: Record<string, unknown> | null;
}

function rawFor(field: FieldDef, src: FieldSource): unknown {
  return (src[field.store] ?? null)?.[field.column] ?? null;
}

/** Does this field hold a usable value (a secret must decrypt)? */
export function hasValue(field: FieldDef, src: FieldSource): boolean {
  const raw = rawFor(field, src);
  if (raw === null || raw === "") return false;
  if (field.kind === "secret") return typeof raw === "string" && !!decryptApiKey(raw);
  if (field.kind === "switch") return raw === true;
  return true;
}

export function viewField(field: FieldDef, src: FieldSource): FieldView {
  const raw = rawFor(field, src);
  const base = {
    key: field.key,
    kind: field.kind,
    expert: field.expert,
    ...(field.options ? { options: [...field.options] } : {}),
  };
  if (field.kind === "secret") {
    const plain = typeof raw === "string" && raw ? decryptApiKey(raw) : null;
    return plain ? { ...base, value: maskSecret(plain), masked: true } : { ...base, value: null };
  }
  if (raw === null || raw === undefined) return { ...base, value: null };
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
    return { ...base, value: raw };
  }
  return { ...base, value: null };
}

const bad = (message: string, key: string): AppError =>
  new AppError(message, 400, "VALIDATION_FAILED", key);

function normalizeUrl(service: ServiceDef, field: FieldDef, raw: string): string {
  if (service.id === "immich") {
    try {
      return normalizeImmichBaseUrl(raw);
    } catch {
      throw bad("Invalid Immich URL", field.key);
    }
  }
  if (service.id === "dawarich") {
    try {
      return normalizeDawarichBaseUrl(raw);
    } catch {
      throw bad("Invalid Dawarich URL", field.key);
    }
  }
  if (field.column === "pushRelayUrl") {
    const relay = normalizeRelayUrl(raw);
    if (!relay) throw bad("Must be an https URL (plain http only for localhost)", field.key);
    return relay;
  }
  if (service.id === "customLlm") {
    const check = checkLlmBaseUrl(raw);
    if (!check.ok) throw bad(`Invalid AI provider base URL: ${check.problem}`, field.key);
    return check.url;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw bad("Must be a valid http(s) URL", field.key);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw bad("Must be a valid http(s) URL", field.key);
  }
  return raw.replace(/\/+$/, "");
}

/**
 * Turn one incoming value into the column value, or `undefined` for "leave it
 * alone" (a masked echo). Empty string removes (null) where the column allows.
 */
export function toColumnValue(
  service: ServiceDef,
  field: FieldDef,
  incoming: unknown
): string | number | boolean | null | undefined {
  const key = field.key;
  switch (field.kind) {
    case "switch":
      if (typeof incoming !== "boolean") throw bad("Must be true or false", key);
      return incoming;
    case "number": {
      if (incoming === null && !NON_NULLABLE.has(field.column)) return null;
      if (typeof incoming !== "number" || !Number.isFinite(incoming) || incoming < 0) {
        throw bad("Must be a non-negative number", key);
      }
      return field.column === "aviationstackDailyBudget" || field.column === "port"
        ? Math.trunc(incoming)
        : incoming;
    }
    case "select":
      if (typeof incoming !== "string" || !field.options?.includes(incoming)) {
        throw bad("Not an allowed option", key);
      }
      return incoming;
    case "secret": {
      if (incoming !== null && typeof incoming !== "string") throw bad("Must be a string", key);
      if (typeof incoming === "string" && isMaskedEcho(incoming)) return undefined;
      const value = incoming === "" ? null : (incoming as string | null);
      if (value !== null && value.length > 2000) throw bad("Too long", key);
      return encryptUnlessMasked(value) ?? null;
    }
    case "url":
    case "text": {
      if (incoming !== null && typeof incoming !== "string") throw bad("Must be a string", key);
      const trimmed = (incoming ?? "").trim();
      if (trimmed === "") {
        if (NON_NULLABLE.has(field.column)) throw bad("Must not be empty", key);
        return null;
      }
      if (trimmed.length > 500) throw bad("Too long", key);
      return field.kind === "url" ? normalizeUrl(service, field, trimmed) : trimmed;
    }
  }
}

export interface FieldWrite {
  admin: Record<string, unknown>;
  user: Record<string, unknown>;
  smtp: Record<string, unknown>;
}

/**
 * Validate an incoming `fields` object against a service's field list (admin
 * or account side) and collect the column writes by store. An unknown key is
 * refused rather than ignored: a typo must not look like a save.
 */
export function collectWrites(
  service: ServiceDef,
  defs: readonly FieldDef[],
  incoming: Record<string, unknown>
): FieldWrite {
  const out: FieldWrite = { admin: {}, user: {}, smtp: {} };
  for (const [key, value] of Object.entries(incoming)) {
    const def = defs.find((f) => f.key === key);
    if (!def) throw bad(`Unknown field "${key}" for ${service.id}`, key);
    const column = toColumnValue(service, def, value);
    if (column !== undefined) out[def.store][def.column] = column;
  }
  return out;
}
