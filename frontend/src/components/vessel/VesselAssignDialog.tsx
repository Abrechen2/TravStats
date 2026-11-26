import { useState } from "react";
import type { JSX } from "react";
import Dialog from "../ui/Dialog";
import Button from "../ui/Button";
import { useTranslation } from "../../hooks/useTranslation";
import { useToastStore } from "../../store/toastStore";
import { vesselApi, type VesselCandidate, type VesselKind } from "../../lib/api/vessel";

/**
 * "Schiff zuordnen …" (2026-11-22): the hidden override when the server could
 * not find the ship unambiguously, or found the wrong one. A search by name
 * over the resolver's candidates — it never asks for raw digits, and the server
 * accepts only a ship it offered.
 */
export function VesselAssignDialog({
  kind,
  id,
  initialName,
  onClose,
  onAssigned,
}: {
  kind: VesselKind;
  id: string;
  initialName: string;
  onClose: () => void;
  onAssigned: () => void;
}): JSX.Element {
  const { t } = useTranslation(["ferry", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const [query, setQuery] = useState(initialName);
  const [searched, setSearched] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<VesselCandidate[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const search = async () => {
    const q = query.trim();
    if (q.length < 2 || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const answer = await vesselApi.candidates(kind, id, q);
      setSearched(q);
      setCandidates(answer.candidates);
      if (answer.status === "unavailable") setMessage(t("ferry:vessel.assign.unavailable"));
      else if (answer.candidates.length === 0) setMessage(t("ferry:vessel.assign.none"));
    } catch (error) {
      console.warn("vessel search failed", error);
      setMessage(t("ferry:vessel.assign.unavailable"));
    } finally {
      setBusy(false);
    }
  };

  const pick = async (c: VesselCandidate) => {
    if (busy || searched === null) return;
    setBusy(true);
    setMessage(null);
    try {
      await vesselApi.assign(kind, id, c.mmsi, searched);
      addToast("success", t("ferry:vessel.assign.done"));
      onAssigned();
    } catch (error) {
      console.warn("vessel assign failed", error);
      setMessage(t("ferry:vessel.assign.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      busy={busy}
      title={t("ferry:vessel.assign.title")}
      maxWidth={560}
      testId="vessel-assign"
      closeLabel={t("common:buttons.close")}
    >
      <p className="t-caption">{t("ferry:vessel.assign.hint")}</p>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <label className="flex-1 text-sm">
          {t("ferry:vessel.assign.search")}
          <input
            className="mt-1 w-full rounded-md border border-border bg-(--bg-surface) px-3 py-3"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={100}
          />
        </label>
        <Button disabled={busy || query.trim().length < 2} onClick={() => void search()}>
          {t("ferry:vessel.assign.searchButton")}
        </Button>
      </form>
      {message && (
        <p role="alert" className="mt-2 text-sm">
          {message}
        </p>
      )}
      <ul className="mt-3 divide-y divide-border">
        {candidates.map((c) => (
          <li key={c.mmsi} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span>
              {c.name}
              {c.operator ? ` · ${c.operator}` : ""}
              <span className="t-caption block">
                {[
                  c.imo ? t("ferry:vessel.assign.imo", { imo: c.imo }) : null,
                  t(`ferry:vessel.source.${c.source}`),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            <Button disabled={busy} onClick={() => void pick(c)}>
              {t("ferry:vessel.assign.pick")}
            </Button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
