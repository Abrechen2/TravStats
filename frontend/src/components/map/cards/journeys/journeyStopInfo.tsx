// A station's photo and opening sentences from Wikipedia, on its map card
// (owner, 2026-10-21). Only where the instance allows open data; found by the
// server by place and confirmed by name, so a card without it means "no
// article is confidently this station". A lookup that failed says so — it
// used to be the same silence as "no article".

import { useEffect, useState, type JSX } from "react";
import { getStopInfo, type StopDomain, type StopInfo } from "../../../../lib/api/mapDetails";
import { wikiLanguage } from "../../../../lib/api/openData";
import { useSettingsStore } from "../../../../store/settingsStore";
import { tokens } from "../../../../theme/tokens";
import type { TFn } from "../cardChrome";
import type { JourneyDomain, JourneyEnd } from "./journeyTypes";

const STOP_DOMAINS: readonly JourneyDomain[] = ["rail", "bus", "ferry", "rental"];

export function StopWikipedia({
  domain,
  stop,
  locale,
  t,
}: {
  domain: JourneyDomain;
  stop: JourneyEnd;
  locale: string;
  t: TFn;
}): JSX.Element | null {
  const enabled = useSettingsStore((s) => s.openDataEnabled) === true;
  const [info, setInfo] = useState<StopInfo | null>(null);
  const asks = enabled && STOP_DOMAINS.includes(domain);
  const lang = wikiLanguage(locale);
  const { name, lat, lon } = stop;

  useEffect(() => {
    setInfo(null);
    if (!asks) return;
    let cancelled = false;
    void getStopInfo(domain as StopDomain, { name, lat, lon }, lang).then((next) => {
      if (!cancelled) setInfo(next);
    });
    return () => {
      cancelled = true;
    };
  }, [asks, domain, name, lat, lon, lang]);

  if (!asks || info === null) return null;
  if (info.state === "unavailable") {
    return (
      <p role="status" className="mb-2 text-[10.5px]" style={{ color: tokens.color.faint }}>
        {t("map:journey.wikiUnavailable")}
      </p>
    );
  }
  if (info.state !== "found") return null;
  const s = info.summary;
  // A photo is shown only with its author and licence (beta.23 UAT before 2.7.0-rc.20).
  const credit = s.thumbnailUrl ? s.imageCredit : null;
  const linkClass =
    "block text-[9.5px] underline-offset-2 hover:underline pointer-coarse:min-h-(--ts-size-touch-min) pointer-coarse:leading-[44px]";
  return (
    <div data-testid="stop-wikipedia" className="mb-2.5">
      <div className="flex items-start gap-2.5">
        {s.thumbnailUrl && credit && (
          <img
            src={s.thumbnailUrl}
            alt={s.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-16 w-16 flex-none rounded-sm object-cover"
            onError={(e) => e.currentTarget.remove()}
          />
        )}
        <p className="line-clamp-4 text-[11px] leading-snug" style={{ color: tokens.color.text }}>
          {s.extract}
        </p>
      </div>
      {credit && (
        <a
          href={credit.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`mt-1 ${linkClass}`}
          style={{ color: tokens.color.faint }}
        >
          {`${t("map:journey.picture")}: ${[
            credit.licence,
            credit.artist,
            credit.onCommons ? "Wikimedia Commons" : "Wikipedia",
          ]
            .filter(Boolean)
            .join(" · ")}`}
        </a>
      )}
      <a
        href={s.pageUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`${credit ? "" : "mt-1 "}${linkClass}`}
        style={{ color: tokens.color.faint }}
      >
        {t("openData:wikipedia.license")}
        {s.lang !== lang ? ` · ${t("openData:wikipedia.englishArticle")}` : ""}
      </a>
    </div>
  );
}
