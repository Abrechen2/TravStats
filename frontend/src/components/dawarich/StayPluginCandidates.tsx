import { useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import Button from "../ui/Button";
import { suggestionPluginsApi } from "../../lib/api/suggestionPlugins";
import type { StayPluginEvidence } from "../../lib/api/dawarichStays";

/**
 * The plugins' candidates for this stop (spec 2026-11-23-plugins-and-calendar.md,
 * "Where suggestions land"): each names its plugin as the source, and the user
 * may take one over into the form. A plugin's link is a plain link — opened by
 * the user's browser with no referrer, never fetched by TravStats.
 */
export default function StayPluginCandidates({
  stayId,
  plugins,
  pending,
  picked,
  onPick,
}: {
  stayId: string;
  plugins: StayPluginEvidence[];
  pending: boolean;
  picked: string | null;
  onPick: ((p: StayPluginEvidence) => void) | undefined;
}): JSX.Element {
  const { t } = useTranslation(["suggestionSources"]);
  const [state, setState] = useState<{ ok: boolean; key: string } | null>(null);
  const sorted = [...plugins].sort((a, b) => b.confidence - a.confidence);
  return (
    <div
      className="flex flex-col"
      style={{ gap: "var(--ts-space-xs)" }}
      data-testid="stay-plugin-candidates"
    >
      {sorted.length > 0 && (
        <p className="t-caption">{t("suggestionSources:inbox.plugins.title")}</p>
      )}
      {sorted.map((p) => {
        const key = `${p.pluginId}:${p.externalRef ?? p.name}`;
        return (
          <div
            key={key}
            className="t-caption"
            style={{ opacity: picked && picked !== key ? 0.7 : 1 }}
          >
            <p className="t-body">
              {p.name}
              {p.address ? ` · ${p.address}` : ""}
            </p>
            <p>
              {t("suggestionSources:inbox.plugins.source", { name: p.pluginName })} ·{" "}
              {t("suggestionSources:inbox.plugins.confidence", {
                percent: Math.round(p.confidence * 100),
              })}
              {p.reason === "name" && p.matchedToken
                ? ` · ${t("suggestionSources:inbox.plugins.nameMatch", {
                    token: p.matchedToken,
                    meters: p.distanceM ?? "—",
                  })}`
                : p.distanceM !== null && p.distanceM !== undefined
                  ? ` · ${t("suggestionSources:inbox.plugins.distance", { meters: p.distanceM })}`
                  : ""}
            </p>
            {p.note && <p>{p.note}</p>}
            <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
              {onPick && (
                <Button onClick={() => onPick(p)} disabled={picked === key}>
                  {t("suggestionSources:inbox.plugins.pick")}
                </Button>
              )}
              {p.url?.startsWith("https://") && (
                <a className="underline" href={p.url} target="_blank" rel="noopener noreferrer">
                  {t("suggestionSources:inbox.plugins.link")}
                </a>
              )}
            </div>
          </div>
        );
      })}
      {pending && <p className="t-caption">{t("suggestionSources:inbox.plugins.pending")}</p>}
      <div>
        <Button
          onClick={() =>
            suggestionPluginsApi
              .reask(stayId)
              .then(() => setState({ ok: true, key: "reasked" }))
              .catch((e: unknown) => {
                console.warn("plugins could not be asked again", e);
                setState({ ok: false, key: "reaskError" });
              })
          }
        >
          {t("suggestionSources:inbox.plugins.reask")}
        </Button>
      </div>
      {state && (
        <p className="t-caption" role={state.ok ? "status" : "alert"}>
          {t(`suggestionSources:inbox.plugins.${state.key}`)}
        </p>
      )}
    </div>
  );
}
