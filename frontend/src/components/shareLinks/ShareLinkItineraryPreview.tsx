import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat, type DisplayFormatter } from "../../lib/displayFormat";
import type { LocalDateValue, TimeValue } from "../../shared/time";
import type { ItineraryItem, ItineraryShareView } from "../../types/shareLinks";

const NS = "sharing:links.view.itinerary";

type T = (key: string, options?: Record<string, unknown>) => string;

/** A place's time with the zone it belongs to — a day-only value needs none. */
function when(format: DisplayFormatter, value: TimeValue | null): string | null {
  if (!value) return null;
  const shown = format.timeValue(value);
  if (value.precision !== "minute") return shown;
  return `${shown} (${value.zone ? `${value.zone} · UTC${value.offset}` : "UTC"})`;
}

const day = (format: DisplayFormatter, value: LocalDateValue | null): string | null =>
  value ? format.localDateValue(value) : null;

const join = (parts: Array<string | null | undefined>, sep = " · "): string =>
  parts.filter(Boolean).join(sep);

/** One entry as a title and the line of where and when beneath it. */
export function itineraryLine(
  item: ItineraryItem,
  format: DisplayFormatter,
  t: T
): { title: string; detail: string } {
  const kind = t(`${NS}.kind.${item.kind}`);
  switch (item.kind) {
    case "flight":
      return {
        title: join([kind, join([item.airline, item.flightNumber], " ")], " "),
        detail: join([
          `${item.from.code ?? "?"} → ${item.to.code ?? "?"}`,
          when(format, item.departure),
          when(format, item.arrival),
        ]),
      };
    case "stay":
      return {
        title: `${kind} ${item.name}`,
        detail: join([
          join([item.address, item.city, item.country], ", "),
          join(
            [
              when(format, item.checkInAt) ?? day(format, item.checkIn),
              when(format, item.checkOutAt) ?? day(format, item.checkOut),
            ],
            " – "
          ),
        ]),
      };
    case "cruise":
      return {
        title: join([kind, item.ship], " "),
        detail: join([
          join([day(format, item.start), day(format, item.end)], " – "),
          item.ports
            .map((p) =>
              p.atSea ? t(`${NS}.atSea`) : `${t(`${NS}.day`, { n: p.dayNumber })} ${p.name ?? "?"}`
            )
            .join(", "),
        ]),
      };
    case "rail":
    case "bus":
    case "ferry":
      return {
        title: join([kind, item.operator, item.service], " "),
        detail: join([
          `${item.from} → ${item.to}`,
          when(format, item.departure),
          when(format, item.arrival),
        ]),
      };
    case "rental":
      return {
        title: `${kind} ${item.provider}`,
        detail: join([
          join([item.pickup.station, when(format, item.pickup.at)], " "),
          join([item.return.station, when(format, item.return.at)], " "),
        ]),
      };
    case "visit":
      return { title: `${kind} ${item.name}`, detail: join([item.city, when(format, item.at)]) };
    case "stop":
      return {
        title: `${kind} ${item.name}`,
        detail: join([when(format, item.start), when(format, item.end)], " – "),
      };
  }
}

/**
 * The itinerary of a trip link as the owner previews it (forgejo#302): the
 * entries the page will list, each on its place's clock with its zone, and
 * the current one named in words — not by colour alone.
 */
export default function ShareLinkItineraryPreview({
  itinerary,
}: {
  itinerary: ItineraryShareView;
}): JSX.Element {
  const { t } = useTranslation(["sharing"]);
  const format = useDisplayFormat();
  return (
    <section aria-label={t(`${NS}.title`)} className="flex flex-col gap-1 text-sm">
      <h4 className="font-semibold">{t(`${NS}.title`)}</h4>
      {itinerary.items.length === 0 && <p className="t-caption">{t(`${NS}.empty`)}</p>}
      <ol className="flex flex-col gap-1" data-testid="share-itinerary">
        {itinerary.items.map((item, index) => {
          const { title, detail } = itineraryLine(item, format, t);
          const now = itinerary.now?.index === index ? itinerary.now.state : null;
          return (
            <li
              key={index}
              aria-current={now ? "step" : undefined}
              className="border-l-2 pl-2"
              style={{ borderColor: now ? "var(--ts-accent)" : "var(--ts-border)" }}
            >
              {now && <strong className="mr-1">{t(`${NS}.${now}`)}:</strong>}
              <span style={{ color: "var(--ts-text)" }}>{title}</span>
              {detail && (
                <span className="block" style={{ color: "var(--ts-muted)" }}>
                  {detail}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
