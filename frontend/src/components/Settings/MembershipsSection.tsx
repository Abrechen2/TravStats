import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { SectionCard, SectionTitle } from "./SettingsShared";
import { MembershipManager } from "../lodging/MembershipManager";
import { listLodgings, updateMembership } from "../../lib/api/lodging";
import { logger } from "../../lib/logger";
import type { Lodging, LodgingMembership } from "../../types/lodging";

/**
 * The one place every loyalty card is visible.
 *
 * Before this existed, a card was only reachable through a chain page that
 * covered it — so unticking its last chain made it disappear, and a card
 * created from the stay editor (which linked no chain at all) was invisible
 * from the start while its name stayed taken. Alex asked for exactly this:
 * "wo finde ich alle bisherigen Bonusprogramme?" (Discord, 2026-08-08).
 *
 * The card list itself is the unscoped `MembershipManager` (create/edit/
 * delete + chain checkboxes, already built). This component adds a coverage
 * summary and a hotel-coverage picker INSIDE each of its rows via
 * `renderRowExtra`, rather than rendering a second list next to it — two
 * separate lists over the same unscoped membership set would each print
 * every programme name, so a card's name would appear twice in the DOM.
 */
export default function MembershipsSection(): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const [lodgings, setLodgings] = useState<Lodging[]>([]);
  const [openPicker, setOpenPicker] = useState<string | null>(null);
  const [reloadSignal, setReloadSignal] = useState<number | undefined>(undefined);

  useEffect(() => {
    void (async () => {
      try {
        setLodgings(await listLodgings());
      } catch (err) {
        logger.error("MembershipsSection: failed to load lodgings", err);
      }
    })();
  }, []);

  const coverage = (m: LodgingMembership): string => {
    const names = [...m.chains.map((c) => c.name), ...m.lodgings.map((l) => l.name)];
    return names.length > 0 ? names.join(", ") : t("settings:memberships.coversNothing");
  };

  // Only chain-less hotels are offered here. A hotel WITH a chain is covered
  // through that chain, and a direct link on it would be dormant —
  // `shared/membershipDerivation.ts` ranks a chain link above a direct
  // hotel link — so offering it here would promise something that never
  // takes effect. The backend still accepts such a link (it is legal, just
  // dormant); this filter is a UI affordance, not a validation rule.
  const independentLodgings = lodgings.filter((l) => l.chainId === null);

  const toggleLodging = (membership: LodgingMembership, lodgingId: string, checked: boolean): void => {
    const nextLodgingIds = checked
      ? [...membership.lodgingIds, lodgingId]
      : membership.lodgingIds.filter((id) => id !== lodgingId);
    void (async () => {
      try {
        await updateMembership(membership.id, { lodgingIds: nextLodgingIds });
        setReloadSignal((prev) => (prev ?? 0) + 1);
      } catch (err) {
        logger.error("MembershipsSection: failed to update hotel coverage", err);
      }
    })();
  };

  return (
    <SectionCard>
      <SectionTitle
        title={t("settings:memberships.title")}
        description={t("settings:memberships.description")}
      />

      <MembershipManager
        reloadSignal={reloadSignal}
        renderRowExtra={(m) => (
          <div className="mt-1 text-xs text-[var(--text-secondary)]">
            {coverage(m)}
            <button
              type="button"
              data-testid={`membership-hotels-${m.id}`}
              onClick={(): void => setOpenPicker((cur) => (cur === m.id ? null : m.id))}
              className="ml-2 text-xs text-[var(--accent)] hover:underline"
            >
              {t("settings:memberships.editHotels")}
            </button>
            {openPicker === m.id && (
              <div
                data-testid={`membership-hotel-picker-${m.id}`}
                className="mt-1 space-y-1 pl-4"
              >
                {independentLodgings.length === 0 ? (
                  <p className="text-[var(--text-muted)]">
                    {t("settings:memberships.noIndependentHotels")}
                  </p>
                ) : (
                  independentLodgings.map((l) => (
                    <label key={l.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={m.lodgingIds.includes(l.id)}
                        onChange={(e): void => toggleLodging(m, l.id, e.target.checked)}
                        className="accent-[var(--accent)]"
                      />
                      {l.name}
                    </label>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      />
    </SectionCard>
  );
}
