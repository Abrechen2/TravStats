/**
 * The itinerary block of the public share page (forgejo#302) — plain ES5 run
 * in the visitor's browser, like the rest of `sharePageAssets.ts`. Its own
 * constant so `sharePage.test.ts` can run it.
 *
 * `itineraryEntries` turns the payload into lines of text; the page script
 * only puts those lines into the DOM through `textContent`. Every time is
 * shown on the clock of its place (`clock` reads `TimeValue.local`, never the
 * visitor's zone) with the zone it belongs to written out beside it, and the
 * entry in progress — or the next one — is named in words, not by colour
 * alone.
 */
export const SHARE_PAGE_ITINERARY_JS = `function itineraryEntries(it, fmt, T) {
  function zone(tv) {
    if (!tv || tv.precision !== "minute") return "";
    return " (" + (tv.zone ? tv.zone.replace(/_/g, " ") + ", UTC" + tv.offset : "UTC") + ")";
  }
  function when(tv) { return tv ? fmt.clock(tv) + zone(tv) : null; }
  function day(d) { return d ? fmt.day(d.date, d.precision) : null; }
  function span(a, b) { return [a, b].filter(Boolean).join(" – "); }
  function code(a) { return a.code || a.name || "?"; }
  function entry(item) {
    switch (item.kind) {
      case "flight":
        return {
          title: T.kind.flight + " " + ([item.airline, item.flightNumber].filter(Boolean).join(" ") || ""),
          lines: [
            code(item.from) + " → " + code(item.to) + (item.from.name && item.to.name ? " (" + item.from.name + " → " + item.to.name + ")" : ""),
            [T.dep, when(item.departure)].join(" "),
            item.arrival ? [T.arr, when(item.arrival)].join(" ") : null,
            item.phase !== "unknown" ? T[item.phase] : null
          ]
        };
      case "stay":
        return {
          title: T.kind.stay + " " + item.name,
          lines: [
            [item.address, item.city, item.country].filter(Boolean).join(", ") || null,
            [T.checkIn, when(item.checkInAt) || day(item.checkIn)].join(" "),
            [T.checkOut, when(item.checkOutAt) || day(item.checkOut)].join(" ")
          ]
        };
      case "cruise":
        return {
          title: T.kind.cruise + " " + ([item.ship, item.cruiseLine].filter(Boolean).join(" · ")),
          lines: [span(day(item.start), day(item.end))].concat(item.ports.map(function (p) {
            var at = [p.arrival && when(p.arrival), p.departure && when(p.departure)].filter(Boolean).join(" – ");
            return T.day + " " + p.dayNumber + (p.day ? " (" + day(p.day) + ")" : "") + ": " +
              (p.atSea ? T.atSea : (p.name || "?")) + (at ? " · " + at : "");
          }))
        };
      case "rail":
      case "bus":
      case "ferry":
        return {
          title: T.kind[item.kind] + " " + [item.operator, item.service].filter(Boolean).join(" "),
          lines: [
            item.from + " → " + item.to,
            [T.leaves, when(item.departure)].join(" "),
            item.arrival ? [T.arrives, when(item.arrival)].join(" ") : null
          ]
        };
      case "rental":
        return {
          title: T.kind.rental + " " + item.provider,
          lines: [
            [T.pickup, item.pickup.station, when(item.pickup.at)].filter(Boolean).join(" "),
            [T.dropoff, item.return.station, when(item.return.at)].filter(Boolean).join(" ")
          ]
        };
      case "visit":
        return { title: T.kind.visit + " " + item.name, lines: [item.city, when(item.at)] };
      case "stop":
        return { title: T.kind.stop + " " + item.name, lines: [span(when(item.start), when(item.end))] };
      default:
        return null;
    }
  }
  var out = [];
  it.items.forEach(function (item, index) {
    var e = entry(item);
    if (!e) return;
    var mark = it.now && it.now.index === index ? (it.now.state === "inProgress" ? T.nowInProgress : T.nowNext) : null;
    out.push({ title: e.title.trim(), lines: e.lines.filter(function (l) { return l; }), now: mark });
  });
  return out;
}
`;

/** German first, English second — merged into the page's copy table `T`. */
export const SHARE_PAGE_ITINERARY_COPY = {
  de: {
    itinerary: "Reiseplan",
    nowInProgress: "Jetzt",
    nowNext: "Als Nächstes",
    checkIn: "Check-in",
    checkOut: "Check-out",
    leaves: "Ab",
    arrives: "An",
    pickup: "Abholung",
    dropoff: "Rückgabe",
    day: "Tag",
    atSea: "Seetag",
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
    checkIn: "Check-in",
    checkOut: "Check-out",
    leaves: "Departs",
    arrives: "Arrives",
    pickup: "Pick-up",
    dropoff: "Return",
    day: "Day",
    atSea: "At sea",
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
