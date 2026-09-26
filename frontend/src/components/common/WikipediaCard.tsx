import { useEffect, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { openDataApi, wikiLanguage, type WikipediaSummary } from "../../lib/api/openData";
import { logger } from "../../lib/logger";
import { useSettingsStore } from "../../store/settingsStore";

/**
 * "From Wikipedia": the opening of the article about a place or a house, with
 * its picture and a link to the rest (2026-09-24).
 *
 * Only where the instance allows open data, and only where the server knows
 * the thing's Wikidata item — it never searches by name, so a card that does
 * not appear means "no item", not "not found yet". The text is CC BY-SA and
 * says so under it.
 */
export default function WikipediaCard({
  kind,
  id,
}: {
  kind: "place" | "lodging";
  id: string;
}): JSX.Element | null {
  const { t, i18n } = useTranslation(["openData"]);
  const enabled = useSettingsStore((s) => s.openDataEnabled) === true;
  const lang = wikiLanguage(i18n.language);
  const [summary, setSummary] = useState<WikipediaSummary | null>(null);
  // The lookup failed (Wikipedia/Wikidata down, or our own request). Said on
  // the card: it used to simply not appear, which reads as "no article".
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = kind === "place" ? openDataApi.placeWikipedia : openDataApi.lodgingWikipedia;
    setFailed(false);
    load(id, lang)
      .then((s) => !cancelled && setSummary(s))
      .catch((err: unknown) => {
        logger.warn("Loading the Wikipedia summary failed", err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, kind, id, lang]);

  if (!enabled) return null;
  if (failed) {
    return (
      <section
        className="rounded-lg border border-(--color-border) p-3"
        aria-label={t("openData:wikipedia.title")}
      >
        <p className="t-label-mono mb-2 text-(--text-muted)">{t("openData:wikipedia.title")}</p>
        <p role="status" className="text-sm text-(--text-muted)">
          {t("openData:wikipedia.unavailable")}
        </p>
      </section>
    );
  }
  if (!summary) return null;
  return (
    <section
      className="rounded-lg border border-(--color-border) p-3"
      aria-label={t("openData:wikipedia.title")}
    >
      <p className="t-label-mono mb-2 text-(--text-muted)">{t("openData:wikipedia.title")}</p>
      <div className="flex gap-3">
        {summary.thumbnailUrl && (
          <img
            src={summary.thumbnailUrl}
            alt={summary.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-20 w-20 flex-none rounded-md object-cover"
          />
        )}
        <div className="min-w-0">
          <p className="font-semibold">{summary.title}</p>
          <p className="line-clamp-5 text-sm">{summary.extract}</p>
          <p className="t-caption mt-1">
            <a
              href={summary.pageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              {t("openData:wikipedia.readMore")}
            </a>
            {summary.lang !== lang && ` · ${t("openData:wikipedia.englishArticle")}`}
          </p>
        </div>
      </div>
      <p className="t-caption mt-2 text-(--text-muted)">{t("openData:wikipedia.license")}</p>
    </section>
  );
}
