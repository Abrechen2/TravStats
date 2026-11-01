import { CLOUD_PROVIDER_KINDS, type CloudProviderKind } from "../../lib/api/admin";

/** The catalogue service each cloud slot is switched on, keyed and consented in. */
export const SERVICE_OF: Record<CloudProviderKind, string> = {
  openai: "openai",
  anthropic: "anthropic",
  google: "gemini",
  custom: "customLlm",
};

/** The saved priority, completed with any missing kind — mirrors the backend's `parseProviderOrder`. */
export function completeOrder(
  saved: readonly CloudProviderKind[] | undefined
): CloudProviderKind[] {
  const order: CloudProviderKind[] = [];
  for (const kind of saved ?? []) if (!order.includes(kind)) order.push(kind);
  for (const kind of CLOUD_PROVIDER_KINDS) if (!order.includes(kind)) order.push(kind);
  return order;
}

/**
 * Swaps `kind` with its nearest neighbour AMONG THE ENABLED slots and leaves the
 * disabled ones where they are: what the admin sees is the enabled list, so
 * "down" means "below the next one I can see".
 */
export function moveAmongEnabled(
  order: CloudProviderKind[],
  enabled: ReadonlySet<CloudProviderKind>,
  kind: CloudProviderKind,
  delta: 1 | -1
): CloudProviderKind[] {
  const from = order.indexOf(kind);
  let to = from + delta;
  while (to >= 0 && to < order.length && !enabled.has(order[to])) to += delta;
  if (from < 0 || to < 0 || to >= order.length) return order;
  const next = [...order];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
