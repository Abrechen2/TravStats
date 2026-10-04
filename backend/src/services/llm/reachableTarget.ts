import {
  llmProbe,
  resolveLlmChain,
  type LlmTarget,
  type ResolveLlmTargetOptions,
} from "./llmProvider";

/**
 * The first slot of the fallback chain that answers — not merely the first slot.
 *
 * Every parser used to take `resolveLlmTarget()`, which is `chain[0]`, probe
 * it, and give up when it did not answer. An Ollama endpoint entered once and
 * long since switched off, ahead of a consented cloud provider, therefore
 * answered every document with "the AI parser is not reachable" while the
 * provider behind it never saw a request (tester report 2026-10-03, measured on
 * the rail import first and fixed there in 2.7.0-rc.5; the same `chain[0]` sat
 * in the lodging, cruise and flight parsers and the trip summary).
 *
 * A slot that answers its probe is the answer — whether its extraction is good
 * is not this function's question, and no later slot is asked for a
 * better-sounding one (the chain's own rule, `llmProvider.ts`). When no slot
 * answers, `chain[0]` comes back, so every caller's existing "not reachable"
 * path still names the endpoint the admin configured first.
 */

/** As long as `llmAvailability.ts` trusts a probe: an admin's fix shows within a minute. */
const PROBE_TTL_MS = 60_000;

interface Probe {
  reachable: boolean;
  at: number;
}

const probes = new Map<string, Probe>();
const inFlight = new Map<string, Promise<boolean>>();

/** A slot is one kind at one address; two kinds may share a host. */
const keyOf = (target: LlmTarget): string => `${target.kind ?? "ollama"}|${target.url}`;

function fresh(target: LlmTarget): Probe | undefined {
  const probe = probes.get(keyOf(target));
  return probe && Date.now() - probe.at < PROBE_TTL_MS ? probe : undefined;
}

/** Probe once per slot at a time; a burst of parses shares the round trip. */
function probe(target: LlmTarget): Promise<boolean> {
  const key = keyOf(target);
  const running = inFlight.get(key);
  if (running) return running;
  const started = llmProbe(target)
    .then((result) => result.reachable)
    // `llmProbe` swallows its own errors; a rejection here would only be a bug
    // in it, and a probe that did not answer is a slot that is not reachable.
    .catch(() => false)
    .then((reachable) => {
      probes.set(key, { reachable, at: Date.now() });
      return reachable;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, started);
  return started;
}

export interface ResolveReachableOptions extends ResolveLlmTargetOptions {
  /**
   * `true`: probe every slot whose answer is not known, and wait — for a caller
   * that talks to the model next anyway (the domain parsers, the trip summary).
   * `false`: never wait on the network. Slots known to be down are skipped,
   * unknown ones are probed in the background and used optimistically — for a
   * path that may never reach the model (the flight parser's config, read on
   * every parse including pure template hits; see `llmAvailability.ts` on why
   * that path must not stall).
   */
  wait: boolean;
}

export async function resolveReachableLlmTarget(
  options: ResolveReachableOptions
): Promise<LlmTarget | null> {
  const { wait, ...chainOptions } = options;
  const chain = await resolveLlmChain(chainOptions);
  // One slot or none: nothing to choose between; the caller probes as before.
  if (chain.length <= 1) return chain[0] ?? null;

  for (const target of chain) {
    const known = fresh(target);
    if (known) {
      if (known.reachable) return target;
      continue;
    }
    if (wait) {
      if (await probe(target)) return target;
      continue;
    }
    void probe(target);
    return target;
  }
  return chain[0];
}

/**
 * Feed a probe a caller made itself (the rail parser walks the chain on its
 * own), so attribution read afterwards (`parseDocument.ts`) names the slot
 * that actually answered rather than the first one.
 */
export function recordReachability(target: LlmTarget, reachable: boolean): void {
  probes.set(keyOf(target), { reachable, at: Date.now() });
}

/** Test seam: forget every probe. */
export function clearReachableTargetCache(): void {
  probes.clear();
  inFlight.clear();
}
