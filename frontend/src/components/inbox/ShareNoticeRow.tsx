import type { JSX } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "../../hooks/useTranslation";
import type { ShareNotice } from "../../types/sharing";
import { formatShareValue, shareFieldLabel } from "../sharing/noticeValues";
import Button from "../ui/Button";

const NS = "sharing:inbox.notices";

/**
 * One notice about a shared trip (design 2026-10-09, decision 3): who did
 * what to which entry, every changed fact with its old and new value, and
 * what the reader can do about it — undo a change on their own copy, or after
 * a delete, delete their own copy too. A refused action is shown on the row
 * as itself (`error`), not only as a passing toast.
 */
export default function ShareNoticeRow({
  notice,
  busy,
  error,
  onRead,
  onUndo,
  onDeleteCopy,
}: {
  notice: ShareNotice;
  busy: boolean;
  /** The sentence of the last failed action on this notice. */
  error: string | null;
  onRead: () => void;
  onUndo: () => void;
  onDeleteCopy: () => void;
}): JSX.Element {
  const { t, i18n } = useTranslation(["sharing"]);
  const locale = i18n.language?.startsWith("en") ? "en-GB" : "de-DE";
  const after = notice.after ?? {};
  const kindKey =
    notice.kind === "deleted" && after.reason === "movedOut" ? "movedOut" : notice.kind;
  const text = t(`${NS}.${kindKey}`, {
    name: notice.actor?.displayName ?? t(`${NS}.someone`),
    trip: after.tripName ?? t(`${NS}.unknownTrip`),
    entry: after.label || t(`${NS}.unknownEntry`),
    type: t(`sharing:entityTypes.${notice.entityType ?? "trip"}`),
  });
  const unread = notice.readAt === null;
  const tripLink = notice.entityType === "trip" ? notice.entityKey : (after.tripId ?? null);
  const canUndo = notice.kind === "updated" && notice.undoneAt === null;

  return (
    <div
      data-testid="share-notice"
      className="flex flex-col gap-2 rounded-lg p-4"
      style={{
        border: "1px solid var(--ts-border)",
        background: unread ? "var(--ts-tile)" : "transparent",
      }}
    >
      <p className="text-sm" style={{ fontWeight: unread ? 600 : 400 }}>
        {text}
      </p>
      {notice.changes.length > 0 && (
        <dl className="grid gap-x-3 gap-y-1 text-sm" style={{ gridTemplateColumns: "auto 1fr" }}>
          {notice.changes.map((change) => (
            <div key={change.field} className="contents" data-testid="share-change">
              <dt className="t-caption">{shareFieldLabel(change.field, t)}</dt>
              <dd>
                <span style={{ textDecoration: "line-through", opacity: 0.7 }}>
                  {formatShareValue(change.before, locale, t)}
                </span>
                {" → "}
                <span>{formatShareValue(change.after, locale, t)}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {notice.undoneAt && <p className="t-caption">{t(`${NS}.undone`)}</p>}
      {error && (
        <p role="alert" className="text-sm" style={{ color: "var(--ts-warn)" }}>
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {tripLink && (
          <Link to={`/trips/${tripLink}`} className="text-sm">
            {t(`${NS}.open`)}
          </Link>
        )}
        {canUndo && (
          <Button disabled={busy} onClick={onUndo}>
            {t(`${NS}.undo`)}
          </Button>
        )}
        {notice.kind === "deleted" && (
          <Button disabled={busy} onClick={onDeleteCopy}>
            {t(`${NS}.deleteCopy`)}
          </Button>
        )}
        {unread && (
          <Button disabled={busy} onClick={onRead}>
            {t(`${NS}.markRead`)}
          </Button>
        )}
      </div>
    </div>
  );
}
