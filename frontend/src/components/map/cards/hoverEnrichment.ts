// Fills the async slots of a drawn hover tooltip (owner, 2026-10-21): the
// operator's logo, a picture of the ship / car / train, a station's photo and
// opening sentences.
//
// The tooltip is HTML fed through an imperative handle at 60–120 Hz, so it
// cannot wait for anything. It is drawn at once with empty slots
// (`journeyHoverHtml.ts`); this pass, run once per NEW tooltip content, asks
// the (cached) lookups after a short rest and fills a slot only while it is
// still on screen. A miss, a failure or an image that does not load leaves the
// slot empty — the tooltip stays exactly as it was drawn.

import {
  getOperatorMark,
  operatorLogoPath,
  type OperatorMarkDomain,
} from "../../../lib/api/operators";
import {
  getStopInfo,
  getSubjectImage,
  subjectImagePath,
  type StopDomain,
  type SubjectKind,
} from "../../../lib/api/mapDetails";
import { wikiLanguage } from "../../../lib/api/openData";
import i18next from "i18next";
import { useSettingsStore } from "../../../store/settingsStore";

/** Hovering across a map passes many objects; only one the pointer rests on is asked about. */
export const ENRICH_DELAY_MS = 180;

const OPERATOR_DOMAINS: readonly string[] = ["rail", "bus", "ferry", "rental", "cruise"];
const SUBJECT_KINDS: readonly string[] = ["vessel", "vehicle", "train"];
const STOP_DOMAINS: readonly string[] = ["rail", "bus", "ferry", "rental"];

function image(
  src: string,
  style: string,
  onSettled: () => void,
  referrerPolicy?: ReferrerPolicy
): HTMLImageElement {
  const img = document.createElement("img");
  img.alt = "";
  img.decoding = "async";
  img.setAttribute("style", style);
  if (referrerPolicy) img.referrerPolicy = referrerPolicy;
  img.addEventListener("load", onSettled);
  // A picture that does not load is no picture: removed, never a broken icon.
  img.addEventListener("error", () => {
    img.remove();
    onSettled();
  });
  img.src = src;
  return img;
}

function caption(text: string): HTMLDivElement {
  const div = document.createElement("div");
  div.textContent = text;
  div.setAttribute("style", "opacity:0.55;font-size:9px;margin-top:2px;");
  return div;
}

async function fillOperator(slot: HTMLElement, onChange: () => void, alive: () => boolean) {
  const domain = slot.dataset.domain ?? "";
  const name = slot.dataset.name ?? "";
  if (!OPERATOR_DOMAINS.includes(domain) || !name) return;
  const mark = await getOperatorMark(domain as OperatorMarkDomain, name);
  if (!alive() || !mark.available) return;
  slot.append(
    image(
      operatorLogoPath(domain as OperatorMarkDomain, name),
      "width:22px;height:22px;object-fit:contain;border-radius:4px;background:#fff;",
      onChange
    )
  );
  onChange();
}

async function fillSubject(slot: HTMLElement, onChange: () => void, alive: () => boolean) {
  const kind = slot.dataset.kind ?? "";
  const name = slot.dataset.name ?? "";
  if (!SUBJECT_KINDS.includes(kind) || !name) return;
  const picture = await getSubjectImage(kind as SubjectKind, name);
  if (!alive() || !picture.available || !picture.credit) return;
  const credit = picture.credit;
  const img = image(
    subjectImagePath(kind as SubjectKind, name),
    "display:block;width:100%;max-width:240px;height:96px;object-fit:cover;border-radius:4px;margin-top:6px;",
    onChange
  );
  const source = [credit.licence, credit.artist, "Wikimedia Commons"].filter(Boolean).join(" · ");
  const label = slot.dataset.credit;
  slot.append(img, caption(label ? `${label}: ${source}` : source));
  onChange();
}

async function fillStop(slot: HTMLElement, onChange: () => void, alive: () => boolean) {
  const domain = slot.dataset.domain ?? "";
  const name = slot.dataset.name ?? "";
  const lat = Number(slot.dataset.lat);
  const lon = Number(slot.dataset.lon);
  if (!STOP_DOMAINS.includes(domain) || !name || !Number.isFinite(lat) || !Number.isFinite(lon))
    return;
  // The instance's switch: off means nothing is asked and nothing is said.
  if (useSettingsStore.getState().openDataEnabled !== true) return;
  const info = await getStopInfo(
    domain as StopDomain,
    { name, lat, lon },
    wikiLanguage(i18next.language)
  );
  if (!alive()) return;
  if (info.state === "unavailable") {
    slot.append(caption(slot.dataset.unavailable ?? ""));
    onChange();
    return;
  }
  if (info.state !== "found") return;
  const row = document.createElement("div");
  row.setAttribute("style", "display:flex;gap:8px;margin-top:6px;align-items:flex-start;");
  if (info.summary.thumbnailUrl) {
    row.append(
      image(
        info.summary.thumbnailUrl,
        "width:56px;height:56px;flex:none;object-fit:cover;border-radius:4px;",
        onChange,
        "no-referrer"
      )
    );
  }
  const text = document.createElement("div");
  text.textContent = info.summary.extract;
  text.setAttribute(
    "style",
    "font-size:10.5px;line-height:1.35;opacity:0.85;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;"
  );
  row.append(text);
  slot.append(row, caption(slot.dataset.credit ?? "Wikipedia"));
  onChange();
}

/**
 * Fill every slot under `root` after a short rest. Returns the cancel: a
 * tooltip that moved on to another object must not receive the old one's
 * pictures. `onChange` re-places the box once its size changed.
 */
export function enrichHoverBox(root: HTMLElement, onChange: () => void): () => void {
  let cancelled = false;
  const alive = (): boolean => !cancelled && root.isConnected;
  const timer = setTimeout(() => {
    const run = (selector: string, fill: typeof fillStop): void => {
      root.querySelectorAll<HTMLElement>(selector).forEach((slot) => {
        if (slot.dataset.filled) return;
        slot.dataset.filled = "1";
        void fill(slot, () => alive() && onChange(), alive);
      });
    };
    run("[data-hover-operator]", fillOperator);
    run("[data-hover-subject]", fillSubject);
    run("[data-hover-stop]", fillStop);
  }, ENRICH_DELAY_MS);
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}
