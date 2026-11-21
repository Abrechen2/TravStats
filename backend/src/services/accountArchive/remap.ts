import { createHash } from "crypto";

/**
 * How an imported account's ids and file names change (forgejo#433).
 *
 * Every row gets a new id, so one archive can be imported next to the account it
 * came from, or twice on one server, without a key colliding. The new id is a
 * hash of the old one and a per-import nonce: a foreign key is rewritten by the
 * same function, without a lookup table — TravTrack can hold a million points.
 * An old id in UUID form stays a UUID (a route validating `.uuid()` keeps working);
 * any other id becomes a 25-character cuid-shaped string.
 *
 * Ids also live outside foreign keys: a place category is named `custom:<id>` in
 * JSON, a packing item names its account, a suggestion lists member keys. Text and
 * JSON values are therefore scanned for tokens that are ids of the archive, which
 * are replaced; everything else stays as it was. Stored file names are replaced
 * only in the columns that name a file (`files` in `tablePolicy.ts`): a document's
 * original name may well equal its stored name, and must stay what the user called it.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A token that could be an id: what cuid, uuid and the test ids are made of. */
const TOKEN = /[A-Za-z0-9_-]{6,}/g;

export class Remapper {
  /** Old id (or user id) -> new id, for tokens inside text and JSON. */
  private readonly tokens = new Map<string, string>();
  /** Old stored file name -> new stored file name. */
  private readonly files = new Map<string, string>();

  constructor(
    private readonly nonce: string,
    readonly sourceUserId: string,
    readonly targetUserId: string
  ) {
    this.tokens.set(sourceUserId, targetUserId);
  }

  id(old: string): string {
    const hex = createHash("sha256").update(`${this.nonce}:${old}`).digest("hex");
    if (UUID.test(old)) {
      const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    }
    return `c${hex.slice(0, 24)}`;
  }

  /** Marks an id of the archive, so text naming it is rewritten too. */
  knowId(old: string): void {
    if (old.length >= 6) this.tokens.set(old, this.id(old));
  }

  hasId(old: string): boolean {
    return this.tokens.has(old);
  }

  setFile(oldName: string, newName: string): void {
    this.files.set(oldName, newName);
  }

  fileName(oldName: string): string | undefined {
    return this.files.get(oldName);
  }

  /** `files`: the column names a stored upload, so file names are renamed too. */
  rewriteString(value: string, files = false): string {
    const whole = (files ? this.files.get(value) : undefined) ?? this.tokens.get(value);
    if (whole !== undefined) return whole;
    let out = value;
    if (files && value.includes("/")) {
      out = value
        .split("/")
        .map((segment) => this.files.get(segment) ?? segment)
        .join("/");
    }
    return out.replace(TOKEN, (token) => this.tokens.get(token) ?? token);
  }

  /** Text, arrays and JSON objects (keys included), at any depth. */
  rewrite(value: unknown, files = false): unknown {
    if (typeof value === "string") return this.rewriteString(value, files);
    if (Array.isArray(value)) return value.map((v) => this.rewrite(v, files));
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [this.rewriteString(k), this.rewrite(v, files)])
      );
    }
    return value;
  }
}

/** A new stored name that keeps the old one's tail (and with it `<name>.display.jpg`). */
export function importedFileName(
  dir: string,
  oldName: string,
  prefix: string,
  targetUserId: string,
  sourceUserId: string
): string {
  if (dir === "profile-pictures") {
    // The avatar's owner is read from its name (`<userId>_…`, uploadDirPolicies.ts).
    const rest = oldName.startsWith(`${sourceUserId}_`)
      ? oldName.slice(sourceUserId.length + 1)
      : oldName;
    return `${targetUserId}_${prefix}-${rest}`;
  }
  return `${prefix}-${oldName}`;
}
