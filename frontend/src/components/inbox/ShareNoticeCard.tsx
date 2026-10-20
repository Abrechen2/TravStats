import { useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "../../hooks/useTranslation";
import { formatDateTime } from "../../lib/displayFormat";
import { dateLocaleForLanguage } from "../../lib/units";
import type { ShareNotice } from "../../types/sharing";
import ChangeDiffView, { type ChangeEntry } from "../ChangeDiffView";
import { formatShareValue, shareFieldLabel } from "../sharing/noticeValues";
import { Button, Card, Pill } from "../ui";

const NS = "sharing:inbox.notices";
const INLINE = 3;
const KIND_COLOR: Record<ShareNotice["kind"], string> = {
  shared: "var(--ts-info)",
  created: "var(--ts-good)",
  updated: "var(--ts-info)",
  deleted: "var(--ts-warn)",
  left: "var(--ts-muted)",
};

/**
 * One notice about a shared trip (owner decision 3, 2026-10-09: changes are
 * applied at once and the others are told, with undo). Since the rework
 * (spec 2026-10-16, D12) it wears the pending-update card's anatomy — kind
 * pill, actor and time, the entry, three changes inline and the rest behind
 * Details — and undo is the primary action while it is still possible. Values
 * arrive formatted on the place's clock and are shown as given.
 */
export default function ShareNoticeCard({
  notice,
  busy,
  error,
  onRead,
  onUndo,
  onDeleteCopy,
}: {
  notice: ShareNotice;
  busy: boolean;
  error: string | null;
  onRead: () => void;
  onUndo: () => void;
  onDeleteCopy: () => void;
}): JSX.Element {
  const { t, i18n } = useTranslation(["sharing"]);
  const [details, setDetails] = useState(false);
  const locale = dateLocaleForLanguage(i18n.language);
  const after = notice.after ?? {};
  const textKey =
    notice.kind === "deleted" && after.reason === "movedOut"
      ? "movedOut"
      : notice.kind === "created" && after.movedFrom
        ? after.via === "share"
          ? "joinedMovedOnShare"
          : "joinedMoved"
        : notice.kind === "created" && after.joined
          ? "joined"
          : notice.kind;
  const text = t(`${NS}.${textKey}`, {
    name: notice.actor?.displayName ?? t(`${NS}.someone`),
    trip: after.tripName ?? t(`${NS}.unknownTrip`),
    entry: after.label || t(`${NS}.unknownEntry`),
    type: t(`sharing:entityTypes.${notice.entityType ?? "trip"}`),
    from: after.movedFrom?.tripName ?? t(`${NS}.unknownTrip`),
  });
  const unread = notice.readAt === null;
  const tripLink = notice.entityType === "trip" ? notice.entityKey : (after.tripId ?? null);
  // A join that moved the reader's own entry in can be undone too: it goes back.
  const movedIn = notice.kind === "created" && !!after.movedFrom;
  const canUndo = (notice.kind === "updated" || movedIn) && notice.undoneAt === null;
  const changes: ChangeEntry[] = notice.changes.map((c) => ({
    field: c.field,
    type: "changed",
    oldValue: formatShareValue(c.before, locale, t),
    newValue: formatShareValue(c.after, locale, t),
  }));

  return (
    <Card
      data-testid="share-notice"
      style={unread ? { borderColor: "var(--ts-accent)" } : undefined}
    >
      <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
        <div className="flex flex-wrap items-center justify-between" style={{ gap: 8 }}>
          <div className="flex items-center" style={{ gap: 8 }}>
            <Pill color={KIND_COLOR[notice.kind]}>{t(`${NS}.kinds.${notice.kind}`)}</Pill>
            <span className="t-caption">
              {notice.actor?.displayName ?? t(`${NS}.someone`)} · {formatDateTime(notice.createdAt)}
            </span>
          </div>
          {notice.undoneAt && (
            <span className="t-caption">
              {t(`${NS}.${notice.kind === "deleted" ? "copyGone" : "undone"}`)}
            </span>
          )}
        </div>
        {after.label && (
          <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--ts-text-bright)" }}>
            {after.label}
          </h3>
        )}
        <p className="text-sm" style={{ fontWeight: unread ? 600 : 400 }}>
          {text}
        </p>
        {changes.length > 0 && (
          <ul className="flex flex-col text-sm" style={{ gap: 4 }}>
            {changes.slice(0, INLINE).map((c) => (
              <li key={c.field} data-testid="share-change">
                <span className="t-caption">{shareFieldLabel(c.field, t)}: </span>
                <span style={{ textDecoration: "line-through", opacity: 0.7 }}>{c.oldValue}</span>
                {" → "}
                <span>{c.newValue}</span>
              </li>
            ))}
          </ul>
        )}
        {details && (
          <ChangeDiffView
            original={{}}
            proposed={{}}
            changes={changes.slice(INLINE)}
            formatValue={(v) => String(v ?? "—")}
            fieldLabel={(f) => shareFieldLabel(f, t)}
          />
        )}
        {error && (
          <p role="alert" className="text-sm" style={{ color: "var(--ts-warn)" }}>
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center" style={{ gap: 8 }}>
          {canUndo && (
            <Button variant="primary" disabled={busy} onClick={onUndo}>
              {movedIn ? t(`${NS}.undoMove`, { from: after.movedFrom?.tripName }) : t(`${NS}.undo`)}
            </Button>
          )}
          {notice.kind === "deleted" && notice.undoneAt === null && (
            <Button variant="danger" disabled={busy} onClick={onDeleteCopy}>
              {t(`${NS}.deleteCopy`)}
            </Button>
          )}
          {changes.length > INLINE && (
            <Button aria-expanded={details} onClick={() => setDetails((d) => !d)}>
              {t(`${NS}.details`)}
            </Button>
          )}
          {unread && (
            <Button disabled={busy} onClick={onRead}>
              {t(`${NS}.markRead`)}
            </Button>
          )}
          {tripLink && (
            <Link to={`/trips/${tripLink}`} className="text-sm">
              {t(`${NS}.open`)}
            </Link>
          )}
        </div>
      </div>
    </Card>
  );
}
