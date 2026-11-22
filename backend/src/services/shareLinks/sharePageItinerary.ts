/**
 * The itinerary of the public share page (forgejo#302, redesigned 2026-11-22
 * as a day-by-day plan for family) — plain ES5 run in the visitor's browser,
 * like the rest of `sharePageAssets.ts`. Its own constant so
 * `sharePage.test.ts` can run it.
 *
 * `planDays` turns the payload into days of entries made of plain strings; the
 * page script only puts those strings into the DOM through `textContent`.
 * Every time is the wall clock of its place (`TimeValue.local`, never the
 * visitor's zone) with that place's zone written beside it, and the entry in
 * progress — or the next one — is named in words, not by colour alone.
 *
 * An entry that spans days is split where family would look for it: a stay
 * checks in on one day, sleeps there on the nights between and checks out on
 * another; a rental is picked up and returned; a cruise calls at each port on
 * that port's day.
 */
export const SHARE_PAGE_ITINERARY_JS = `function planDays(it, fmt, T) {
  var days = {};
  var order = [];
  function dayOf(key) {
    var k = key || "";
    if (!days[k]) {
      days[k] = { key: k, heading: k ? fmt.dayHeading(k) : null, nights: [], entries: [] };
      order.push(k);
    }
    return days[k];
  }
  function keyOfTime(tv) {
    return tv && (tv.precision === "minute" || tv.precision === "day") ? tv.local.slice(0, 10) : null;
  }
  function keyOfDay(d) { return d && d.precision === "day" ? d.date : null; }
  function hm(tv) { return tv && tv.precision === "minute" ? tv.local.slice(11, 16) : null; }
  function zone(tv) { return tv && tv.precision === "minute" ? fmt.zoneLabel(tv) : null; }
  function at(tv) {
    if (!tv) return null;
    return tv.precision === "minute" ? hm(tv) + " " + fmt.zoneLabel(tv) : fmt.clock(tv);
  }
  function dayText(d) { return d ? fmt.day(d.date, d.precision) : null; }
  // A time known only to the month or the year sits under "no date" — but says what is known.
  function vague(tv) { return tv && !keyOfTime(tv) ? fmt.clock(tv) : null; }
  function airport(a) {
    if (a.name && a.code) return a.name + " (" + a.code + ")";
    return a.name || a.code || "?";
  }
  function join(parts, sep) { return parts.filter(function (p) { return p; }).join(sep || " "); }
  function add(key, entry, sortKey) {
    entry.sort = sortKey !== undefined ? sortKey : (entry.time || "99");
    dayOf(key).entries.push(entry);
    return entry;
  }
  function laterDay(a, b) {
    var ka = keyOfTime(a);
    var kb = keyOfTime(b);
    return ka && kb && ka !== kb ? "(" + fmt.day(kb) + ")" : null;
  }
  function nightsBetween(a, b) {
    var t0 = Date.parse(a + "T00:00:00Z");
    var t1 = Date.parse(b + "T00:00:00Z");
    var out = [];
    for (var t = t0; t < t1 && out.length < 400; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
    return out;
  }

  function entriesOf(item) {
    var made = [];
    switch (item.kind) {
      case "flight":
        made.push(add(keyOfTime(item.departure || item.arrival), {
          kind: "flight", label: T.kind.flight, time: hm(item.departure), zone: zone(item.departure),
          title: join([item.airline, item.flightNumber]) || T.kind.flight,
          lines: [
            vague(item.departure || item.arrival),
            airport(item.from) + " → " + airport(item.to),
            item.arrival ? join([T.arr, at(item.arrival), laterDay(item.departure, item.arrival)]) : null,
            item.terminal || item.gate
              ? join([item.terminal && T.terminal + " " + item.terminal, item.gate && T.gate + " " + item.gate], ", ")
              : null,
            item.phase === "inFlight" || item.phase === "landed" ? T[item.phase] : null
          ]
        }));
        break;
      case "stay": {
        var place = join([item.address, item.city, item.country], ", ") || null;
        var inKey = keyOfDay(item.checkIn);
        var outKey = keyOfDay(item.checkOut);
        if (!inKey) {
          made.push(add(null, {
            kind: "stay", label: T.kind.stay, time: null, zone: null, title: item.name,
            lines: [place, join([T.checkIn, dayText(item.checkIn)]), join([T.checkOut, dayText(item.checkOut)])]
          }));
          break;
        }
        var nights = outKey ? nightsBetween(inKey, outKey) : [];
        var sameDay = outKey === inKey;
        made.push(add(inKey, {
          kind: "stay", label: T.checkIn, time: hm(item.checkInAt), zone: zone(item.checkInAt), title: item.name,
          lines: [
            place,
            outKey && !sameDay
              ? join([T.until, fmt.day(outKey), "(" + nights.length + " " + (nights.length === 1 ? T.night : T.nights) + ")"])
              : null,
            sameDay ? join([T.checkOut, item.checkOutAt ? at(item.checkOutAt) : null]) : null
          ]
        }));
        nights.forEach(function (k) { dayOf(k).nights.push(item.name); });
        if (outKey && outKey !== inKey) {
          made.push(add(outKey, {
            kind: "stay", label: T.checkOut, time: hm(item.checkOutAt), zone: zone(item.checkOutAt), title: item.name, lines: []
          }, hm(item.checkOutAt) || "00"));
        }
        break;
      }
      case "cruise": {
        var head = add(keyOfDay(item.start), {
          kind: "cruise", label: T.kind.cruise, time: null, zone: null, title: item.ship || item.cruiseLine || T.kind.cruise,
          lines: [
            keyOfDay(item.start) ? null : dayText(item.start),
            item.ship ? item.cruiseLine : null,
            item.end ? join([T.until, dayText(item.end)]) : null
          ]
        }, "98");
        made.push(head);
        item.ports.forEach(function (p) {
          var name = p.atSea ? T.atSea : (p.name || "?");
          var key = keyOfDay(p.day);
          if (!key) { head.lines.push(T.day + " " + p.dayNumber + ": " + name); return; }
          add(key, {
            kind: "cruise", label: p.atSea ? T.kind.cruise : T.port, time: hm(p.arrival), zone: zone(p.arrival), title: name,
            lines: [p.departure ? join([T.leaves, at(p.departure)]) : null]
          });
        });
        break;
      }
      case "rail":
      case "bus":
      case "ferry":
        made.push(add(keyOfTime(item.departure), {
          kind: item.kind, label: T.kind[item.kind], time: hm(item.departure), zone: zone(item.departure),
          title: join([item.operator, item.service]) || T.kind[item.kind],
          lines: [
            vague(item.departure),
            item.from + " → " + item.to,
            item.arrival ? join([T.arrives, at(item.arrival), laterDay(item.departure, item.arrival)]) : null
          ]
        }));
        break;
      case "rental": {
        var pickupKey = keyOfTime(item.pickup.at);
        var returnKey = keyOfTime(item.return.at);
        var pickup = add(pickupKey, {
          kind: "rental", label: T.pickup, time: hm(item.pickup.at), zone: zone(item.pickup.at), title: item.provider,
          lines: [vague(item.pickup.at), item.pickup.station]
        });
        made.push(pickup);
        if (pickupKey && returnKey === pickupKey) pickup.lines.push(join([T.dropoff, item.return.station, at(item.return.at)]));
        else {
          add(returnKey, {
            kind: "rental", label: T.dropoff, time: hm(item.return.at), zone: zone(item.return.at), title: item.provider,
            lines: [vague(item.return.at), item.return.station]
          });
        }
        break;
      }
      case "visit":
        made.push(add(keyOfTime(item.at), {
          kind: "visit", label: T.kind.visit, time: hm(item.at), zone: zone(item.at), title: item.name, lines: [vague(item.at), item.city]
        }));
        break;
      case "stop":
        made.push(add(keyOfTime(item.start), {
          kind: "stop", label: T.kind.stop, time: hm(item.start), zone: zone(item.start), title: item.name,
          lines: [vague(item.start), item.end ? join([T.until, at(item.end)]) : null]
        }));
        break;
      default:
        break;
    }
    return made;
  }

  var now = null;
  it.items.forEach(function (item, index) {
    var made = entriesOf(item);
    if (it.now && it.now.index === index && made.length) {
      var label = it.now.state === "inProgress" ? T.nowInProgress : T.nowNext;
      made[0].now = label;
      now = { label: label, entry: made[0], day: null };
    }
  });
  order.sort(function (a, b) { return a === "" ? 1 : b === "" ? -1 : a < b ? -1 : a > b ? 1 : 0; });
  var out = order.map(function (k) {
    var d = days[k];
    d.entries.forEach(function (e, i) { e.pos = i; });
    d.entries.sort(function (a, b) { return a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : a.pos - b.pos; });
    if (now && d.entries.indexOf(now.entry) >= 0) now.day = d.heading ? d.heading.text : null;
    d.entries = d.entries.map(function (e) {
      return { kind: e.kind, label: e.label, time: e.time, zone: e.zone, title: e.title,
        lines: e.lines.filter(function (l) { return l; }), now: e.now || null };
    });
    return d;
  });
  if (now) {
    var e = now.entry;
    now = { label: now.label, kind: e.label, title: e.title, time: e.time, zone: e.zone, day: now.day,
      lines: e.lines.filter(function (l) { return l; }) };
  }
  return { days: out, now: now };
}
`;

/** German first, English second — merged into the page's copy table `T`. */
export const SHARE_PAGE_ITINERARY_COPY = {
  de: {
    itinerary: "Reiseplan",
    nowInProgress: "Jetzt",
    nowNext: "Als Nächstes",
    nothingAhead: "Alle Einträge liegen in der Vergangenheit.",
    localTimes: "Alle Zeiten sind Ortszeiten des jeweiligen Orts.",
    undated: "Ohne Datum",
    nightAt: "Übernachtung",
    checkIn: "Check-in",
    checkOut: "Check-out",
    arr: "Ankunft",
    arrives: "An",
    leaves: "Ab",
    until: "bis",
    night: "Nacht",
    nights: "Nächte",
    terminal: "Terminal",
    gate: "Gate",
    pickup: "Mietwagen abholen",
    dropoff: "Mietwagen zurückgeben",
    port: "Hafen",
    day: "Tag",
    atSea: "Seetag",
    inFlight: "In der Luft",
    landed: "Gelandet",
    noEntries: "Noch keine Einträge.",
    kind: {
      flight: "Flug",
      stay: "Unterkunft",
      cruise: "Kreuzfahrt",
      rail: "Zug",
      bus: "Bus",
      ferry: "Fähre",
      rental: "Mietwagen",
      visit: "Besuch",
      stop: "Station",
    },
  },
  en: {
    itinerary: "Itinerary",
    nowInProgress: "Now",
    nowNext: "Next",
    nothingAhead: "Every entry lies in the past.",
    localTimes: "All times are local to each place.",
    undated: "No date",
    nightAt: "Night at",
    checkIn: "Check-in",
    checkOut: "Check-out",
    arr: "Arrival",
    arrives: "Arrives",
    leaves: "Departs",
    until: "until",
    night: "night",
    nights: "nights",
    terminal: "Terminal",
    gate: "Gate",
    pickup: "Rental pick-up",
    dropoff: "Rental return",
    port: "Port",
    day: "Day",
    atSea: "At sea",
    inFlight: "In the air",
    landed: "Landed",
    noEntries: "No entries yet.",
    kind: {
      flight: "Flight",
      stay: "Stay",
      cruise: "Cruise",
      rail: "Train",
      bus: "Bus",
      ferry: "Ferry",
      rental: "Rental car",
      visit: "Visit",
      stop: "Stop",
    },
  },
} as const;
