import { buildMap } from "./mapSvg";
import { bookStrings } from "./strings";
import type { BookEntry, BookFrame, BookLang, BookPhoto, BookTrip, DocKind } from "./types";

/**
 * Pure HTML rendering of the life book: data in, string out, no I/O and no
 * clock, so the same data always yields the same bytes (the structure test and
 * a reader diffing two books rely on it).
 *
 * The page carries its own CSS, no script, and no reference to anything outside
 * the file: photos are `data:` URIs, the map is inline SVG, links are in-page
 * anchors. A URL that appears at all appears as text.
 */

const DOC_ORDER: DocKind[] = ["booking", "ticket", "boardingPass", "invoice", "other"];

export function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function flagOf(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return "";
  return String.fromCodePoint(
    ...code
      .toUpperCase()
      .split("")
      .map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
}

export function countryLabel(code: string, lang: BookLang): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return esc(code);
  let name = code.toUpperCase();
  try {
    name = new Intl.DisplayNames([lang], { type: "region" }).of(code.toUpperCase()) ?? name;
  } catch {
    // An unknown region code keeps its letters: the flag and the code still say where.
  }
  return `${flagOf(code)} ${esc(name)}`;
}

export function fmtDay(day: string, lang: BookLang, withWeekday = true): string {
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return esc(day);
  return new Intl.DateTimeFormat(lang, {
    timeZone: "UTC",
    ...(withWeekday ? { weekday: "short" as const } : {}),
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

function dayNumber(day: string, start: string): number {
  return (
    Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1
  );
}

const CSS = `
:root{color-scheme:light}
*{box-sizing:border-box}
body{font:16px/1.55 Georgia,"Times New Roman",serif;color:#1a1a1a;background:#faf8f5;margin:0;padding:2rem 1rem}
main{max-width:820px;margin:0 auto}
h1{font-size:2.4rem;margin:0 0 .2rem}h2{font-size:1.7rem;margin:0 0 .4rem}h3{font-size:1.05rem;margin:1.6rem 0 .4rem;border-bottom:1px solid #d9d2c7;padding-bottom:.15rem}
a{color:#c2410c}.sub,.meta,.small{color:#5b554c}.small{font-size:.85rem}
.cover{text-align:center;padding:3rem 0 2rem;border-bottom:2px solid #1a1a1a}
.toc li{margin:.15rem 0}
.trip{margin-top:3rem;padding-top:1.5rem;border-top:2px solid #1a1a1a}
.facts{display:grid;grid-template-columns:max-content 1fr;gap:.2rem 1rem;margin:.6rem 0}
.facts dt{font-weight:700}.facts dd{margin:0}
ul.days,ul.entries{list-style:none;padding:0;margin:0}
.entry{margin:.55rem 0;padding-left:.8rem;border-left:3px solid #d9d2c7;break-inside:avoid}
.entry .kind{font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:#c2410c;font-family:Arial,sans-serif}
.entry .time{font-family:ui-monospace,Menlo,monospace;font-size:.85rem;margin-right:.4rem}
.entry .ev{font-size:.85rem;color:#5b554c}
.notes{white-space:pre-wrap}
figure{margin:.5rem 0}figure img{max-width:100%;height:auto;display:block}figcaption{font-size:.8rem;color:#5b554c}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem}.grid figure{margin:0}
svg.map{width:100%;height:auto;border:1px solid #d9d2c7}
svg.map .sea{fill:#eef3f6}svg.map line{stroke:#c2410c;stroke-width:1.6;opacity:.7}
svg.map circle{fill:#1a1a1a}svg.map circle.minor{fill:#c2410c}svg.map text{fill:#fff;font:10px Arial,sans-serif}
ol.legend{columns:2;font-size:.85rem;padding-left:1.4rem}
footer{margin-top:3rem;border-top:1px solid #d9d2c7;padding-top:.8rem}
@page{size:A4;margin:16mm}
@media print{body{background:#fff;padding:0;font-size:11pt}.trip{break-before:page;border-top:0;margin-top:0;padding-top:0}.cover{break-after:page}a{color:inherit;text-decoration:none}h3{break-after:avoid}}
`;

function evidenceLine(kinds: DocKind[], lang: BookLang): string {
  if (kinds.length === 0) return "";
  const s = bookStrings(lang);
  const sorted = DOC_ORDER.filter((k) => kinds.includes(k));
  return `<div class="ev">${esc(s.evidence)}: ${sorted.map((k) => esc(s.docKinds[k])).join(", ")}</div>`;
}

function photoFigure(p: BookPhoto, lang: BookLang): string {
  const when = p.takenDay ? fmtDay(p.takenDay, lang, false) : "";
  const caption = [p.caption ? esc(p.caption) : "", when].filter(Boolean).join(" · ");
  return (
    `<figure><img src="${p.dataUri}" alt="${esc(p.caption ?? "")}">` +
    (caption ? `<figcaption>${caption}</figcaption>` : "") +
    `</figure>`
  );
}

function renderEntry(e: BookEntry, lang: BookLang): string {
  const s = bookStrings(lang);
  const until =
    e.endDay && e.endDay !== e.day ? ` ${esc(s.until)} ${fmtDay(e.endDay, lang, false)}` : "";
  return (
    `<li class="entry k-${e.kind}"><span class="kind">${esc(s.entryKinds[e.kind])}</span> ` +
    (e.time ? `<span class="time">${esc(e.time)}</span>` : "") +
    (e.title ? `<strong>${esc(e.title)}</strong>` : "") +
    until +
    e.detail.map((d) => `<div class="small">${esc(d)}</div>`).join("") +
    (e.notes ? `<div class="notes">${esc(e.notes)}</div>` : "") +
    evidenceLine(e.evidence, lang) +
    e.photos.map((p) => photoFigure(p, lang)).join("") +
    `</li>`
  );
}

/** Dated entries grouped by day in order, then the undated ones, never merged. */
function renderDays(entries: BookEntry[], tripStart: string | null, lang: BookLang): string {
  const s = bookStrings(lang);
  const dated = entries
    .filter((e) => e.day)
    .sort(
      (a, b) =>
        (a.day as string).localeCompare(b.day as string) ||
        (a.sortMs ?? 0) - (b.sortMs ?? 0) ||
        a.id.localeCompare(b.id)
    );
  const undated = entries
    .filter((e) => !e.day)
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  const out: string[] = [];
  let current: string | null = null;
  let bucket: string[] = [];
  const flush = (): void => {
    if (current === null) return;
    const n = tripStart
      ? ` <span class="meta">(${esc(s.dayN)} ${dayNumber(current, tripStart)})</span>`
      : "";
    out.push(
      `<section class="day"><h3>${fmtDay(current, lang)}${n}</h3><ul class="entries">${bucket.join("")}</ul></section>`
    );
  };
  for (const e of dated) {
    if (e.day !== current) {
      flush();
      current = e.day;
      bucket = [];
    }
    bucket.push(renderEntry(e, lang));
  }
  flush();
  if (undated.length > 0) {
    out.push(
      `<section class="day undated"><h3>${esc(s.unknownDates)}</h3><ul class="entries">${undated
        .map((e) => renderEntry(e, lang))
        .join("")}</ul></section>`
    );
  }
  return out.join("");
}

export function renderHead(
  frame: BookFrame,
  toc: Array<{ id: string; name: string; startDay: string | null }>,
  hasLoose: boolean
): string {
  const s = bookStrings(frame.lang);
  const items = toc
    .map(
      (t) =>
        `<li><a href="#trip-${esc(t.id)}">${esc(t.name)}</a>` +
        ` <span class="meta">${t.startDay ? fmtDay(t.startDay, frame.lang, false) : esc(s.unknownDate)}</span></li>`
    )
    .concat(hasLoose ? [`<li><a href="#no-trip">${esc(s.noTrip)}</a></li>`] : [])
    .join("");
  return (
    `<!doctype html><html lang="${frame.lang}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="generator" content="TravStats life book"><title>${esc(s.bookTitle)} - ${esc(frame.scopeTitle)}</title>` +
    `<style>${CSS}</style></head><body><main>` +
    `<header class="cover"><h1>${esc(s.bookTitle)}</h1><p class="sub">${esc(s.subtitle)}</p>` +
    `<h2>${esc(frame.scopeTitle)}</h2><p class="meta">${esc(s.by)} ${esc(frame.username)}<br>` +
    `${esc(s.generated)} ${fmtDay(frame.generatedOn, frame.lang, false)}</p></header>` +
    `<nav class="toc"><h2>${esc(s.contents)}</h2><ol>${items}</ol></nav>`
  );
}

export function renderTrip(trip: BookTrip, frame: BookFrame): string {
  const { lang } = frame;
  const s = bookStrings(lang);
  const period =
    trip.startDay && trip.endDay && trip.endDay !== trip.startDay
      ? `${fmtDay(trip.startDay, lang)} - ${fmtDay(trip.endDay, lang)}`
      : trip.startDay
        ? fmtDay(trip.startDay, lang)
        : trip.endDay
          ? fmtDay(trip.endDay, lang)
          : esc(s.periodUnknown);
  const facts: string[] = [`<dt>${esc(s.period)}</dt><dd>${period}</dd>`];
  if (trip.countries.length > 0) {
    facts.push(
      `<dt>${esc(s.countries)}</dt><dd>${trip.countries.map((c) => countryLabel(c, lang)).join(" · ")}</dd>`
    );
  }
  if (trip.travellers.length > 0) {
    facts.push(`<dt>${esc(s.travellers)}</dt><dd>${trip.travellers.map(esc).join(", ")}</dd>`);
  }
  if (trip.evidence.length > 0) {
    const kinds = DOC_ORDER.filter((k) => trip.evidence.includes(k));
    facts.push(
      `<dt>${esc(s.evidence)}</dt><dd>${kinds.map((k) => esc(s.docKinds[k])).join(", ")}</dd>`
    );
  }
  const map = buildMap(trip.points, trip.legs, esc);
  const mapHtml = map
    ? `<h3>${esc(s.mapTitle)}</h3>${map.svg}<p class="small">${esc(s.mapNote)}</p><ol class="legend">` +
      map.listed
        .map(
          (p) =>
            `<li>${esc(p.label)} <span class="meta">(${p.lat.toFixed(4)}, ${p.lon.toFixed(4)})</span></li>`
        )
        .join("") +
      `</ol>` +
      (map.omitted > 0 ? `<p class="small">+${map.omitted} ${esc(s.mapMore)}</p>` : "")
    : "";
  const photos =
    trip.photos.length > 0
      ? `<h3>${esc(s.photos)}</h3><div class="grid">${trip.photos.map((p) => photoFigure(p, lang)).join("")}</div>`
      : "";
  return (
    `<article class="trip" id="trip-${esc(trip.id)}"><h2>${esc(trip.name)}</h2>` +
    (trip.description ? `<p class="sub">${esc(trip.description)}</p>` : "") +
    `<dl class="facts">${facts.join("")}</dl>` +
    (trip.notes ? `<h3>${esc(s.notes)}</h3><div class="notes">${esc(trip.notes)}</div>` : "") +
    mapHtml +
    renderDays(trip.entries, trip.startDay, lang) +
    photos +
    `</article>`
  );
}

export function renderLoose(entries: BookEntry[], frame: BookFrame): string {
  const s = bookStrings(frame.lang);
  return `<article class="trip" id="no-trip"><h2>${esc(s.noTrip)}</h2>${renderDays(entries, null, frame.lang)}</article>`;
}

export function renderTail(frame: BookFrame): string {
  return `<footer class="small">${esc(bookStrings(frame.lang).footer)}</footer></main></body></html>`;
}
