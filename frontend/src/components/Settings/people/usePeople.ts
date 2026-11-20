import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useBetaFeatures } from "../../../hooks/useBetaFeatures";
import { useIsDemoAccount } from "../../../hooks/useIsDemoAccount";
import {
  companionsApi,
  type CompanionUseKind,
  type ManagedCompanion,
} from "../../../lib/api/companions";
import { comparisonApi } from "../../../lib/api/comparison";
import { sharingApi } from "../../../lib/api/sharing";
import { sharingConnectionsApi } from "../../../lib/api/sharingConnections";
import { sharingRemoteApi } from "../../../lib/api/sharingRemote";
import type { PeopleResponse } from "../../../lib/comparison/types";
import { logger } from "../../../lib/logger";
import type { LinkableCompanionList, ShareConsentList } from "../../../types/sharing";
import type { Connection, RemotePerson } from "../../../types/sharingRemote";
import {
  buildPeople,
  type PeopleSources,
  type PersonEntry,
  type PendingRequest,
} from "./buildPeople";

/** The sources the list draws from, each with its own failure so one cannot hide another. */
export type PeopleSourceId = "companions" | "accounts" | "connections" | "comparison";

export interface PeopleState {
  people: PersonEntry[];
  requests: PendingRequest[];
  kinds: CompanionUseKind[];
  companions: ManagedCompanion[];
  linkable: LinkableCompanionList | null;
  /** Sources that could not be read; the list says so instead of looking complete. */
  failed: PeopleSourceId[];
  loading: boolean;
  /** Cross-server sharing is on and the server offers it. */
  remoteAvailable: boolean;
  reload: () => Promise<void>;
}

/**
 * Loads everything "Personen" merges. A source behind a closed beta gate is never asked; one that
 * fails is named in `failed` (and logged) while the others still draw.
 */
export function usePeople(): PeopleState {
  const { isFeatureVisible } = useBetaFeatures();
  const isDemo = useIsDemoAccount();
  const federated = isFeatureVisible("federatedTripSharing");
  const comparisonOn = isFeatureVisible("comparison");
  const [sources, setSources] = useState<PeopleSources>({
    companions: null,
    consents: null,
    connections: null,
    pairedPeople: null,
    comparisonPeople: null,
    comparisonRequests: null,
  });
  const [kinds, setKinds] = useState<CompanionUseKind[]>([]);
  const [linkable, setLinkable] = useState<LinkableCompanionList | null>(null);
  const [failed, setFailed] = useState<PeopleSourceId[]>([]);
  const [loading, setLoading] = useState(true);
  const [remoteAvailable, setRemoteAvailable] = useState(false);
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const run = ++latest.current;
    const bad: PeopleSourceId[] = [];
    const guard = async <T>(id: PeopleSourceId, work: () => Promise<T>): Promise<T | null> => {
      try {
        return await work();
      } catch (error) {
        logger.warn(`Settings people: could not load ${id}`, error);
        if (!bad.includes(id)) bad.push(id);
        return null;
      }
    };
    const [managed, accounts, remote, compare] = await Promise.all([
      guard("companions", () => companionsApi.manage()),
      isDemo
        ? Promise.resolve(null)
        : guard("accounts", async () => {
            const [consents, list] = await Promise.all([
              sharingApi.listConsents(),
              sharingApi.listCompanions(),
            ]);
            return { consents, list } as {
              consents: ShareConsentList;
              list: LinkableCompanionList;
            };
          }),
      federated && !isDemo
        ? guard("connections", async () => {
            const status = await sharingRemoteApi.status();
            if (!status.available)
              return {
                available: false,
                connections: [] as Connection[],
                paired: [] as RemotePerson[],
              };
            const [connections, paired] = await Promise.all([
              sharingConnectionsApi.list(),
              sharingRemoteApi.listPeople(),
            ]);
            return { available: true, connections, paired };
          })
        : Promise.resolve(null),
      comparisonOn && !isDemo
        ? guard("comparison", (): Promise<PeopleResponse> => comparisonApi.people())
        : Promise.resolve(null),
    ]);
    if (run !== latest.current) return;
    setSources({
      companions: managed?.companions ?? null,
      consents: accounts?.consents ?? null,
      connections: remote?.connections ?? null,
      pairedPeople: remote?.paired ?? null,
      comparisonPeople: compare?.people ?? null,
      comparisonRequests: compare?.requests ?? null,
    });
    setKinds(managed?.kinds ?? []);
    setLinkable(accounts?.list ?? null);
    setRemoteAvailable(remote?.available ?? false);
    setFailed(bad);
    setLoading(false);
  }, [isDemo, federated, comparisonOn]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const built = useMemo(() => buildPeople(sources), [sources]);
  return {
    ...built,
    kinds,
    companions: sources.companions ? [...sources.companions] : [],
    linkable,
    failed,
    loading,
    remoteAvailable,
    reload,
  };
}
