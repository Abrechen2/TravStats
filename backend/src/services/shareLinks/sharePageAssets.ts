/**
 * The public share page (forgejo#281) — a shell, a stylesheet and one script,
 * served by Express under `/share` (design §4: not a route of the private SPA,
 * which would boot the app, call `/auth/me` and inherit the app's headers).
 *
 * The shell carries NO data: the token is in the URL fragment, which only the
 * script can read, and the script asks `/api/v1/public/share-links/view` with
 * it in a POST body. A messenger's link preview, a crawler, anything that
 * fetches the URL without running script, gets this empty page.
 *
 * Everything the script puts on the page goes in through `textContent` —
 * names and trip titles are the owner's free text and are never parsed as
 * HTML. No inline script (the page's CSP has no 'unsafe-inline' for scripts),
 * no third-party resource, no cookie, no storage.
 *
 * Copy is German first, English second (the frontend language policy); the
 * script picks by the viewer's browser language.
 */

export const SHARE_PAGE_HTML = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="referrer" content="no-referrer">
<title>TravStats</title>
<link rel="stylesheet" href="/share/share.css">
<script src="/share/share.js" defer></script>
</head>
<body>
<main id="share" aria-live="polite">
<noscript><p class="note">Diese Seite braucht JavaScript. · This page needs JavaScript.</p></noscript>
</main>
<footer class="foot">TravStats</footer>
</body>
</html>
`;

export const SHARE_PAGE_CSS = `:root{color-scheme:light dark;--bg:#f6f5f2;--fg:#1d1d1f;--muted:#6b6b70;--card:#fff;--line:#e3e1dc;--accent:#4f46e5}
@media (prefers-color-scheme:dark){:root{--bg:#121214;--fg:#ececef;--muted:#9a9aa2;--card:#1c1c20;--line:#2c2c32;--accent:#818cf8}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:34rem;margin:0 auto;padding:1.5rem 1rem}
h1{font-size:1.5rem;margin:0 0 .25rem}
.sub{color:var(--muted);margin:0 0 1rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:1rem;margin:0 0 1rem}
.row{display:flex;justify-content:space-between;gap:1rem;padding:.25rem 0}
.row span:first-child{color:var(--muted)}
.big{font-size:1.25rem;font-weight:600}
progress{width:100%;height:.6rem;accent-color:var(--accent)}
ul{margin:0;padding-left:1.2rem}
.photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(9rem,1fr));gap:.5rem}
.photos img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;background:var(--line)}
.note{color:var(--muted)}
.foot{text-align:center;color:var(--muted);font-size:.8rem;padding:1rem}
a{color:var(--accent)}
`;

export const SHARE_PAGE_JS = `"use strict";
(function () {
  var de = (navigator.language || "de").toLowerCase().indexOf("de") === 0;
  var T = de
    ? {
        loading: "Wird geladen …", gone: "Dieser Link ist nicht (mehr) gültig.",
        slow: "Zu viele Anfragen – bitte einen Moment warten.", offline: "Keine Verbindung – zeigt den letzten Stand.",
        validUntil: "Link gültig bis", flight: "Flug", trip: "Reise", year: "Jahresrückblick",
        from: "Von", to: "Nach", dep: "Abflug", arr: "Ankunft", local: "Ortszeit", eta: "Ankunft (voraussichtlich)",
        scheduled: "Geplant", inFlight: "In der Luft", landed: "Gelandet", cancelled: "Annulliert", unknown: "Status unbekannt",
        reported: "nach gemeldeten Zeiten", schedule: "nach Flugplan", aircraft: "Flugzeug",
        position: "Letzte Position", noPosition: "Noch keine Position gesendet.", map: "Karte",
        flights: "Flüge", km: "km Flug", cruises: "Kreuzfahrten", rail: "Zugfahrten", countries: "Länder", days: "Tage",
        route: "Route", costs: "Kosten", incomplete: "(nicht alle Einträge mit Preis)", companions: "Mitreisende", photos: "Fotos",
        distance: "km", earth: "× um die Erde", newCountries: "neue Länder", topAirline: "Meistgeflogene Airline", topRoute: "Häufigste Strecke",
        sharedBy: "Geteilt von"
      }
    : {
        loading: "Loading …", gone: "This link is not valid (any more).",
        slow: "Too many requests – please wait a moment.", offline: "No connection – showing the last state.",
        validUntil: "Link valid until", flight: "Flight", trip: "Trip", year: "Year in review",
        from: "From", to: "To", dep: "Departure", arr: "Arrival", local: "local time", eta: "Arrival (expected)",
        scheduled: "Scheduled", inFlight: "In the air", landed: "Landed", cancelled: "Cancelled", unknown: "Status unknown",
        reported: "from reported times", schedule: "from the schedule", aircraft: "Aircraft",
        position: "Last position", noPosition: "No position sent yet.", map: "Map",
        flights: "Flights", km: "km flown", cruises: "Cruises", rail: "Train rides", countries: "Countries", days: "Days",
        route: "Route", costs: "Costs", incomplete: "(not every entry has a price)", companions: "Companions", photos: "Photos",
        distance: "km", earth: "× around the Earth", newCountries: "new countries", topAirline: "Most-flown airline", topRoute: "Most-flown route",
        sharedBy: "Shared by"
      };
  document.documentElement.lang = de ? "de" : "en";
  var root = document.getElementById("share");
  var token = decodeURIComponent((location.hash || "").slice(1));
  var timer = null;
  var photoUrls = [];

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function row(card, label, value) {
    if (value === undefined || value === null || value === "") return;
    var r = el("div", "row");
    r.appendChild(el("span", null, label));
    r.appendChild(el("span", null, value));
    card.appendChild(r);
  }
  function clock(tv) {
    if (!tv) return null;
    var d = tv.local.slice(0, 10), t = tv.local.slice(11, 16);
    return tv.precision === "minute" ? d + " " + t : d;
  }
  function message(text) {
    clear();
    root.appendChild(el("p", "note", text));
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

  function renderFlight(f) {
    var head = el("div", "card");
    var title = f.flightNumber ? [f.flightNumber.airline, f.flightNumber.number].filter(Boolean).join(" ") : T.flight;
    head.appendChild(el("h1", null, title || T.flight));
    if (f.route) head.appendChild(el("p", "sub", (f.route.from.code || "?") + " → " + (f.route.to.code || "?")));
    if (f.owner) row(head, T.sharedBy, f.owner);
    root.appendChild(head);
    if (f.progress) {
      var p = el("div", "card");
      p.appendChild(el("p", "big", T[f.progress.phase] || T.unknown));
      if (f.progress.fraction !== null) {
        var bar = el("progress"); bar.max = 1; bar.value = f.progress.fraction; p.appendChild(bar);
      }
      if (f.progress.eta) row(p, T.eta, clock(f.progress.eta) + " (" + T.local + ")");
      p.appendChild(el("p", "note", f.progress.basis === "reported" ? T.reported : T.schedule));
      root.appendChild(p);
    }
    if (f.route || f.schedule || f.aircraft) {
      var c = el("div", "card");
      if (f.route) { row(c, T.from, f.route.from.name || f.route.from.code); row(c, T.to, f.route.to.name || f.route.to.code); }
      if (f.schedule) {
        if (f.schedule.departure) row(c, T.dep, clock(f.schedule.departure) + " (" + T.local + ")");
        if (f.schedule.arrival) row(c, T.arr, clock(f.schedule.arrival) + " (" + T.local + ")");
      }
      if (f.aircraft) row(c, T.aircraft, f.aircraft);
      root.appendChild(c);
    }
    if (f.lastPosition !== undefined) {
      var lp = el("div", "card");
      lp.appendChild(el("p", "big", T.position));
      if (f.lastPosition) {
        row(lp, f.lastPosition.lat.toFixed(3) + ", " + f.lastPosition.lon.toFixed(3), new Date(f.lastPosition.at).toLocaleString(de ? "de-DE" : "en-GB"));
        var a = el("a", null, T.map);
        a.href = "https://www.openstreetmap.org/?mlat=" + f.lastPosition.lat + "&mlon=" + f.lastPosition.lon + "#map=6/" + f.lastPosition.lat + "/" + f.lastPosition.lon;
        a.rel = "noreferrer noopener"; a.target = "_blank";
        lp.appendChild(a);
      } else lp.appendChild(el("p", "note", T.noPosition));
      root.appendChild(lp);
    }
  }

  function renderTrip(t) {
    var head = el("div", "card");
    head.appendChild(el("h1", null, t.name || T.trip));
    if (t.dates && (t.dates.start || t.dates.end)) {
      head.appendChild(el("p", "sub", [t.dates.start && t.dates.start.date, t.dates.end && t.dates.end.date].filter(Boolean).join(" – ")));
    }
    if (t.owner) row(head, T.sharedBy, t.owner);
    root.appendChild(head);
    if (t.totals) {
      var c = el("div", "card");
      row(c, T.flights, t.totals.flights);
      if (t.totals.flightKm !== null) row(c, T.km, t.totals.flightKm.toLocaleString());
      if (t.totals.cruises) row(c, T.cruises, t.totals.cruises);
      if (t.totals.railRides) row(c, T.rail, t.totals.railRides);
      row(c, T.countries, t.totals.countries);
      if (t.totals.days !== null) row(c, T.days, t.totals.days);
      root.appendChild(c);
    }
    if (t.countries && t.countries.length) {
      var cc = el("div", "card"); row(cc, T.countries, t.countries.join(", ")); root.appendChild(cc);
    }
    if (t.route && t.route.length) {
      var r = el("div", "card"); r.appendChild(el("p", "big", T.route));
      var ul = el("ul");
      t.route.forEach(function (leg) { ul.appendChild(el("li", null, (leg.from || "?") + " → " + (leg.to || "?"))); });
      r.appendChild(ul); root.appendChild(r);
    }
    if (t.costs) {
      var k = el("div", "card");
      t.costs.byCurrency.forEach(function (x) { row(k, T.costs, x.amount.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " " + x.currency); });
      if (!t.costs.complete) k.appendChild(el("p", "note", T.incomplete));
      root.appendChild(k);
    }
    if (t.companions && t.companions.length) {
      var m = el("div", "card"); row(m, T.companions, t.companions.join(", ")); root.appendChild(m);
    }
    if (t.photos && t.photos.count > 0) {
      var ph = el("div", "card"); ph.appendChild(el("p", "big", T.photos));
      var grid = el("div", "photos"); ph.appendChild(grid); root.appendChild(ph);
      for (var i = 0; i < t.photos.count; i++) loadPhoto(grid, i);
    }
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
    var head = el("div", "card");
    head.appendChild(el("h1", null, T.year + " " + w.year));
    if (w.owner) row(head, T.sharedBy, w.owner);
    root.appendChild(head);
    if (w.totals) {
      var c = el("div", "card");
      row(c, T.flights, w.totals.flights);
      row(c, T.distance, Math.round(w.totals.distanceKm).toLocaleString());
      row(c, T.earth, w.totals.earthFactor);
      row(c, T.newCountries, w.totals.newCountries);
      if (w.totals.cruises !== null) row(c, T.cruises, w.totals.cruises);
      if (w.totals.railRides !== null) row(c, T.rail, w.totals.railRides);
      root.appendChild(c);
    }
    if (w.topAirline) { var a = el("div", "card"); row(a, T.topAirline, w.topAirline.name); root.appendChild(a); }
    if (w.topRoute) { var r = el("div", "card"); row(r, T.topRoute, w.topRoute.from + " ↔ " + w.topRoute.to); root.appendChild(r); }
  }

  function render(data) {
    clear();
    var v = data.view;
    if (v.kind === "flight") renderFlight(v.flight);
    else if (v.kind === "trip") renderTrip(v.trip);
    else if (v.kind === "wrapped") renderWrapped(v.wrapped);
    root.appendChild(el("p", "note", T.validUntil + " " + new Date(data.expiresAt).toLocaleString(de ? "de-DE" : "en-GB")));
    return v.kind;
  }

  function load(first) {
    post("view", { token: token })
      .then(function (res) {
        if (res.status === 404) { stop(); message(T.gone); return null; }
        if (res.status === 429) { if (first) message(T.slow); return null; }
        if (!res.ok) throw new Error("status " + res.status);
        return res.json();
      })
      .then(function (body) {
        if (!body) return;
        var kind = render(body.data);
        if (kind === "flight" && !timer) timer = setInterval(function () { load(false); }, 60000);
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
