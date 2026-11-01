import { useCallback, useEffect, useRef, useState, type FormEvent, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import {
  PACKING_MAX_ITEMS,
  PACKING_MAX_LABEL,
  isPackingStale,
  newMutationId,
  packingApi,
  type PackingItem,
  type PackingList,
} from "../../lib/api/companionData";
import { logger } from "../../lib/logger";
import axios from "axios";
import { Card } from "../ui/Card";
import { todayIn } from "../../shared/time";
import { useTodayZone } from "../../hooks/useTodayZone";
import { isTripFinished } from "./tripFinished";

type Notice = "stale" | "staleReloadFailed" | "saveFailed" | null;

/**
 * The trip's packing list (`TripPackingList`, forgejo#398) — the list the
 * Companion edits offline and sends whole. Not TravPlan's `state.packing`:
 * the two lists are separate stores until the owner decides otherwise (H13).
 *
 * Every change is a whole-list PUT naming the `rev` it started from. A 409
 * means another device wrote first: the list is read again and the user is
 * told, instead of the app's edit being overwritten unseen. Nothing is shown
 * as saved before the server answered.
 */
export default function TripPackingCard({
  tripId,
  endDate = null,
}: {
  tripId: string;
  /** The trip's last day: once it is past (profile zone) nothing is left to pack, so the card is a read-only record. */
  endDate?: string | null;
}): JSX.Element | null {
  const { t } = useTranslation(["trips"]);
  const [list, setList] = useState<PackingList | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const finished = isTripFinished(endDate, todayIn(useTodayZone()));
  // A write whose answer never arrived may have been applied. Its retry reuses
  // the mutation id, so the server answers "already applied" instead of 409.
  const unanswered = useRef<{
    items: PackingItem[];
    baseRev: number;
    mutationId: string;
    fromDraft: boolean;
  } | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoadFailed(false);
    try {
      setList(await packingApi.get(tripId));
    } catch (error) {
      logger.warn("Failed to load packing list", error);
      setLoadFailed(true);
    }
  }, [tripId]);

  useEffect(() => {
    setList(null);
    setNotice(null);
    setDraft("");
    unanswered.current = null;
    void load();
  }, [load]);

  /** Sends the whole list; true when the server took it. */
  const send = async (
    items: PackingItem[],
    fromDraft = false,
    resend = false
  ): Promise<boolean> => {
    if (!list || busy) return false;
    const write =
      resend && unanswered.current
        ? unanswered.current
        : { items, baseRev: list.rev, mutationId: newMutationId(), fromDraft };
    setBusy(true);
    try {
      setList(await packingApi.put(tripId, write.items, write.baseRev, write.mutationId));
      unanswered.current = null;
      setNotice(null);
      if (write.fromDraft) setDraft("");
      return true;
    } catch (error) {
      const answered = axios.isAxiosError(error) && error.response !== undefined;
      unanswered.current = answered ? null : write;
      if (isPackingStale(error)) {
        try {
          setList(await packingApi.get(tripId));
          setNotice("stale");
        } catch (reloadError) {
          logger.warn("Failed to reload stale packing list", reloadError);
          setNotice("staleReloadFailed");
        }
      } else {
        logger.warn("Failed to save packing list", error);
        setNotice("saveFailed");
      }
      return false;
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string): Promise<boolean> =>
    send((list?.items ?? []).map((i) => (i.id === id ? { ...i, done: !i.done } : i)));
  const remove = (id: string): Promise<boolean> =>
    send((list?.items ?? []).filter((i) => i.id !== id));
  const add = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    const label = draft.trim();
    if (!label || !list) return;
    const item: PackingItem = { id: newMutationId(), label, done: false };
    await send([...list.items, item], true);
  };

  const items = list?.items ?? [];
  const full = items.length >= PACKING_MAX_ITEMS;
  const doneCount = items.filter((i) => i.done).length;

  if (finished && !loadFailed) {
    // An empty list on a finished trip is noise, and so is the card while we
    // do not yet know whether it is empty.
    if (!list || items.length === 0) return null;
    return (
      <Card style={{ margin: "var(--ts-space-xl) 0" }} data-testid="trip-packing-card">
        <section className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
          <button
            type="button"
            className="t-card-title text-left"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {t("trips:packing.summary", { count: items.length })}
          </button>
          {open && (
            <ul className="flex flex-col" style={{ gap: 4 }}>
              {items.map((item) => (
                <li
                  key={item.id}
                  className="break-words"
                  style={{ textDecoration: item.done ? "line-through" : undefined }}
                >
                  {item.label}
                </li>
              ))}
            </ul>
          )}
        </section>
      </Card>
    );
  }

  return (
    <Card style={{ margin: "var(--ts-space-xl) 0" }} data-testid="trip-packing-card">
      <section className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
        <div className="flex flex-wrap items-baseline" style={{ gap: "var(--ts-space-sm)" }}>
          <h2 className="t-card-title">{t("trips:packing.title")}</h2>
          {list && items.length > 0 && (
            <span className="t-caption">
              {t("trips:packing.progress", { done: doneCount, total: items.length })}
            </span>
          )}
        </div>
        {loadFailed && (
          <p role="alert" className="t-caption flex flex-wrap items-center" style={{ gap: 8 }}>
            {t("trips:packing.loadFailed")}
            <button type="button" className="btn-secondary" onClick={() => void load()}>
              {t("trips:packing.retry")}
            </button>
          </p>
        )}
        {notice && (
          <p role="alert" className="t-caption" style={{ color: "var(--danger)" }}>
            {t(`trips:packing.notice.${notice}`)}
            {notice === "saveFailed" && unanswered.current && (
              <button
                type="button"
                className="btn-secondary"
                style={{ marginLeft: 8 }}
                disabled={busy}
                onClick={() => void send([], false, true)}
              >
                {t("trips:packing.retry")}
              </button>
            )}
          </p>
        )}
        {list && (
          <>
            {items.length === 0 ? (
              <p className="t-caption">{t("trips:packing.empty")}</p>
            ) : (
              <ul className="flex flex-col" style={{ gap: 4 }}>
                {items.map((item) => (
                  <li key={item.id} className="flex items-center" style={{ gap: 8 }}>
                    <label
                      className="flex min-w-0 flex-1 items-center"
                      style={{ gap: 8, minHeight: "var(--ts-size-touch-min)" }}
                    >
                      <input
                        type="checkbox"
                        checked={item.done}
                        disabled={busy}
                        onChange={() => void toggle(item.id)}
                      />
                      <span
                        className="min-w-0 break-words"
                        style={{ textDecoration: item.done ? "line-through" : undefined }}
                      >
                        {item.label}
                      </span>
                    </label>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={busy}
                      aria-label={t("trips:packing.remove", { label: item.label })}
                      onClick={() => void remove(item.id)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={(e) => void add(e)} className="flex flex-wrap" style={{ gap: 8 }}>
              <input
                className="input"
                style={{ flex: "1 1 200px", minHeight: "var(--ts-size-touch-min)" }}
                value={draft}
                maxLength={PACKING_MAX_LABEL}
                disabled={busy || full}
                aria-label={t("trips:packing.addLabel")}
                placeholder={t("trips:packing.addPlaceholder")}
                onChange={(e) => setDraft(e.target.value)}
              />
              <button
                type="submit"
                className="btn-secondary"
                disabled={busy || full || draft.trim() === ""}
              >
                {t("trips:packing.add")}
              </button>
            </form>
            {full && (
              <p className="t-caption">{t("trips:packing.full", { max: PACKING_MAX_ITEMS })}</p>
            )}
          </>
        )}
      </section>
    </Card>
  );
}
