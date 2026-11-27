import type { DbTransaction } from "../../db";
import { ADAPTERS } from "./adapters";
import { DERIVE } from "./deriveCopy";
import type { FactRecord } from "./factValues";
import type { LinkPair } from "./linkMatch";
import { settlePlan, type GroupChoices, type SettleDecision } from "./linkResolve";
import { propagateWrite } from "./propagate";

/**
 * Settle the facts one linked pair disagrees in, local or across servers. Which facts go which way
 * is `settlePlan`'s (the quality rule, then the person's per-field choices). The caller's values
 * travel as if the caller had just changed them from the other side's values to their own — the
 * ordinary propagation, with an undoable notice on the other side. The other side's values are
 * written onto the caller's entry; `spreadTheirs` also carries them to any further member of the
 * group on this server (across servers the home holds them already and spreads them itself).
 */

/** The choices for every pair of a link, keyed by `pairRef`. */
export type LinkChoices = Record<string, GroupChoices>;

/** How the dry run and the link name one pair: its type and the caller's entry. */
export const pairRef = (pair: Pick<LinkPair, "entity" | "here">): string =>
  `${pair.entity}:${pair.here.id}`;

const pick = (facts: FactRecord, keys: readonly string[]): FactRecord =>
  Object.fromEntries(keys.map((k) => [k, facts[k]]));

export async function settlePair(
  tx: DbTransaction,
  userId: string,
  groupId: string,
  pair: LinkPair,
  decision: SettleDecision,
  choices: LinkChoices | undefined,
  options: { spreadTheirs: boolean }
): Promise<boolean> {
  if (pair.conflicts.length === 0) return false;
  const { entity, here, there } = pair;
  const plan = settlePlan(
    entity,
    pair.conflicts,
    here.facts,
    there.facts,
    decision,
    choices?.[pairRef(pair)]
  );
  if (plan.mine.length === 0 && plan.theirs.length === 0) return false;
  if (plan.theirs.length > 0) {
    await ADAPTERS[entity].apply(tx, here, there.facts, plan.theirs, here.facts);
    await DERIVE[entity](tx, here.id, userId);
  }
  const spread = options.spreadTheirs && plan.theirs.length > 0;
  if (plan.mine.length > 0 || spread) {
    const facts = {
      ...here.facts,
      // Spread: as if changed from the caller's old values; else no difference to send.
      ...pick(spread ? here.facts : there.facts, plan.theirs),
      ...pick(there.facts, plan.mine),
    };
    await propagateWrite(tx, userId, entity, here.id, { ...here, entity, groupId, facts });
  }
  return true;
}
