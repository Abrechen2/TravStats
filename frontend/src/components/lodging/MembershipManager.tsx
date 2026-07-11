import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import {
  listMemberships,
  createMembership,
  updateMembership,
  deleteMembership,
} from "../../lib/api/lodging";
import { logger } from "../../lib/logger";
import type { LodgingMembership, MembershipInput } from "../../types/lodging";

interface MembershipManagerProps {
  /** Fired after every successful load/create/update/delete with the fresh list. */
  onChanged?: (memberships: LodgingMembership[]) => void;
  /**
   * Scopes the manager to a single loyalty program — used by the chain
   * detail page, which cares about exactly ONE program (the chain's
   * `loyaltyProgram`), not the caller's whole membership list. When set:
   *  - only the membership(s) matching this program name are shown
   *    (there is at most one, enforced by the backend's
   *    `@@unique([userId, programName])`);
   *  - the "add" flow pre-fills and locks the program-name field to this
   *    value, since the chain page — not the user — determines the program;
   *  - the "add" button is hidden once a matching membership exists (one
   *    membership per program per user, so there's nothing left to add).
   */
  filterProgramName?: string;
  /** Extra note rendered under the title — e.g. "shared with Westin, Ritz-Carlton" when the program spans multiple chains. */
  sharedWithLabel?: string;
}

type EditingId = string | "new" | null;

/** Axios error shape narrowed just enough to read an HTTP status code, without `any`. */
function httpStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status;
}

/**
 * CRUD list for the user's loyalty memberships. Memberships are
 * PROGRAM-based (`programName`), never chain-based — several chains share
 * one program (Sheraton/Westin/Ritz-Carlton → Marriott Bonvoy), so there is
 * deliberately no chain picker here (see `schemas/lodging.ts`).
 *
 * The backend enforces one membership per program per user and returns 409
 * on a duplicate (`routes/lodgingMemberships.ts`) — that must surface as a
 * clean, readable sentence, never a raw error or a crash.
 */
export function MembershipManager({
  onChanged,
  filterProgramName,
  sharedWithLabel,
}: MembershipManagerProps): JSX.Element {
  const { t } = useTranslation(["lodging", "common"]);
  const [memberships, setMemberships] = useState<LodgingMembership[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<EditingId>(null);
  const [programName, setProgramName] = useState<string>("");
  const [membershipNumber, setMembershipNumber] = useState<string>("");
  const [tier, setTier] = useState<string>("");
  const [saving, setSaving] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const rows = await listMemberships();
      setMemberships(rows);
      onChanged?.(rows);
    } catch (err: unknown) {
      logger.error("MembershipManager: load failed", err);
      setLoadError(t("lodging:membership.loadError"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // Intentionally load-once on mount — `onChanged` is a callback prop, not
    // reactive state this effect should re-run on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The list this component actually renders — every membership when
  // unscoped, or just the (at most one) membership for `filterProgramName`
  // on the chain detail page.
  const visibleMemberships =
    filterProgramName !== undefined
      ? memberships.filter((m) => m.programName === filterProgramName)
      : memberships;
  const hasFilteredMembership = filterProgramName !== undefined && visibleMemberships.length > 0;

  const startCreate = (): void => {
    setEditingId("new");
    setProgramName(filterProgramName ?? "");
    setMembershipNumber("");
    setTier("");
    setFormError(null);
  };

  const startEdit = (m: LodgingMembership): void => {
    setEditingId(m.id);
    setProgramName(m.programName);
    setMembershipNumber(m.membershipNumber ?? "");
    setTier(m.tier ?? "");
    setFormError(null);
  };

  const cancelEdit = (): void => {
    setEditingId(null);
    setFormError(null);
  };

  const messageForSaveError = (err: unknown): string =>
    httpStatus(err) === 409 ? t("lodging:membership.duplicateError") : t("lodging:membership.saveError");

  const submit = async (): Promise<void> => {
    const trimmedName = programName.trim();
    if (trimmedName.length === 0 || editingId === null) return;
    setSaving(true);
    setFormError(null);
    try {
      const input: MembershipInput = {
        programName: trimmedName,
        membershipNumber: membershipNumber.trim() || undefined,
        tier: tier.trim() || undefined,
      };
      if (editingId === "new") {
        await createMembership(input);
      } else {
        await updateMembership(editingId, input);
      }
      setEditingId(null);
      await load();
    } catch (err: unknown) {
      // Never let a duplicate-program 409 crash the form or bubble a raw
      // Axios error — always a clean, actionable sentence.
      logger.error("MembershipManager: save failed", err);
      setFormError(messageForSaveError(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string): Promise<void> => {
    try {
      await deleteMembership(id);
      await load();
    } catch (err: unknown) {
      logger.error("MembershipManager: delete failed", err);
      setLoadError(t("lodging:membership.deleteError"));
    }
  };

  return (
    <div className="space-y-3" data-testid="membership-manager">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            {filterProgramName ?? t("lodging:membership.title")}
          </h3>
          {sharedWithLabel && (
            <p className="text-xs text-[var(--text-muted)]">{sharedWithLabel}</p>
          )}
        </div>
        {editingId === null && !hasFilteredMembership && (
          <button
            type="button"
            onClick={startCreate}
            className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--accent)] hover:bg-[var(--bg-surface)]"
          >
            {t("lodging:membership.add")}
          </button>
        )}
      </div>

      {loadError !== null && <p className="text-xs text-[var(--danger)]">{loadError}</p>}

      {loading ? (
        <p className="text-xs text-[var(--text-muted)]">{t("common:buttons.loading")}</p>
      ) : visibleMemberships.length === 0 && editingId === null ? (
        <p className="text-xs text-[var(--text-muted)]">{t("lodging:membership.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {visibleMemberships.map((m) => (
            <li
              key={m.id}
              data-testid={`membership-row-${m.id}`}
              className="flex items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm"
            >
              <div>
                <span className="font-medium text-[var(--text-primary)]">{m.programName}</span>
                {m.tier && <span className="ml-2 text-xs text-[var(--text-muted)]">{m.tier}</span>}
                {m.membershipNumber && (
                  <span className="ml-2 text-xs text-[var(--text-muted)]">#{m.membershipNumber}</span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => startEdit(m)}
                  className="text-xs text-[var(--accent)] hover:underline"
                >
                  {t("common:buttons.edit")}
                </button>
                <button
                  type="button"
                  data-testid={`membership-delete-${m.id}`}
                  onClick={() => void remove(m.id)}
                  className="text-xs text-[var(--danger)] hover:underline"
                >
                  {t("common:buttons.delete")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editingId !== null && (
        <div className="space-y-2 rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] p-3">
          <input
            aria-label={t("lodging:field.programName")}
            placeholder={t("lodging:field.programName")}
            value={programName}
            onChange={(e) => setProgramName(e.target.value)}
            disabled={filterProgramName !== undefined}
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--bg-elevated)] px-2 py-1 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] disabled:opacity-70"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              aria-label={t("lodging:field.membershipNumber")}
              placeholder={t("lodging:field.membershipNumber")}
              value={membershipNumber}
              onChange={(e) => setMembershipNumber(e.target.value)}
              className="rounded-md border border-[var(--color-border)] bg-[var(--bg-elevated)] px-2 py-1 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            />
            <input
              aria-label={t("lodging:field.tier")}
              placeholder={t("lodging:field.tier")}
              value={tier}
              onChange={(e) => setTier(e.target.value)}
              className="rounded-md border border-[var(--color-border)] bg-[var(--bg-elevated)] px-2 py-1 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
            />
          </div>
          {formError !== null && (
            <p data-testid="membership-form-error" className="text-xs text-[var(--danger)]">
              {formError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={cancelEdit}
              disabled={saving}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              {t("common:buttons.cancel")}
            </button>
            <button
              type="button"
              disabled={saving || programName.trim().length === 0}
              onClick={() => void submit()}
              className="rounded-md bg-[var(--accent)] px-2 py-1 text-xs font-medium text-neutral-900 hover:bg-[var(--accent-dim)] disabled:opacity-50"
            >
              {saving ? t("common:buttons.saving") : t("common:buttons.save")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
