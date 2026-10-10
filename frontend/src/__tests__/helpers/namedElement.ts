/**
 * Find a button, link, option, tab, region or navigation by its name — or a
 * form control by its label — without asking the accessibility tree.
 *
 * `getByRole(role, { name })` computes the accessible name and visibility of
 * EVERY element of that role, through jsdom's `getComputedStyle`, which drops
 * its cache on each DOM mutation. In the long forms (the currency select alone
 * holds ~160 options) and on the settings page that costs 0.2-1.5 s per query,
 * measured 2026-10-09 — and 5-7 s for one link query on SettingsPage. On a
 * loaded CI runner under coverage it ran tests past their 5 s budget, and the
 * timed-out test then kept typing into the next test's form.
 *
 * The name read here is the one these elements actually carry:
 * `aria-labelledby`, else `aria-label`, else (not for landmarks) the trimmed
 * text with whitespace collapsed. A string
 * matches the whole name; a RegExp is tested against it. Use the role queries
 * where the role itself is under test; use this where the test only needs to
 * reach the control. Unlike the role queries these do not skip elements
 * hidden from the accessibility tree.
 */
import { waitFor } from "@testing-library/react";

type Name = string | RegExp;

const SELECTORS = {
  button: "button, [role=button]",
  link: "a[href], [role=link]",
  option: "option, [role=option]",
  tab: "[role=tab]",
  region: "section, [role=region]",
  navigation: "nav, [role=navigation]",
} as const;

export type NamedKind = keyof typeof SELECTORS;

/** Landmarks are named by their label alone, never by their content. */
const NAMED_FROM_CONTENT: Record<NamedKind, boolean> = {
  button: true,
  link: true,
  option: true,
  tab: true,
  region: false,
  navigation: false,
};

const collapse = (text: string | null): string => (text ?? "").replace(/\s+/g, " ").trim();

function nameOf(el: Element, kind: NamedKind): string {
  if (el.hasAttribute("aria-labelledby") || el.hasAttribute("aria-label")) {
    return labelledByText(el);
  }
  return NAMED_FROM_CONTENT[kind] ? collapse(el.textContent) : "";
}

function matches(el: Element, kind: NamedKind, name: Name): boolean {
  const actual = nameOf(el, kind);
  if (actual === "" && !NAMED_FROM_CONTENT[kind]) return false;
  return typeof name === "string" ? actual === name : name.test(actual);
}

/** Every element of that kind under `root` whose name matches. */
export function allNamed(
  kind: NamedKind,
  name: Name,
  root: ParentNode = document.body
): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(SELECTORS[kind])).filter((el) =>
    matches(el, kind, name)
  );
}

/** The one matching element, or null; more than one is an error, as in Testing Library. */
export function queryNamed(
  kind: NamedKind,
  name: Name,
  root: ParentNode = document.body
): HTMLElement | null {
  const found = allNamed(kind, name, root);
  if (found.length > 1) {
    throw new Error(`Found ${found.length} ${kind}s named ${String(name)}, expected one.`);
  }
  return found[0] ?? null;
}

/** The one matching element; none or several is an error. */
export function getNamed(
  kind: NamedKind,
  name: Name,
  root: ParentNode = document.body
): HTMLElement {
  const el = queryNamed(kind, name, root);
  if (el === null) {
    const offered = Array.from(root.querySelectorAll(SELECTORS[kind]))
      .map((el) => nameOf(el, kind))
      .slice(0, 30);
    throw new Error(
      `No ${kind} named ${String(name)}. ${kind}s present: ${JSON.stringify(offered)}`
    );
  }
  return el;
}

/** `getNamed`, retried until it appears — the counterpart of `findByRole`. */
export function findNamed(
  kind: NamedKind,
  name: Name,
  root: ParentNode = document.body
): Promise<HTMLElement> {
  return waitFor(() => getNamed(kind, name, root));
}

function labelledByText(el: Element): string {
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy === null) return collapse(el.getAttribute("aria-label"));
  return collapse(
    labelledBy
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? "")
      .join(" ")
  );
}

/**
 * The form control a label names, the counterpart of `getByLabelText`: the
 * `control` of a `<label>` whose text matches, or an element whose
 * `aria-labelledby` / `aria-label` text matches. `getByLabelText` inspects
 * every element of the document per lookup — 0.8 s in the rental form under
 * load, measured 2026-10-10, against 14 ms for this.
 */
export function getLabelled(name: Name, root: ParentNode = document.body): HTMLElement {
  const test = (text: string): boolean =>
    typeof name === "string" ? text === name : name.test(text);
  const viaLabel = Array.from(root.querySelectorAll("label"))
    .filter((label) => test(collapse(label.textContent)))
    .map((label) => label.control)
    .filter((el): el is HTMLElement => el !== null);
  const viaAria = Array.from(
    root.querySelectorAll<HTMLElement>("[aria-label], [aria-labelledby]")
  ).filter((el) => test(labelledByText(el)));
  const found = [...new Set([...viaLabel, ...viaAria])];
  if (found.length !== 1) {
    throw new Error(`Expected one control labelled ${String(name)}, found ${found.length}.`);
  }
  return found[0];
}

/** `getLabelled`, retried until it appears — the counterpart of `findByLabelText`. */
export function findLabelled(name: Name, root: ParentNode = document.body): Promise<HTMLElement> {
  return waitFor(() => getLabelled(name, root));
}
