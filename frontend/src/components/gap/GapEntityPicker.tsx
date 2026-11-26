import { useEffect, useState } from "react";
import type { JSX } from "react";
import Button from "../ui/Button";
import Modal from "../Modal";
import { EntityPicker } from "../ui/EntityPicker";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";

export interface GapPick<T = unknown> {
  id: string;
  name: string;
  detail?: string | null;
  /** The record the row stands for, handed back on a pick. */
  data: T;
}

type State<T> = { kind: "loading" } | { kind: "failed" } | { kind: "loaded"; rows: GapPick<T>[] };

/**
 * Which house or place a gap's new stay or visit belongs to. Searches the
 * server (never a page of rows the list happened to load), says so when the
 * search itself failed, and always offers to create the missing one — a picker
 * that cannot add what is not there is a dead end (the "picker offers a subset"
 * defect). Opens from the gap calendar's "Eintrag anlegen".
 */
export default function GapEntityPicker<T>({
  title,
  hint,
  searchLabel,
  search,
  onPick,
  onCreate,
  createLabel,
  onClose,
}: {
  title: string;
  hint: string;
  searchLabel: string;
  search: (query: string) => Promise<GapPick<T>[]>;
  onPick: (pick: GapPick<T>) => void;
  onCreate: () => void;
  createLabel: string;
  onClose: () => void;
}): JSX.Element {
  const { t } = useTranslation(["track", "common"]);
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query);
  const [state, setState] = useState<State<T>>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setState({ kind: "loading" });
    search(debounced.trim())
      .then((rows) => live && setState({ kind: "loaded", rows }))
      .catch((err: unknown) => {
        logger.warn("The gap picker's search failed", err);
        if (live) setState({ kind: "failed" });
      });
    return () => {
      live = false;
    };
    // `search` is the caller's closure; the query and a retry are what re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, attempt]);

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      maxWidth={560}
      closeLabel={t("common:buttons.close")}
    >
      <div className="flex flex-col gap-3" data-testid="gap-picker">
        <p className="t-caption">{hint}</p>
        <EntityPicker
          label={searchLabel}
          query={query}
          onQueryChange={setQuery}
          status={state.kind === "loaded" ? "ready" : state.kind}
          onRetry={() => setAttempt((n) => n + 1)}
          options={
            state.kind === "loaded" ? state.rows.map((row) => ({ ...row, label: row.name })) : []
          }
          onPick={(row) => onPick(row)}
          emptyText={t("track:gaps.picker.none")}
          loadingText={t("track:gaps.picker.loading")}
          failedText={t("track:gaps.picker.failed")}
          retryText={t("track:gaps.retry")}
          searchTestId="gap-picker-search"
          emptyTestId="gap-picker-none"
        />
        <Button variant="secondary" onClick={onCreate} data-testid="gap-picker-create">
          {createLabel}
        </Button>
      </div>
    </Modal>
  );
}
