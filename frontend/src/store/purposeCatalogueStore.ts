import { useEffect, useMemo } from "react";
import { create } from "zustand";

import { purposeApi, type PurposeCatalogue } from "../lib/api/purpose";
import { logger } from "../lib/logger";
import { BUILTIN_PURPOSES, BUILTIN_PREFIX } from "../shared/purposeCatalogue";
import { useAuthStore } from "./authStore";

/**
 * The account's purpose catalogue: the built-ins and the user's own purposes
 * (spec 2026-11-22-private-business-purpose.md, "Purpose catalogue"). Server-held, re-learned per
 * session, so not persisted. Until the first answer arrives the built-ins come from the shared
 * table, so a picker opened early still offers them; a failed load keeps that and says so in the
 * console (the next mount retries).
 */
interface PurposeCatalogueState {
  catalogue: PurposeCatalogue;
  loaded: boolean;
  failed: boolean;
  ownerId: string | null;
  load: (userId: string) => Promise<void>;
  /** Re-reads after a change in the settings section. */
  refresh: () => Promise<void>;
}

const INITIAL: PurposeCatalogue = {
  builtins: BUILTIN_PURPOSES.map((p) => ({
    key: `${BUILTIN_PREFIX}${p.key}`,
    kind: p.kind,
    icon: p.icon,
    color: p.color,
    label: { de: p.de, en: p.en },
  })),
  custom: [],
};

/** One request at a time per account: every chip in a list asks on mount. */
let inFlight: { userId: string; promise: Promise<void> } | null = null;

export const usePurposeCatalogueStore = create<PurposeCatalogueState>((_set, get) => ({
  catalogue: INITIAL,
  loaded: false,
  failed: false,
  ownerId: null,
  load: async (userId) => {
    if (inFlight?.userId === userId) return inFlight.promise;
    const promise = loadOnce(userId);
    inFlight = { userId, promise };
    try {
      await promise;
    } finally {
      if (inFlight?.promise === promise) inFlight = null;
    }
  },
  refresh: async () => {
    const owner = get().ownerId;
    if (owner) await get().load(owner);
  },
}));

async function loadOnce(userId: string): Promise<void> {
  const { getState: get, setState: set } = usePurposeCatalogueStore;
  {
    if (get().ownerId !== userId) set({ catalogue: INITIAL, loaded: false, ownerId: userId });
    try {
      const catalogue = await purposeApi.catalogue();
      if (get().ownerId === userId) set({ catalogue, loaded: true, failed: false });
    } catch (err: unknown) {
      logger.warn("purposes: could not load the account's purpose catalogue", err);
      if (get().ownerId === userId) set({ failed: true });
    }
  }
}

/** The catalogue for the signed-in account, loaded on first use; `loaded` says whether it arrived. */
export function usePurposeCatalogue(): PurposeCatalogue {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const catalogue = usePurposeCatalogueStore((s) => s.catalogue);
  const ownerId = usePurposeCatalogueStore((s) => s.ownerId);
  const loaded = usePurposeCatalogueStore((s) => s.loaded);
  const failed = usePurposeCatalogueStore((s) => s.failed);
  useEffect(() => {
    // A failed load is not retried in a loop: the next account switch or `refresh` asks again.
    if (userId && (ownerId !== userId || (!loaded && !failed))) {
      void usePurposeCatalogueStore.getState().load(userId);
    }
  }, [userId, ownerId, loaded, failed]);
  return useMemo(() => ({ ...catalogue, loaded }), [catalogue, loaded]);
}
