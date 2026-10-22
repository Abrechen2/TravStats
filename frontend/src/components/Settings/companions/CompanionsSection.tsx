import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "../../../hooks/useTranslation";
import { useCoarsePointer } from "../../../hooks/useCoarsePointer";
import {
  companionsApi,
  type CompanionUseKind,
  type ManagedCompanion,
} from "../../../lib/api/companions";
import { formatDayForLocale } from "../../../lib/lodgingFormat";
import { logger } from "../../../lib/logger";
import Button from "../../ui/Button";
import { SectionCard, SectionTitle } from "../SettingsShared";
import CompanionRenameDialog from "./CompanionRenameDialog";
import CompanionMergeDialog from "./CompanionMergeDialog";
import { CompanionDeleteDialog, DeleteUnusedDialog } from "./CompanionDeleteDialogs";

const NS = "companions:manage";

/** Where an account link is made: the trip-sharing section, never a second copy of it. */
export const SHARING_SETTINGS_PATH = "/settings/trips?section=sharing";

type Open =
  | { kind: "rename"; companion: ManagedCompanion }
  | { kind: "merge"; companion: ManagedCompanion; target?: string }
  | { kind: "delete"; companion: ManagedCompanion }
  | { kind: "deleteUnused" }
  | null;

/**
 * Settings → Mitreisende: every person the user has typed into an entry, with
 * where they appear, and the three ways to tidy the list — rename (every entry
 * follows), merge two spellings of one person, delete one nobody uses. Linking
 * a companion to an account stays in "Reisen teilen"; this page links there.
 *
 * A failed load says so and offers a retry instead of drawing an empty list,
 * which would read as "you have no companions".
 */
export default function CompanionsSection(): JSX.Element {
  const { t, i18n } = useTranslation(["companions"]);
  const coarse = useCoarsePointer();
  const [data, setData] = useState<{
    companions: ManagedCompanion[];
    kinds: CompanionUseKind[];
  } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [open, setOpen] = useState<Open>(null);

  const load = useCallback(async () => {
    try {
      setData(await companionsApi.manage());
      setLoadFailed(false);
    } catch (error) {
      logger.error("Failed to load companions:", error);
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const done = (): void => {
    setOpen(null);
    void load();
  };

  const companions = data?.companions ?? [];
  const unused = companions.filter((c) => !c.inUse).length;
  const rowGap = coarse ? "var(--ts-space-md)" : "var(--ts-space-sm)";

  return (
    <SectionCard>
      <SectionTitle title={t(`${NS}.title`)} description={t(`${NS}.description`)} />

      {loadFailed && (
        <div role="alert" className="flex flex-wrap items-center gap-2">
          <p className="text-sm" style={{ color: "var(--ts-warn)" }}>
            {t(`${NS}.loadFailed`)}
          </p>
          <Button onClick={() => void load()}>{t(`${NS}.retry`)}</Button>
        </div>
      )}

      {data === null && !loadFailed && <p className="t-caption">{t(`${NS}.loading`)}</p>}

      {data !== null && companions.length === 0 && <p className="t-caption">{t(`${NS}.empty`)}</p>}

      {companions.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="t-caption">{t(`${NS}.count`, { count: companions.length })}</p>
            <Button disabled={unused === 0} onClick={() => setOpen({ kind: "deleteUnused" })}>
              {t(`${NS}.actions.deleteUnused`, { count: unused })}
            </Button>
          </div>
          <ul className="flex flex-col" style={{ gap: rowGap }}>
            {companions.map((companion) => (
              <CompanionRow
                key={companion.id}
                companion={companion}
                kinds={data?.kinds ?? []}
                language={i18n.language}
                canMerge={companions.length > 1}
                onOpen={setOpen}
              />
            ))}
          </ul>
        </>
      )}

      {open?.kind === "rename" && (
        <CompanionRenameDialog
          companion={open.companion}
          onClose={() => setOpen(null)}
          onDone={done}
          onMergeInstead={(target) => setOpen({ kind: "merge", companion: open.companion, target })}
        />
      )}
      {open?.kind === "merge" && (
        <CompanionMergeDialog
          companion={open.companion}
          others={companions.filter((c) => c.id !== open.companion.id)}
          initialTarget={open.target}
          onClose={() => setOpen(null)}
          onDone={done}
        />
      )}
      {open?.kind === "delete" && (
        <CompanionDeleteDialog
          companion={open.companion}
          onClose={() => setOpen(null)}
          onDone={done}
        />
      )}
      {open?.kind === "deleteUnused" && (
        <DeleteUnusedDialog count={unused} onClose={() => setOpen(null)} onDone={done} />
      )}
    </SectionCard>
  );
}

function CompanionRow({
  companion,
  kinds,
  language,
  canMerge,
  onOpen,
}: {
  companion: ManagedCompanion;
  kinds: CompanionUseKind[];
  language: string;
  canMerge: boolean;
  onOpen: (open: Open) => void;
}): JSX.Element {
  const { t } = useTranslation(["companions"]);
  const uses = kinds
    .filter((kind) => (companion.uses[kind] ?? 0) > 0)
    .map((kind) => t(`${NS}.kinds.${kind}`, { count: companion.uses[kind] }));
  const facts = [
    ...(uses.length > 0 ? [uses.join(" · ")] : []),
    ...(companion.hiddenUses > 0 ? [t(`${NS}.hiddenUses`, { count: companion.hiddenUses })] : []),
    ...(companion.expensesPaid > 0
      ? [t(`${NS}.expensesPaid`, { count: companion.expensesPaid })]
      : []),
  ];
  return (
    <li
      className="flex flex-col gap-2 py-2"
      style={{ borderBottom: "1px solid var(--ts-border)" }}
      data-testid={`companion-row-${companion.id}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">{companion.name}</span>
        <span className="t-caption">
          {companion.linkedUser ? (
            <>
              {t(`${NS}.linkedTo`, { username: companion.linkedUser.username })} ·{" "}
              <Link to={SHARING_SETTINGS_PATH} className="underline">
                {t(`${NS}.changeLink`)}
              </Link>
            </>
          ) : (
            <Link to={SHARING_SETTINGS_PATH} className="underline">
              {t(`${NS}.linkAccount`)}
            </Link>
          )}
        </span>
      </div>
      <p className="t-caption">
        {facts.length > 0 ? facts.join(" · ") : t(`${NS}.unused`)}
        {companion.lastTogether
          ? ` · ${t(`${NS}.lastTogether`, { date: formatDayForLocale(companion.lastTogether, language) })}`
          : null}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => onOpen({ kind: "rename", companion })}>
          {t(`${NS}.actions.rename`)}
        </Button>
        <Button disabled={!canMerge} onClick={() => onOpen({ kind: "merge", companion })}>
          {t(`${NS}.actions.merge`)}
        </Button>
        {companion.inUse ? (
          <span className="t-caption">{t(`${NS}.inUseHint`)}</span>
        ) : (
          <Button onClick={() => onOpen({ kind: "delete", companion })}>
            {t(`${NS}.actions.delete`)}
          </Button>
        )}
      </div>
    </li>
  );
}
