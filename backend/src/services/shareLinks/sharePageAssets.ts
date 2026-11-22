import { SHARE_PAGE_BRAND_SVG } from "./sharePageBrand";
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
<meta name="color-scheme" content="light dark">
<title>TravStats</title>
<link rel="stylesheet" href="/share/share.css">
<script src="/share/share.js" defer></script>
</head>
<body>
<main id="share" class="page" aria-live="polite">
<noscript><p class="note">Diese Seite braucht JavaScript. · This page needs JavaScript.</p></noscript>
</main>
<footer class="foot">
<p class="foot-app">TravStats</p>
<a id="credit" class="credit" href="https://www.abrechen2.de/" rel="noopener noreferrer"><span id="credit-text">Ein Projekt von</span> ${SHARE_PAGE_BRAND_SVG}</a>
</footer>
</body>
</html>
`;

export const SHARE_PAGE_CSS = `:root{color-scheme:light dark;--bg:#eef2f1;--surface:#fff;--ink:#16201d;--muted:#56645f;--rule:#d3dbd8;--accent:#0a6b7c;--now:#dceff1;--a2:#c2410c;
--serif:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif;--sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#0e1413;--surface:#151d1b;--ink:#e4ebe8;--muted:#9aa9a4;--rule:#27322f;--accent:#62c3d2;--now:#11292c;--a2:#ff7a1a}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 var(--sans);font-variant-numeric:tabular-nums}
.page{max-width:46rem;margin:0 auto;padding:2rem 1rem 1rem}
h1,h2{font-family:var(--serif);font-weight:600;margin:0;letter-spacing:-.01em}
h1{font-size:2.1rem;line-height:1.15}
h2{font-size:1.35rem}
p{margin:0}
a{color:var(--accent)}
:focus-visible{outline:3px solid var(--accent);outline-offset:2px;border-radius:4px}
.hero{padding:0 0 1.5rem}
.dates{font-size:1.1rem;margin:.4rem 0 0}
.meta{color:var(--muted);margin:.35rem 0 0}
.actions{margin:1.1rem 0 0}
.btn{font:inherit;font-weight:600;color:var(--accent);background:var(--surface);border:1.5px solid var(--accent);border-radius:999px;padding:.55rem 1.1rem;min-height:44px;cursor:pointer}
.btn:hover{background:var(--now)}
.now{background:var(--now);border-left:4px solid var(--accent);border-radius:0 14px 14px 0;padding:1rem 1.1rem;margin:0 0 1.75rem}
.now-label{display:flex;align-items:center;gap:.55rem;font-weight:700;color:var(--accent)}
.dot{width:.7rem;height:.7rem;border-radius:50%;background:var(--accent);box-shadow:0 0 0 0 var(--accent);animation:pulse 2.4s ease-out infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(10,107,124,.45)}70%{box-shadow:0 0 0 .6rem rgba(10,107,124,0)}100%{box-shadow:0 0 0 0 rgba(10,107,124,0)}}
@media (prefers-reduced-motion:reduce){.dot{animation:none}}
.now-title{font-family:var(--serif);font-size:1.3rem;font-weight:600;margin:.3rem 0 .1rem}
.now-when,.now-line{color:var(--muted)}
.route{color:var(--muted);margin:0 0 1.75rem;overflow-wrap:anywhere}
.plan-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:.25rem 1rem;border-bottom:2px solid var(--ink);padding:0 0 .5rem}
.hint{color:var(--muted);font-size:.875rem}
.day{border-bottom:1px solid var(--rule);padding:1rem 0}
.day-head{display:flex;align-items:baseline;gap:.6rem;margin:0 0 .5rem}
.day-num{font-family:var(--serif);font-size:2.2rem;line-height:1;font-weight:600}
.day-name{font-weight:600}
.day-month{color:var(--muted)}
.entries{list-style:none;margin:0;padding:0}
.entry{display:grid;grid-template-columns:4.4rem 1fr;gap:.75rem;padding:.6rem .5rem;margin:0 -.5rem;border-radius:10px}
.entry+.entry{border-top:1px solid var(--rule)}
.entry.is-now{background:var(--now);border-top-color:transparent}
.entry.is-now+.entry{border-top-color:transparent}
.t{display:block;font-weight:700;font-size:1.05rem}
.z{display:block;color:var(--muted);font-size:.75rem;line-height:1.3;overflow-wrap:anywhere}
.kind{color:var(--muted);font-size:.875rem}
.badge{display:inline-block;background:var(--accent);color:var(--surface);font-weight:700;font-size:.75rem;border-radius:999px;padding:.05rem .5rem;margin-left:.5rem;vertical-align:.1em}
.title{font-weight:650;font-size:1.05rem;overflow-wrap:anywhere}
.line{color:var(--ink);overflow-wrap:anywhere}
.line+.line{color:var(--muted)}
.night{color:var(--muted);font-size:.9rem;margin:.4rem 0 0 5.15rem}
.empty{color:var(--muted);padding:1rem 0}
.facts{display:flex;flex-wrap:wrap;gap:.35rem 1.1rem;margin:-.5rem 0 1.5rem;padding:0;list-style:none;color:var(--muted)}
.facts b{font-family:var(--serif);font-size:1.15rem;color:var(--ink);margin-right:.25rem}
.photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(8.5rem,1fr));gap:.5rem;margin:1rem 0 0}
.photos img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;background:var(--rule)}
.section{margin:2rem 0 0}
.notice{padding:3rem 0}
.notice p{color:var(--muted);margin:.75rem 0 0;max-width:34rem}
.note{color:var(--muted)}
.valid{color:var(--muted);font-size:.875rem;margin:1.75rem 0 0}
.foot{max-width:46rem;margin:0 auto;padding:1.5rem 1rem 2.5rem;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.75rem;color:var(--muted);font-size:.875rem}
.foot-app{font-weight:600}
.credit{display:inline-flex;align-items:center;gap:.5rem;color:var(--muted);text-decoration:none;min-height:44px}
.credit .a2-mark{color:var(--ink);display:block}
.a2-accent{fill:var(--a2)}
@media (min-width:720px){
.page{padding-top:3rem}
h1{font-size:2.75rem}
.day{display:grid;grid-template-columns:8.5rem 1fr;gap:1rem}
.day-head{flex-direction:column;gap:.1rem;align-self:start;position:sticky;top:1rem}
.night{margin-left:5.15rem}
}
@page{size:A4;margin:14mm 14mm 16mm}
@media print{
:root{--bg:#fff;--surface:#fff;--ink:#111;--muted:#4a4a4a;--rule:#cfcfcf;--accent:#0a6b7c;--now:#eef6f7;--a2:#c2410c}
body{font-size:10.5pt;background:#fff}
.page{max-width:none;padding:0}
h1{font-size:22pt}
.actions,.photos-section{display:none}
.dot{animation:none}
.now{break-inside:avoid}
.day{display:block}
.day-head{flex-direction:row;align-items:baseline;gap:.5rem;position:static;break-after:avoid}
.entry{break-inside:avoid}
.foot{max-width:none;padding:6mm 0 0}
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
        var li = list.appendChild(el("li", "entry" + (e.now ? " is-now" : "")));
        if (e.now) li.setAttribute("aria-current", "step");
        var when = li.appendChild(el("div", "when"));
        put(when, "span", "t", e.time);
        put(when, "span", "z", e.zone);
        var main = li.appendChild(el("div"));
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
