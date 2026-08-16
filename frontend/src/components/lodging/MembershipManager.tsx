import { useEffect, useState } from "react";
import type { JSX, ReactNode } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import {
  listMemberships,
  createMembership,
  updateMembership,
  deleteMembership,
} from "../../lib/api/lodging";
import { logger } from "../../lib/logger";
import type { LodgingChainRef, LodgingMembership, MembershipInput } from "../../types/lodging";

interface MembershipManagerProps {
  /** Fired after every successful load/create/update/delete with the fresh list. */
  onChanged?: (memberships: LodgingMembership[]) => void;
  /**
   * Scopes the manager to ONE chain — the chain detail page, which cares only
   * about the membership covering the chain being viewed. When set:
   *  - only the membership LINKED to this chain is shown (at most one);
   *  - creating pre-ticks `suggestedChains` and prefills the programme name
   *    with `suggestedProgramName`, both merely suggestions the user may
   *    change: the name is their own card's wording, not a catalogue value;
   *  - the "add" button hides once a membership covers this chain.
   */
  scopeChain?: {
    id: number;
    /** Chains to pre-tick when creating: this chain plus its catalogue siblings. */
    suggestedChains: LodgingChainRef[];
    /** Prefill for the programme name — the catalogue's guess, freely editable. */
    suggestedProgramName?: string | null;
  };
  /** Extra note rendered under the title — e.g. "shared with Westin, Ritz-Carlton" when the program spans multiple chains. */
  sharedWithLabel?: string;
  /**
   * The full chain catalogue, used to build the checkbox list when UNSCOPED
   * (no `scopeChain`). Without this, the unscoped checkbox list is only
   * `editingMembership.chains` — so creating a card offers nothing to tick
   * at all (saves `chainIds: []`), and editing a card is untick-only, with
   * no way to add a chain back. Ignored when `scopeChain` is set — the chain
   * page keeps its existing `suggestedChains`-based list unchanged.
   */
  chainCatalog?: LodgingChainRef[];
  /**
   * Extra content rendered inside each row, below the programme name/tier
   * line — e.g. the settings overview's coverage summary and hotel-coverage
   * picker. Kept as a render prop rather than a second list so a card's name
   * appears exactly once in the DOM; two separate lists both rendering the
   * unscoped membership set would each print every programme name.
   */
  renderRowExtra?: (membership: LodgingMembership) => ReactNode;
  /**
   * Bump this (e.g. `n => n + 1`) to force a reload from outside — needed
   * when `renderRowExtra` mutates a membership (like linking a hotel)
   * through a call this component doesn't itself make.
   */
  reloadSignal?: number;
}

type EditingId = string | "new" | null;

/** Axios error shape narrowed just enough to read an HTTP status code, without `any`. */
function httpStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status;
}

/**
 * CRUD list for the user's loyalty memberships. One membership covers SEVERAL
 * chains (Sheraton/Westin/Ritz-Carlton → Marriott Bonvoy), attached here as
 * explicit chain links the user ticks.
 *
 * The programme name is the USER's text and is always editable. It used to be
 * locked whenever the manager was scoped to a chain, because the chain page
 * found the membership by comparing that name to the catalogue's
 * `loyaltyProgram` — so any correction made the membership disappear from the
 * page. The link is by id now, which is what makes editing safe: "NH Rewards"
 * can be renamed to "Minor DISCOVERY" and still shows up on the NH page.
 *
 * The backend enforces one membership per program per user and returns 409
 * on a duplicate (`routes/lodgingMemberships.ts`) — that must surface as a
 * clean, readable sentence, never a raw error or a crash.
 */
export function MembershipManager({
  onChanged,
  scopeChain,
  sharedWithLabel,
  chainCatalog,
  renderRowExtra,
  reloadSignal,
}: MembershipManagerProps): JSX.Element {
  const { t } = useTranslation(["lodging", "common"]);
  const [memberships, setMemberships] = useState<LodgingMembership[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<EditingId>(null);
  const [programName, setProgramName] = useState<string>("");
  const [membershipNumber, setMembershipNumber] = useState<string>("");
  const [tier, setTier] = useState<string>("");
  const [chainIds, setChainIds] = useState<number[]>([]);
  const [saving, setSaving] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);
  // The existing card a duplicate-name 409 clashed with, when one was found —
  // offers "extend this card to cover the chain too" instead of a dead end.
  const [clash, setClash] = useState<LodgingMembership | null>(null);

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

  useEffect(() => {
    // `reloadSignal` starts `undefined`, so this never double-fires the
    // mount-time load above; it only reloads on a genuine external bump.
    if (reloadSignal === undefined) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadSignal]);

  // The list this component actually renders — every membership when unscoped,
  // or just the (at most one) membership covering `scopeChain` on the chain
  // detail page. Matched on the chain ID, never on the programme name.
  const visibleMemberships =
    scopeChain !== undefined
      ? memberships.filter((m) => m.chainIds.includes(scopeChain.id))
      : memberships;
  const hasFilteredMembership = scopeChain !== undefined && visibleMemberships.length > 0;

  // Every chain tickable in the form. Scoped (the chain page): the catalogue
  // suggestion for this chain, unchanged from before. Unscoped (Settings):
  // the FULL chain catalogue, so the user can tick a chain the card does not
  // cover yet — not just untick one it already has. Either way, whatever the
  // membership being edited already covers is added too, so a link outside
  // the offered set stays visible instead of being dropped on the next save.
  const editingMembership =
    editingId !== null && editingId !== "new"
      ? memberships.find((m) => m.id === editingId)
      : undefined;
  const chainChoices: LodgingChainRef[] = (() => {
    const byId = new Map<number, LodgingChainRef>();
    const suggested = scopeChain !== undefined ? scopeChain.suggestedChains : (chainCatalog ?? []);
    for (const c of suggested) byId.set(c.id, c);
    for (const c of editingMembership?.chains ?? []) byId.set(c.id, c);
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
  })();

  const startCreate = (): void => {
    setEditingId("new");
    setProgramName(scopeChain?.suggestedProgramName ?? "");
    setMembershipNumber("");
    setTier("");
    // Pre-ticked from the catalogue, and only a suggestion — the user unticks
    // whatever their card does not actually cover.
    setChainIds((scopeChain?.suggestedChains ?? []).map((c) => c.id));
    setFormError(null);
    setClash(null);
  };

  const startEdit = (m: LodgingMembership): void => {
    setEditingId(m.id);
    setProgramName(m.programName);
    setMembershipNumber(m.membershipNumber ?? "");
    setTier(m.tier ?? "");
    setChainIds(m.chainIds);
    setFormError(null);
    setClash(null);
  };

  const toggleChain = (chainId: number): void => {
    setChainIds((prev) =>
      prev.includes(chainId) ? prev.filter((id) => id !== chainId) : [...prev, chainId]
    );
  };

  const cancelEdit = (): void => {
    setEditingId(null);
    setFormError(null);
    setClash(null);
  };

  /**
   * The chain page resolves "the membership for this chain" through the LINK
   * table (routes/lodgingChains.ts), so a card that no longer covers this chain
   * simply is not there any more — correct, and indistinguishable from deleted.
   * Beta.3 UAT: users read it as data loss and re-created the card, which then
   * hit the duplicate 409. Say it while the box is being unticked, not after.
   */
  const leavesScopeChain =
    scopeChain !== undefined && editingId !== null && !chainIds.includes(scopeChain.id);

  const messageForSaveError = (err: unknown): string =>
    httpStatus(err) === 409
      ? t("lodging:membership.duplicateError")
      : t("lodging:membership.saveError");

  const submit = async (): Promise<void> => {
    const trimmedName = programName.trim();
    if (trimmedName.length === 0 || editingId === null) return;
    const wasCreating = editingId === "new";
    setSaving(true);
    setFormError(null);
    setClash(null);
    try {
      const input: MembershipInput = {
        programName: trimmedName,
        membershipNumber: membershipNumber.trim() || undefined,
        tier: tier.trim() || undefined,
        // Always sent from this form: it renders every choice, so what is
        // ticked IS the complete set. (Callers that omit the key keep their
        // existing links — see `MembershipInput`.)
        chainIds,
      };
      if (wasCreating) {
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
      // On a chain page, the name is taken by a card the user already has —
      // creating is the wrong verb, extending that card to also cover this
      // chain is what they meant. Find it so the offer can be rendered.
      // (Unscoped `MembershipManager` lists every card already, so a
      // duplicate there is self-explanatory and gets no offer.)
      if (wasCreating && scopeChain !== undefined && httpStatus(err) === 409) {
        const taken = memberships.find(
          (m) => m.programName.trim().toLowerCase() === trimmedName.toLowerCase()
        );
        setClash(taken ?? null);
      }
    } finally {
      setSaving(false);
    }
  };

  const extendClash = async (): Promise<void> => {
    if (clash === null || scopeChain === undefined) return;
    try {
      const nextChainIds = Array.from(new Set([...clash.chainIds, scopeChain.id]));
      await updateMembership(clash.id, { chainIds: nextChainIds });
      setClash(null);
      setFormError(null);
      setEditingId(null);
      await load();
    } catch (err: unknown) {
      logger.error("MembershipManager: extend-existing failed", err);
      setFormError(t("lodging:membership.saveError"));
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
          {/* Always the section title. It used to print the scoped programme
              name, which now belongs to the membership row (and to the chain
              page's own header) — printing it here as well said the same
              thing twice and, once the name became editable, twice with two
              different values while editing. */}
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            {t("lodging:membership.title")}
          </h3>
          {sharedWithLabel && <p className="text-xs text-[var(--text-muted)]">{sharedWithLabel}</p>}
        </div>
        {editingId === null && !hasFilteredMembership && (
          <button
            type="button"
            data-testid="membership-add"
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
              className="rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm"
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-[var(--text-primary)]">{m.programName}</span>
                  {m.tier && <span className="ml-2 text-xs text-[var(--text-muted)]">{m.tier}</span>}
                  {m.membershipNumber && (
                    <span className="ml-2 text-xs text-[var(--text-muted)]">
                      #{m.membershipNumber}
                    </span>
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
              </div>
              {renderRowExtra?.(m)}
            </li>
          ))}
        </ul>
      )}

      {editingId !== null && (
        <div className="space-y-2 rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] p-3">
          <input
            aria-label={t("lodging:field.programName")}
            placeholder={t("lodging:field.programName")}
            data-testid="membership-name-input"
            value={programName}
            onChange={(e) => setProgramName(e.target.value)}
            className="w-full rounded-md border border-[var(--color-border)] bg-[var(--bg-elevated)] px-2 py-1 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
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
          {chainChoices.length > 0 && (
            <fieldset data-testid="membership-chain-choices" className="mt-1">
              <legend className="mb-1 text-xs text-[var(--text-muted)]">
                {t("lodging:membership.coversChains")}
              </legend>
              <div className="flex flex-col gap-1">
                {chainChoices.map((c) => (
                  <label
                    key={c.id}
                    className="flex items-center gap-2 text-xs text-[var(--text-primary)]"
                  >
                    <input
                      type="checkbox"
                      checked={chainIds.includes(c.id)}
                      onChange={() => toggleChain(c.id)}
                      className="accent-[var(--accent)]"
                    />
                    {c.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {leavesScopeChain && (
            <p
              data-testid="membership-leaves-chain"
              className="text-xs text-[var(--text-muted)]"
            >
              {t("lodging:membership.leavesThisChain")}
            </p>
          )}
          {formError !== null && (
            <p data-testid="membership-form-error" className="text-xs text-[var(--danger)]">
              {formError}
            </p>
          )}
          {clash && scopeChain && (
            <button
              type="button"
              data-testid="membership-extend-existing"
              onClick={() => void extendClash()}
              className="text-xs text-[var(--accent)] hover:underline"
            >
              {t("lodging:membership.extendExisting", { name: clash.programName })}
            </button>
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
              data-testid="membership-save"
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
