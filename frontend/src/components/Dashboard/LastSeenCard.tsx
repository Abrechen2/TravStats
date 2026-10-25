import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import { useLastSeen } from "../../hooks/useLastSeen";
import { useTodayZone } from "../../hooks/useTodayZone";
import { useTranslation } from "../../hooks/useTranslation";
import { useTravTrackVisible } from "../../hooks/useTravTrackVisible";
import type { TravTrackLastSeen } from "../../lib/api/travtrack";
import { localDay } from "../../shared/time";
import { relativeTimeFromNow } from "../inbox/relativeTime";
import { token } from "../ui/tokens";

/**
 * „Zuletzt gesehen" (TravTrack plan L2): how long ago the own history last
 * placed the account, and on which device — never the coordinates, which stay
 * on the owner's day map one click away. Shown only where TravTrack is
 * visible (`useTravTrackVisible`); the server's answer is already the last
 * real fix before any privacy zone.
 *
 * The card sits in the map's right column under „Als Nächstes"; the line is
 * the same sentence in the `/track` header.
 */

function useLastSeenText(visible: boolean) {
  const { t, i18n } = useTranslation(["track"]);
  const { state, nowMs } = useLastSeen(visible);
  const describe = (seen: TravTrackLastSeen) => ({
    age: relativeTimeFromNow(seen.at, i18n.language, new Date(nowMs), { style: "short" }),
    device: seen.deviceLabel ?? t("track:lastSeen.unknownDevice"),
  });
  return { t, state, describe };
}

export function LastSeenCard(): JSX.Element | null {
  const visible = useTravTrackVisible();
  const { t, state, describe } = useLastSeenText(visible);
  const zone = useTodayZone();
  const navigate = useNavigate();
  if (!visible || state.kind === "idle" || state.kind === "loading") return null;
  const seen = state.kind === "loaded" ? state.lastSeen : null;
  const text = seen ? describe(seen) : null;

  return (
    <div
      data-testid="last-seen-card"
      style={{
        width: 240,
        background: "var(--ts-surface)",
        border: "1px solid var(--ts-border)",
        borderRadius: "var(--ts-radius-card)",
        padding: "8px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        pointerEvents: "auto",
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}
      >
        <span className="t-label-mono" style={{ color: "var(--ts-muted)" }}>
          {t("track:lastSeen.label")}
        </span>
        {text && (
          <span
            style={{
              fontFamily: "var(--ts-font-mono)",
              fontSize: 11,
              color: "var(--ts-text-bright)",
              whiteSpace: "nowrap",
            }}
          >
            {text.age}
          </span>
        )}
      </div>
      {state.kind === "failed" && (
        <span role="alert" style={{ fontSize: 12, color: token("bad") }}>
          {t(state.key)}
        </span>
      )}
      {state.kind === "loaded" && !seen && (
        <span style={{ fontSize: 12, color: "var(--ts-muted)" }}>{t("track:lastSeen.none")}</span>
      )}
      {seen && text && (
        <button
          type="button"
          data-testid="last-seen-open"
          title={t("track:lastSeen.open")}
          onClick={() => navigate(`/track/${localDay(seen.at, zone)}`)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            background: "transparent",
            border: "none",
            padding: 0,
            color: "var(--ts-text-bright)",
            cursor: "pointer",
            fontSize: 13,
            textAlign: "left",
            overflow: "hidden",
          }}
        >
          <span aria-hidden style={{ opacity: 0.8, flexShrink: 0 }}>
            📍
          </span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {text.device}
          </span>
        </button>
      )}
    </div>
  );
}

/**
 * The `/track` header's line: the same sentence, one row. Mounted only inside
 * the page `useTravTrackAccess` already let through, so it asks no second time.
 */
export function LastSeenLine(): JSX.Element | null {
  const { t, state, describe } = useLastSeenText(true);
  if (state.kind === "idle" || state.kind === "loading") return null;
  if (state.kind === "failed") {
    return (
      <p
        className="t-caption"
        role="alert"
        data-testid="track-last-seen"
        style={{ color: token("bad") }}
      >
        {t(state.key)}
      </p>
    );
  }
  return (
    <p className="t-caption" data-testid="track-last-seen">
      {state.lastSeen
        ? t("track:lastSeen.line", describe(state.lastSeen))
        : t("track:lastSeen.none")}
    </p>
  );
}
