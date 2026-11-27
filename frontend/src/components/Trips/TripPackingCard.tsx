import { Icon } from "../ui/Icon";
import { useCallback, useEffect, useRef, useState, type FormEvent, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import {
  PACKING_MAX_ITEMS,
  PACKING_MAX_LABEL,
  PACKING_MAX_CATEGORY,
  PACKING_MAX_QUANTITY,
  newMutationId,
  newPackingItem,
  isPackingStale,
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
import InlineError from "../ui/InlineError";

type Notice = "stale" | "staleReloadFailed" | "saveFailed" | null;

/**
 * The trip's packing list (`TripPackingList`, forgejo#398) — the one store the
 * Companion and TravPlan share, read and written in the rich shape. The server
 * hands this card the owner's projection: shared items plus the owner's own
 * personal ones, never a co-planner's.
 *
 * Every change is a whole-list PUT naming the `rev` it started from. A 409
 * means another device wrote first: the list is read again and the user is
 * told, instead of the app's edit being overwritten unseen. Nothing is shown
 * as saved before the server answered.
 */
export default function TripPackingCard({
  tripId,
  endDate = null,
  completed = false,
}: {
  tripId: string;
  /** The server already calls the trip completed. A trip whose dates come only from its entries has no `endDate`, and its editable list stood above the tabs of a finished trip (owner, 2026-11-20). */
  completed?: boolean;
  /** The trip's last day: once it is past (profile zone) nothing is left to pack, so the card is a read-only record. */
  endDate?: string | null;
}): JSX.Element | null {
  const { t } = useTranslation(["trips"]);
  const [list, setList] = useState<PackingList | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [draft, setDraft] = useState("");
  const [category, setCategory] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [scope, setScope] = useState<"personal" | "shared">("personal");
  const [open, setOpen] = useState(false);
  // The running trip's list starts as one line (owner, 2026-11-26: "ein bisschen
  // zu penetrant"); errors stay outside the fold so a collapsed card never hides one.
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const finished = isTripFinished(endDate, todayIn(useTodayZone())) || completed;
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
    setCategory("");
    setQuantity(1);
    setScope("personal");
    setExpanded(false);
    setAdding(false);
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
      if (write.fromDraft) {
        setDraft("");
        setCategory("");
        setQuantity(1);
      }
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
    const item = newPackingItem(label, {
      category: category.trim().slice(0, PACKING_MAX_CATEGORY),
      quantity: Math.min(PACKING_MAX_QUANTITY, Math.max(1, Math.trunc(quantity) || 1)),
      scope,
    });
    await send([...list.items, item], true);
  };

  const items = list?.items ?? [];
  const itemText = (item: PackingItem): string =>
    item.quantity > 1 ? `${item.quantity} × ${item.label}` : item.label;
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
                  {itemText(item)}
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
        <button
          type="button"
          className="t-card-title text-left"
          aria-expanded={expanded}
          disabled={!list}
          onClick={() => setExpanded((v) => !v)}
        >
          {list && items.length > 0
            ? t("trips:packing.collapsed", { done: doneCount, total: items.length })
            : t("trips:packing.title")}
          {expanded ? " ▾" : " ▸"}
        </button>
        {loadFailed && (
          <p role="alert" className="t-caption flex flex-wrap items-center" style={{ gap: 8 }}>
            {t("trips:packing.loadFailed")}
            <button type="button" className="btn-secondary" onClick={() => void load()}>
              {t("trips:packing.retry")}
            </button>
          </p>
        )}
        {notice && (
          <InlineError>
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
          </InlineError>
        )}
        {list && expanded && (
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
                        {itemText(item)}
                        <small className="t-caption">
                          {item.category ? ` · ${item.category}` : ""}
                          {` · ${t(`trips:packing.scope.${item.scope}`)}`}
                          {item.note ? ` · ${item.note}` : ""}
                        </small>
                      </span>
                    </label>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={busy}
                      aria-label={t("trips:packing.remove", { label: item.label })}
                      onClick={() => void remove(item.id)}
                    >
                      <Icon name="x" size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!adding && (
              <button
                type="button"
                className="btn-secondary"
                style={{ alignSelf: "flex-start" }}
                disabled={full}
                onClick={() => setAdding(true)}
              >
                {t("trips:packing.addEntry")}
              </button>
            )}
            {adding && (
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
                <input
                  className="input"
                  style={{ flex: "1 1 120px", minHeight: "var(--ts-size-touch-min)" }}
                  value={category}
                  maxLength={PACKING_MAX_CATEGORY}
                  disabled={busy || full}
                  aria-label={t("trips:packing.categoryLabel")}
                  placeholder={t("trips:packing.categoryPlaceholder")}
                  onChange={(e) => setCategory(e.target.value)}
                />
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={PACKING_MAX_QUANTITY}
                  style={{ flex: "0 0 80px", minHeight: "var(--ts-size-touch-min)" }}
                  value={quantity}
                  disabled={busy || full}
                  aria-label={t("trips:packing.quantityLabel")}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                />
                <select
                  className="input"
                  style={{ flex: "0 0 auto", minHeight: "var(--ts-size-touch-min)" }}
                  value={scope}
                  disabled={busy || full}
                  aria-label={t("trips:packing.scopeLabel")}
                  onChange={(e) => setScope(e.target.value as "personal" | "shared")}
                >
                  <option value="personal">{t("trips:packing.scope.personal")}</option>
                  <option value="shared">{t("trips:packing.scope.shared")}</option>
                </select>
                <button
                  type="submit"
                  className="btn-secondary"
                  disabled={busy || full || draft.trim() === ""}
                >
                  {t("trips:packing.add")}
                </button>
              </form>
            )}
            {full && (
              <p className="t-caption">{t("trips:packing.full", { max: PACKING_MAX_ITEMS })}</p>
            )}
          </>
        )}
      </section>
    </Card>
  );
}
