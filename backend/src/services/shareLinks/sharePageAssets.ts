import {
  ABRECHEN2_ACCENT_ON_DARK,
  ABRECHEN2_ACCENT_ON_LIGHT,
  SHARE_PAGE_BRAND_SVG,
  SHARE_PAGE_LOGO,
} from "./sharePageBrand";
import { SHARE_PAGE_ITINERARY_COPY, SHARE_PAGE_ITINERARY_JS } from "./sharePageItinerary";

/**
 * The public share page (forgejo#281; the trip page redesigned 2026-11-22 as
 * an itinerary for family) — a shell, a stylesheet and one script, served by
 * Express under `/share` (design §4: not a route of the private SPA, which
 * would boot the app, call `/auth/me` and inherit the app's headers).
 *
 * The shell carries NO data: the token is in the URL fragment, which only the
 * script can read, and the script asks `/api/v1/public/share-links/view` with
 * it in a POST body. A messenger's link preview, a crawler, anything that
 * fetches the URL without running script, gets this empty page.
 *
 * Everything the script puts on the page goes in through `textContent` —
 * names and trip titles are the owner's free text and are never parsed as
 * HTML. No inline script or style (the page's CSP allows neither), no
 * third-party resource, no cookie, no storage. The one outside address is the
 * abrechen2 credit link in the footer — a link, never a fetched resource.
 *
 * The PDF is the browser's own "save as PDF" over a print stylesheet laid out
 * for A4: the server has no PDF library, and a server-side PDF would need the
 * token in a second request for no gain. The script sets the document title to
 * "<Trip>-Reiseplan" before printing, which browsers offer as the file name.
 *
 * Copy is German first, English second (the frontend language policy); the
 * script picks by the viewer's browser languages — the same list the browser
 * sends as Accept-Language.
 */

export const SHARE_PAGE_HTML = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="dark">
<title>TravStats</title>
<link rel="stylesheet" href="/share/theme.css">
<link rel="stylesheet" href="/share/share.css">
<script src="/share/share.js" defer></script>
</head>
<body>
<header class="top">${SHARE_PAGE_LOGO}</header>
<main id="share" class="page" aria-live="polite">
<noscript><p class="note">Diese Seite braucht JavaScript. · This page needs JavaScript.</p></noscript>
</main>
<footer class="foot">
<a id="credit" class="credit" href="https://www.abrechen2.de/" rel="noopener noreferrer"><span id="credit-text">Ein Projekt von</span> ${SHARE_PAGE_BRAND_SVG}</a>
</footer>
</body>
</html>
`;

/**
 * Built from the app's tokens only (`/share/theme.css`, sharePageTheme.ts):
 * every colour, radius, size and font below is a `--ts-*` variable, so the
 * page cannot drift from the app. Dark first, like the app. Print — and with
 * it the PDF — maps the same variables onto the token set's paper colours, so
 * the light version is the same product on paper. Each timeline entry carries
 * its domain's colour (`--ts-domain-*`) on its marker.
 */
export const SHARE_PAGE_CSS = `:root{color-scheme:dark;--a2:${ABRECHEN2_ACCENT_ON_DARK}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--ts-bg);color:var(--ts-text);font:15px/1.5 var(--ts-font-ui);font-variant-numeric:tabular-nums}
.top,.page,.foot{max-width:48rem;margin:0 auto;padding-left:var(--ts-space-screen-padding);padding-right:var(--ts-space-screen-padding)}
.top{display:flex;align-items:center;min-height:var(--ts-size-web-header);border-bottom:1px solid var(--ts-border)}
.ts-logo{display:inline-flex;align-items:center;gap:10px}
.ts-mark{color:var(--ts-accent);display:block}
.ts-mark text{font-family:var(--ts-font-ui)}
.ts-wordmark{display:inline-flex;align-items:center;font:500 16px/1 var(--ts-font-ui);letter-spacing:.06em;color:var(--ts-text-bright)}
.ts-cross{color:var(--ts-accent);margin:0 2px;flex:none}
.page{padding-top:var(--ts-space-xxl);padding-bottom:var(--ts-space-lg)}
h1,h2,p{margin:0}
h1{font:800 30px/1.15 var(--ts-font-ui);letter-spacing:-.5px;color:var(--ts-text-bright)}
h2{font:700 16px/1.3 var(--ts-font-ui);color:var(--ts-text)}
a{color:var(--ts-accent)}
:focus-visible{outline:none;box-shadow:var(--ts-shadow-focus-ring);border-radius:var(--ts-radius-button)}
.hero{padding:0 0 var(--ts-space-xl)}
.dates{font-size:16px;color:var(--ts-text);margin:var(--ts-space-sm) 0 0}
.meta{color:var(--ts-muted);margin:var(--ts-space-xs) 0 0}
.actions{margin:var(--ts-space-lg) 0 0}
.btn{font:600 14px/1 var(--ts-font-ui);color:var(--ts-text);background:transparent;border:1px solid var(--ts-border-button);border-radius:var(--ts-radius-button);padding:0 var(--ts-space-lg);min-height:var(--ts-size-touch-min);cursor:pointer}
.btn:hover{background:var(--ts-row-hover)}
.facts{display:flex;flex-wrap:wrap;gap:var(--ts-space-xs) var(--ts-space-lg);margin:0 0 var(--ts-space-xl);padding:0;list-style:none;color:var(--ts-muted)}
.facts b{font-weight:800;color:var(--ts-text-bright);margin-right:var(--ts-space-xs)}
.now{background:var(--ts-surface);border:1px solid var(--ts-border);border-left:3px solid var(--ts-accent);border-radius:var(--ts-radius-card);padding:var(--ts-space-lg) var(--ts-space-xl);margin:0 0 var(--ts-space-xxl)}
.now-label{display:flex;align-items:center;gap:var(--ts-space-sm);font:500 11px/1.4 var(--ts-font-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--ts-accent)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--ts-accent);animation:pulse var(--ts-motion-skeleton-pulse) var(--ts-ease-standard) infinite alternate}
@keyframes pulse{from{opacity:1}to{opacity:.35}}
@media (prefers-reduced-motion:reduce){.dot{animation:none}}
.now-title{font:700 18px/1.3 var(--ts-font-ui);color:var(--ts-text-bright);margin:var(--ts-space-sm) 0 var(--ts-space-xs)}
.now-when,.now-line{color:var(--ts-muted)}
.route{color:var(--ts-muted);margin:0 0 var(--ts-space-xl);overflow-wrap:anywhere}
.plan-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:var(--ts-space-xs) var(--ts-space-lg);border-bottom:1px solid var(--ts-border);padding:0 0 var(--ts-space-md)}
.hint{color:var(--ts-muted);font-size:12px}
.day{border-bottom:1px solid var(--ts-border);padding:var(--ts-space-lg) 0}
.day-head{display:flex;align-items:baseline;gap:var(--ts-space-sm);margin:0 0 var(--ts-space-sm)}
.day-num{font:800 28px/1 var(--ts-font-ui);color:var(--ts-text-bright)}
.day-name{font-weight:700;color:var(--ts-text)}
.day-month{color:var(--ts-muted)}
.entries{list-style:none;margin:0;padding:0}
.entry{--dom:var(--ts-muted);--dom-ink:var(--dom);display:grid;grid-template-columns:4.25rem 1fr;gap:var(--ts-space-md);padding:var(--ts-space-sm) var(--ts-space-sm);margin:0 calc(-1 * var(--ts-space-sm));border-radius:var(--ts-radius-tile)}
.entry.is-now{background:var(--ts-surface)}
.k-flight{--dom:var(--ts-domain-flight)}.k-stay{--dom:var(--ts-domain-hotel)}.k-cruise{--dom:var(--ts-domain-cruise)}
.k-rail{--dom:var(--ts-domain-rail)}.k-bus{--dom:var(--ts-domain-bus)}.k-ferry{--dom:var(--ts-domain-ferry)}
.k-rental{--dom:var(--ts-domain-rental)}.k-visit{--dom:var(--ts-domain-poi)}.k-stop{--dom:var(--ts-domain-tour)}
.t{display:block;font:600 15px/1.3 var(--ts-font-mono);color:var(--ts-text-bright)}
.z{display:block;font:400 10px/1.4 var(--ts-font-mono);color:var(--ts-muted);overflow-wrap:anywhere}
.body{border-left:3px solid var(--dom-ink);padding-left:var(--ts-space-md)}
.kind{font:500 11px/1.5 var(--ts-font-mono);letter-spacing:.12em;text-transform:uppercase;color:var(--dom-ink)}
.badge{display:inline-block;font:600 11px/1.5 var(--ts-font-ui);letter-spacing:0;text-transform:none;color:var(--ts-accent);background:color-mix(in srgb,var(--ts-accent) calc(var(--ts-status-pill-bg-alpha) * 100%),transparent);border:1px solid color-mix(in srgb,var(--ts-accent) calc(var(--ts-status-pill-border-alpha) * 100%),transparent);border-radius:var(--ts-radius-pill);padding:0 var(--ts-space-sm);margin-left:var(--ts-space-sm)}
.title{font:700 16px/1.35 var(--ts-font-ui);color:var(--ts-text-bright);overflow-wrap:anywhere}
.line{color:var(--ts-text);overflow-wrap:anywhere}
.line+.line{color:var(--ts-muted)}
.night{color:var(--ts-muted);font-size:13px;margin:var(--ts-space-sm) 0 0 calc(4.25rem + var(--ts-space-md))}
.photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(8.5rem,1fr));gap:var(--ts-space-sm);margin:var(--ts-space-lg) 0 0}
.photos img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:var(--ts-radius-tile);background:var(--ts-tile)}
.section{margin:var(--ts-space-xxl) 0 0}
.notice{padding:var(--ts-space-xxl) 0}
.notice p{color:var(--ts-muted);margin:var(--ts-space-md) 0 0;max-width:34rem}
.note{color:var(--ts-muted)}
.valid{color:var(--ts-muted);font-size:12px;margin:var(--ts-space-xl) 0 0}
.foot{display:flex;justify-content:flex-end;padding-top:var(--ts-space-xl);padding-bottom:var(--ts-space-xxl);color:var(--ts-muted);font-size:12px}
.credit{display:inline-flex;align-items:center;gap:var(--ts-space-sm);color:var(--ts-muted);text-decoration:none;min-height:var(--ts-size-touch-min)}
.credit .a2-mark{color:var(--ts-text-bright);display:block}
.a2-accent{fill:var(--a2)}
@media (min-width:720px){
h1{font-size:42px;letter-spacing:-1px}
.day{display:grid;grid-template-columns:8rem 1fr;gap:var(--ts-space-lg)}
.day-head{flex-direction:column;gap:2px;align-self:start;position:sticky;top:var(--ts-space-lg)}
}
@page{size:A4;margin:14mm 14mm 16mm}
@media print{
:root{color-scheme:light;--a2:${ABRECHEN2_ACCENT_ON_LIGHT};
--ts-bg:var(--ts-paper);--ts-surface:var(--ts-paper);--ts-tile:var(--ts-paper);
--ts-text:var(--ts-paper-text);--ts-text-bright:var(--ts-paper-text);
--ts-muted:color-mix(in srgb,var(--ts-paper-text) 65%,var(--ts-paper));
--ts-border:color-mix(in srgb,var(--ts-paper-text) 18%,var(--ts-paper));--ts-border-button:var(--ts-border);
--ts-accent:var(--ts-paper-accent)}
.entry{--dom-ink:color-mix(in srgb,var(--dom) 60%,var(--ts-paper-text))}
body{font-size:10.5pt;background:none;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.now,.entry.is-now{background:var(--ts-paper)}
.top,.page,.foot{max-width:none;padding-left:0;padding-right:0}
h1{font-size:24pt}
.actions,.photos-section{display:none}
.dot{animation:none}
.now{break-inside:avoid}
.day{display:block}
.day-head{flex-direction:row;align-items:baseline;gap:var(--ts-space-sm);position:static;break-after:avoid}
.entry{break-inside:avoid}
a{text-decoration:none}
}
`;

/**
 * Date formatting of the share page, in the visitor's language. Its own
 * constant so a test can run it (`sharePage.test.ts`).
 *
 * A calendar day (`YYYY-MM-DD`) and a place's wall clock (`TimeValue.local`)
 * are placed on a UTC instant and formatted with `timeZone: "UTC"`, so the
 * VISITOR's zone can never move them — a trip that began on 1 September began
 * on 1 September in Auckland too (ADR 0002: display `local` as it is). An
 * instant that belongs to no place (the link's end) is shown on the visitor's
 * own clock, which is what "until when" means to them. A value known only to
 * the month or the year is written as such: its stored day is a placeholder,
 * and printing it would name a day nobody knows. A place's zone is written as
 * the short name the visitor's language gives it at that instant ("MESZ",
 * "GMT-4"), and as `UTC±hh:mm` where the browser knows no name.
 */
export const SHARE_PAGE_FORMAT_JS = `function shareFormat(locale) {
  var dayFmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  var clockFmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });
  var instantFmt = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  var monthFmt = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" });
  var yearFmt = new Intl.DateTimeFormat(locale, { year: "numeric", timeZone: "UTC" });
  var weekdayFmt = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" });
  var fullFmt = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  function utcOf(local) { return new Date(local.slice(0, 19) + (local.length > 10 ? "" : "T00:00:00") + "Z"); }
  function day(ymd, precision) {
    var f = precision === "month" ? monthFmt : precision === "year" ? yearFmt : dayFmt;
    return f.format(utcOf(ymd.slice(0, 10)));
  }
  function zoneLabel(tv) {
    var fallback = "UTC" + (tv.offset && tv.offset !== "+00:00" ? tv.offset : "");
    if (!tv.zone) return fallback;
    try {
      var parts = new Intl.DateTimeFormat(locale, { timeZone: tv.zone, timeZoneName: "short", hour: "numeric" }).formatToParts(new Date(tv.utc));
      for (var i = 0; i < parts.length; i++) if (parts[i].type === "timeZoneName") return parts[i].value;
    } catch (e) { /* an unknown zone name: the offset still says it */ }
    return fallback;
  }
  return {
    day: day,
    clock: function (tv) {
      if (!tv) return null;
      return tv.precision === "minute" ? clockFmt.format(utcOf(tv.local)) : day(tv.local, tv.precision);
    },
    instant: function (iso) { return instantFmt.format(new Date(iso)); },
    dayHeading: function (ymd) {
      var d = utcOf(ymd);
      return { num: String(d.getUTCDate()), weekday: weekdayFmt.format(d), month: monthFmt.format(d), text: fullFmt.format(d) };
    },
    zoneLabel: zoneLabel
  };
}
`;

export const SHARE_PAGE_JS = `"use strict";
${SHARE_PAGE_FORMAT_JS}
${SHARE_PAGE_ITINERARY_JS}
(function () {
  var langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || "de"];
  var de = String(langs[0] || "de").toLowerCase().indexOf("de") === 0;
  var T = de
    ? {
        loading: "Wird geladen …", gone: "Dieser Link ist nicht (mehr) gültig.",
        retired: "Dieser Link ist nicht mehr verfügbar.",
        retiredWhy: "Einzelne Flüge, Kreuzfahrten, Unterkünfte und Besuche werden nicht mehr als Link geteilt. Bitte frag nach einem Link zur ganzen Reise.",
        slow: "Zu viele Anfragen – bitte einen Moment warten.", offline: "Keine Verbindung – zeigt den letzten Stand.",
        validUntil: "Link gültig bis", trip: "Reise", year: "Jahresrückblick",
        flights: "Flüge", km: "km Flug", cruises: "Kreuzfahrten", rail: "Zugfahrten", bus: "Busfahrten", ferry: "Fährfahrten", rentals: "Mietwagen", countries: "Länder", days: "Tage",
        one: { flights: "Flug", cruises: "Kreuzfahrt", rail: "Zugfahrt", bus: "Busfahrt", ferry: "Fährfahrt", rentals: "Mietwagen", countries: "Land", days: "Tag", newCountries: "neues Land" },
        route: "Route", photos: "Fotos", pdf: "Als PDF herunterladen", fileSuffix: "-Reiseplan",
        distance: "km", earth: "× um die Erde", newCountries: "neue Länder", topAirline: "Meistgeflogene Airline", topRoute: "Häufigste Strecke",
        sharedBy: "Geteilt von", credit: "Ein Projekt von"
      }
    : {
        loading: "Loading …", gone: "This link is not valid (any more).",
        retired: "This link is no longer available.",
        retiredWhy: "Single flights, cruises, stays and visits are no longer shared as links. Please ask for a link to the whole trip.",
        slow: "Too many requests – please wait a moment.", offline: "No connection – showing the last state.",
        validUntil: "Link valid until", trip: "Trip", year: "Year in review",
        flights: "Flights", km: "km flown", cruises: "Cruises", rail: "Train rides", bus: "Bus rides", ferry: "Ferry crossings", rentals: "Car rentals", countries: "Countries", days: "Days",
        one: { flights: "Flight", cruises: "Cruise", rail: "Train ride", bus: "Bus ride", ferry: "Ferry crossing", rentals: "Car rental", countries: "Country", days: "Day", newCountries: "new country" },
        route: "Route", photos: "Photos", pdf: "Download as PDF", fileSuffix: "-Itinerary",
        distance: "km", earth: "× around the Earth", newCountries: "new countries", topAirline: "Most-flown airline", topRoute: "Most-flown route",
        sharedBy: "Shared by", credit: "A project by"
      };
  var TI = ${JSON.stringify(SHARE_PAGE_ITINERARY_COPY)}[de ? "de" : "en"];
  Object.keys(TI).forEach(function (k) { T[k] = TI[k]; });
  document.documentElement.lang = de ? "de" : "en";
  var root = document.getElementById("share");
  var credit = document.getElementById("credit");
  if (credit && credit !== root && !de) {
    credit.setAttribute("href", "https://www.abrechen2.de/en/");
    var creditText = document.getElementById("credit-text");
    if (creditText && creditText !== root) creditText.textContent = T.credit;
  }
  var token = decodeURIComponent((location.hash || "").slice(1));
  var timer = null;
  var photoUrls = [];
  var fmt = shareFormat(de ? "de-DE" : "en-GB");
  var num = new Intl.NumberFormat(de ? "de-DE" : "en-GB");

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function put(parent, tag, cls, text) {
    if (text === undefined || text === null || text === "") return null;
    return parent.appendChild(el(tag, cls, text));
  }
  function message(text) {
    clear();
    root.appendChild(el("p", "note", text));
  }
  function notice(title, why) {
    clear();
    var box = root.appendChild(el("section", "notice"));
    box.appendChild(el("h1", null, title));
    put(box, "p", null, why);
  }
  function clear() {
    photoUrls.forEach(function (u) { URL.revokeObjectURL(u); });
    photoUrls = [];
    while (root.firstChild) root.removeChild(root.firstChild);
  }
  function post(path, body) {
    return fetch("/api/v1/public/share-links/" + path, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer"
    });
  }
  function count(n, label) { return n + " " + label; }

  function pdfButton(parent, name) {
    var wrap = parent.appendChild(el("div", "actions"));
    var btn = wrap.appendChild(el("button", "btn", T.pdf));
    btn.setAttribute("type", "button");
    btn.addEventListener("click", function () {
      var before = document.title;
      // Browsers offer the document title as the PDF's file name.
      document.title = String(name || T.trip).replace(/[\\\\/:*?"<>|]+/g, " ").trim() + T.fileSuffix;
      window.print();
      setTimeout(function () { document.title = before; }, 1000);
    });
  }

  function renderTrip(t) {
    var hero = root.appendChild(el("header", "hero"));
    hero.appendChild(el("h1", null, t.name || T.trip));
    if (t.dates && (t.dates.start || t.dates.end)) {
      put(hero, "p", "dates", [t.dates.start && fmt.day(t.dates.start.date), t.dates.end && fmt.day(t.dates.end.date)].filter(Boolean).join(" – "));
    }
    if (t.owner) put(hero, "p", "meta", T.sharedBy + " " + t.owner);
    if (t.countries && t.countries.length) put(hero, "p", "meta", t.countries.join(", "));
    if (t.itinerary) pdfButton(hero, t.name);
    document.title = (t.name || T.trip) + " – TravStats";

    if (t.totals) {
      var facts = root.appendChild(el("ul", "facts"));
      var fact = function (n, key) {
        if (n === null || n === undefined || n === 0) return;
        var li = facts.appendChild(el("li"));
        li.appendChild(el("b", null, num.format(n)));
        li.appendChild(el("span", null, n === 1 && T.one[key] ? T.one[key] : T[key]));
      };
      fact(t.totals.days, "days"); fact(t.totals.flights, "flights"); fact(t.totals.flightKm, "km");
      fact(t.totals.railRides, "rail"); fact(t.totals.busRides, "bus"); fact(t.totals.ferryCrossings, "ferry");
      fact(t.totals.rentals, "rentals"); fact(t.totals.cruises, "cruises"); fact(t.totals.countries, "countries");
    }
    if (t.route && t.route.length) {
      var stops = [];
      t.route.forEach(function (leg) {
        if (!stops.length || stops[stops.length - 1] !== (leg.from || "?")) stops.push(leg.from || "?");
        stops.push(leg.to || "?");
      });
      put(root, "p", "route", T.route + ": " + stops.join(" → "));
    }
    if (t.itinerary) renderItinerary(t.itinerary);
    if (t.photos && t.photos.count > 0) {
      var ph = root.appendChild(el("section", "section photos-section"));
      ph.appendChild(el("h2", null, T.photos));
      var grid = ph.appendChild(el("div", "photos"));
      for (var i = 0; i < t.photos.count; i++) loadPhoto(grid, i);
    }
  }

  function renderItinerary(it) {
    var plan = planDays(it, fmt, T);
    var now = root.appendChild(el("section", "now"));
    if (plan.now) {
      var label = now.appendChild(el("p", "now-label"));
      label.appendChild(el("span", "dot"));
      label.appendChild(el("span", null, plan.now.label));
      put(now, "p", "now-title", plan.now.kind + ": " + plan.now.title);
      put(now, "p", "now-when", [plan.now.day, plan.now.time && plan.now.time + " " + plan.now.zone].filter(Boolean).join(", "));
      plan.now.lines.forEach(function (l) { put(now, "p", "now-line", l); });
    } else {
      now.appendChild(el("p", "now-line", it.items.length ? T.nothingAhead : T.noEntries));
    }

    var section = root.appendChild(el("section", "plan"));
    var head = section.appendChild(el("div", "plan-head"));
    head.appendChild(el("h2", null, T.itinerary));
    head.appendChild(el("p", "hint", T.localTimes));
    plan.days.forEach(function (d) {
      var day = section.appendChild(el("section", "day"));
      var dh = day.appendChild(el("header", "day-head"));
      if (d.heading) {
        dh.setAttribute("aria-label", d.heading.text);
        dh.appendChild(el("span", "day-num", d.heading.num));
        dh.appendChild(el("span", "day-name", d.heading.weekday));
        dh.appendChild(el("span", "day-month", d.heading.month));
      } else dh.appendChild(el("span", "day-name", T.undated));
      var body = day.appendChild(el("div"));
      var list = body.appendChild(el("ul", "entries"));
      d.entries.forEach(function (e) {
        var li = list.appendChild(el("li", "entry k-" + e.kind + (e.now ? " is-now" : "")));
        if (e.now) li.setAttribute("aria-current", "step");
        var when = li.appendChild(el("div", "when"));
        put(when, "span", "t", e.time);
        put(when, "span", "z", e.zone);
        var main = li.appendChild(el("div", "body"));
        var kind = main.appendChild(el("p", "kind", e.label));
        if (e.now) kind.appendChild(el("span", "badge", e.now));
        put(main, "p", "title", e.title);
        e.lines.forEach(function (l) { put(main, "p", "line", l); });
      });
      d.nights.forEach(function (n) { put(body, "p", "night", T.nightAt + ": " + n); });
    });
  }

  function loadPhoto(grid, index) {
    var img = el("img"); img.alt = T.photos + " " + (index + 1); img.decoding = "async"; grid.appendChild(img);
    post("photo", { token: token, index: index })
      .then(function (res) { return res.ok ? res.blob() : null; })
      .then(function (blob) {
        if (!blob) { grid.removeChild(img); return; }
        var url = URL.createObjectURL(blob); photoUrls.push(url); img.src = url;
      })
      .catch(function () { if (img.parentNode) grid.removeChild(img); });
  }

  function renderWrapped(w) {
    var hero = root.appendChild(el("header", "hero"));
    hero.appendChild(el("h1", null, T.year + " " + w.year));
    if (w.owner) put(hero, "p", "meta", T.sharedBy + " " + w.owner);
    document.title = T.year + " " + w.year + " – TravStats";
    if (w.totals) {
      var facts = root.appendChild(el("ul", "facts"));
      var fact = function (n, key) {
        if (n === null || n === undefined) return;
        var li = facts.appendChild(el("li"));
        li.appendChild(el("b", null, num.format(n)));
        li.appendChild(el("span", null, n === 1 && T.one[key] ? T.one[key] : T[key]));
      };
      fact(w.totals.flights, "flights");
      fact(w.totals.distanceKm === null ? null : Math.round(w.totals.distanceKm), "distance");
      fact(w.totals.earthFactor, "earth");
      fact(w.totals.newCountries, "newCountries");
      fact(w.totals.cruises, "cruises");
      fact(w.totals.railRides, "rail");
    }
    if (w.topAirline) put(root, "p", "meta", T.topAirline + ": " + w.topAirline.name);
    if (w.topRoute) put(root, "p", "meta", T.topRoute + ": " + w.topRoute.from + " ↔ " + w.topRoute.to);
  }

  function render(data) {
    clear();
    var v = data.view;
    if (v.kind === "trip") renderTrip(v.trip);
    else if (v.kind === "wrapped") renderWrapped(v.wrapped);
    root.appendChild(el("p", "valid", T.validUntil + " " + fmt.instant(data.expiresAt)));
    return v.kind;
  }

  function load(first) {
    post("view", { token: token })
      .then(function (res) {
        if (res.status === 404) { stop(); message(T.gone); return null; }
        if (res.status === 410) { stop(); notice(T.retired, T.retiredWhy); return null; }
        if (res.status === 429) { if (first) message(T.slow); return null; }
        if (!res.ok) throw new Error("status " + res.status);
        return res.json();
      })
      .then(function (body) {
        if (!body) return;
        var kind = render(body.data);
        // An itinerary's "now" moves with the clock: read it again every five minutes.
        if (kind === "trip" && body.data.view.trip.itinerary && !timer) timer = setInterval(function () { load(false); }, 300000);
      })
      .catch(function () {
        if (first) message(T.offline);
        else root.appendChild(el("p", "note", T.offline));
      });
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  if (!token) { message(T.gone); return; }
  message(T.loading);
  load(true);
})();
`;
