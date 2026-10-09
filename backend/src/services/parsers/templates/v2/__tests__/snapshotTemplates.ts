/**
 * The bundled snapshot's templates, loaded through the REAL loader — validated
 * and active only because their own test cases passed — exactly as the app
 * loads them offline. For parity tests that compare a moved issuer reader
 * with the template file it became (plan 2026-10-09 P4).
 */
import { createMemoryTemplateCache } from "../cache";
import type { TemplateDomain, TemplateEnvelope } from "../envelope";
import { V2TemplateStore } from "../loader";
import { createDirSnapshot } from "../snapshot";
import type { V2TemplateStatusEntry } from "../status";

let store: V2TemplateStore | null = null;

function snapshotStore(): V2TemplateStore {
  if (store === null) {
    store = new V2TemplateStore({
      fetchJson: () => Promise.reject(new Error("offline")),
      baseUrl: "https://templates.example.test",
      appVersion: "99.0.0",
      cache: createMemoryTemplateCache(),
      snapshot: createDirSnapshot(),
    });
    store.loadFromCache();
  }
  return store;
}

export function snapshotTemplates(domain?: TemplateDomain): TemplateEnvelope[] {
  const all = snapshotStore().getActive();
  return domain === undefined ? all : all.filter((t) => t.domain === domain);
}

export function snapshotTemplate(id: string): TemplateEnvelope {
  const found = snapshotTemplates().find((t) => t.id === id);
  if (!found) throw new Error(`No active snapshot template ${id}`);
  return found;
}

/** Status of every snapshot template of `domain` — for "none was rejected". */
export function snapshotStatus(domain: TemplateDomain): V2TemplateStatusEntry[] {
  return snapshotStore()
    .getStatus()
    .templates.filter((t) => t.domain === domain);
}
