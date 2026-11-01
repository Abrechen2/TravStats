/**
 * The "template request" issue a user opens in the public template repository
 * (forgejo#330), modelled on the bug-report link of `DiagnosticExportModal`.
 *
 * Nothing here talks to a server: the user's own GitHub account files the
 * issue, TravStats only builds the link. The template itself comes from the
 * server's community export, which has already taken the user's values out;
 * `findPersonalText` is a second, independent look at exactly the text that
 * is about to leave, because the repository is public.
 */

export const TEMPLATE_REPO_ISSUE_URL =
  "https://github.com/Abrechen2/travstats-templates/issues/new";
export const TEMPLATE_REPO_NEW_ISSUE_FORM = "template-request.yml";

/**
 * GitHub answers a new-issue link of roughly 8 KB with an error page instead
 * of a form. Stay well below it so the page opens, and fall back to "copy the
 * JSON, open the form" above it.
 */
export const MAX_ISSUE_URL_LENGTH = 6500;

export type PersonalTextKind = "email" | "phone" | "bookingCode" | "longNumber";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;
// A leading + or 0, then at least 7 digits that may be split by spaces, dots, dashes or brackets.
const PHONE = /(?:\+|\b0)\d[\d\s().-]{6,}\d/;
// Six to eight capitals and digits, mixing both: a PNR such as "X7K2QP" or "ABC123".
const BOOKING_CODE = /\b(?=[A-Z0-9]{6,8}\b)(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]+\b/;
const LONG_NUMBER = /\b\d{9,}\b/;

/** What kind of personal value sits in `text`, in the order the checks run. */
function kindsIn(text: string): PersonalTextKind[] {
  const kinds: PersonalTextKind[] = [];
  if (EMAIL.test(text)) kinds.push("email");
  // An e-mail address or number run is also matched by the phone shape; name each once.
  if (PHONE.test(text.replace(EMAIL, " "))) kinds.push("phone");
  if (BOOKING_CODE.test(text)) kinds.push("bookingCode");
  if (LONG_NUMBER.test(text) && !kinds.includes("phone")) kinds.push("longNumber");
  return kinds;
}

/** Every string inside a JSON value, depth first. */
function stringsOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsOf);
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap(stringsOf);
  }
  return [];
}

/**
 * The kinds of personal value found in any string of `value` (a template, or
 * plain text). Empty when nothing looks personal. A guard, not a proof: names
 * are the server's job, which knows the account's own.
 */
export function findPersonalText(value: unknown): PersonalTextKind[] {
  const found = new Set<PersonalTextKind>();
  for (const text of stringsOf(value)) for (const kind of kindsIn(text)) found.add(kind);
  return [...found];
}

export interface TemplateIssue {
  title: string;
  /** The text of every form field, as the user will see it on GitHub. */
  fields: { provider: string; markets: string; template_json: string };
  /** The new-issue link with every field prefilled. */
  url: string;
  /** Same link without the JSON: used when the full link would be too long. */
  urlWithoutJson: string;
  /** True when the JSON does not fit in a link and has to be copied by hand. */
  tooLong: boolean;
}

function query(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

/** The issue for one exported template (`CommunityExportFile.template`). */
export function buildTemplateIssue(template: Record<string, unknown>): TemplateIssue {
  const issuer = template.issuer as { name?: unknown } | undefined;
  const provider = typeof issuer?.name === "string" && issuer.name ? issuer.name : "";
  const markets = Array.isArray(template.markets)
    ? template.markets.filter((m): m is string => typeof m === "string").join(", ")
    : "";
  const domain = typeof template.domain === "string" ? template.domain : "";
  const title = `Template request: ${[domain, provider].filter(Boolean).join(" / ") || "new template"}`;
  const templateJson = JSON.stringify(template, null, 2);
  const base = {
    template: TEMPLATE_REPO_NEW_ISSUE_FORM,
    labels: "template-request",
    title,
    provider,
    markets,
  };
  const url = `${TEMPLATE_REPO_ISSUE_URL}?${query({ ...base, template_json: templateJson })}`;
  const urlWithoutJson = `${TEMPLATE_REPO_ISSUE_URL}?${query(base)}`;
  return {
    title,
    fields: { provider, markets, template_json: templateJson },
    url,
    urlWithoutJson,
    tooLong: url.length > MAX_ISSUE_URL_LENGTH,
  };
}
