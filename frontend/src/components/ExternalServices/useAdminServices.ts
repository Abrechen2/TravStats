import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import {
  externalServicesApi,
  type AdminExternalServices,
  type AdminServiceUpdate,
  type ConnectionId,
} from "../../lib/api/externalServices";
import type { RowFeedback } from "./AdminServiceRow";
import { failureText, isServiceDisabledError, testReasonText } from "./serviceText";

export interface AdminServices {
  data: AdminExternalServices | null;
  loadError: string | null;
  isBusy: (id: string) => boolean;
  feedback: Record<string, RowFeedback>;
  reload: () => Promise<void>;
  test: (id: string) => Promise<void>;
  save: (id: string, changes: Record<string, unknown>) => Promise<void>;
  setEnabled: (
    id: string,
    enabled: boolean,
    confirmDataSharing?: boolean
  ) => Promise<string | null>;
  setAllowAccountKeys: (id: string, allowed: boolean) => Promise<void>;
  setConnection: (id: ConnectionId, allowed: boolean) => Promise<void>;
}

/**
 * Everything the admin page does to the server, with the failure of each call
 * said on the row it belongs to. A call that fails keeps what the page showed;
 * a call that succeeds reloads the overview, because the status of a service
 * (enabled, configured, last test) is derived on the server and the page must
 * not guess it.
 */
export function useAdminServices(): AdminServices {
  const { t } = useTranslation(["externalServices"]);
  const [data, setData] = useState<AdminExternalServices | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, number>>({});
  /** Per id: two rows may work at once, and one finishing must not unlock the other. */
  const begin = (id: string): void => setPending((p) => ({ ...p, [id]: (p[id] ?? 0) + 1 }));
  const end = (id: string): void =>
    setPending((p) => ({ ...p, [id]: Math.max(0, (p[id] ?? 1) - 1) }));
  const isBusy = (id: string): boolean => (pending[id] ?? 0) > 0;
  const [feedback, setFeedback] = useState<Record<string, RowFeedback>>({});
  const tRef = useRef(t);
  tRef.current = t;

  const reload = useCallback(async (): Promise<void> => {
    try {
      setData(await externalServicesApi.adminOverview());
      setLoadError(null);
    } catch (err) {
      setLoadError(failureText(tRef.current, err, "errors.loadFailed"));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const note = (id: string, next: RowFeedback | null): void =>
    setFeedback((prev) => {
      const rest = { ...prev };
      delete rest[id];
      return next ? { ...rest, [id]: next } : rest;
    });

  const withBusy = async (id: string, work: () => Promise<void>): Promise<void> => {
    begin(id);
    try {
      await work();
    } finally {
      end(id);
    }
  };

  const runTest = async (id: string): Promise<void> => {
    try {
      const result = await externalServicesApi.adminTest(id);
      note(
        id,
        result.ok
          ? {
              kind: "ok",
              text: t(
                result.usedQuota
                  ? "externalServices:test.resultOkQuota"
                  : "externalServices:test.resultOk"
              ),
            }
          : {
              kind: "error",
              text: t("externalServices:test.resultFailed", {
                reason: testReasonText(t, result.reason),
              }),
            }
      );
    } catch (err) {
      note(
        id,
        isServiceDisabledError(err)
          ? { kind: "info", text: t("externalServices:test.disabledNoCall") }
          : { kind: "error", text: failureText(t, err, "errors.testFailed") }
      );
    }
  };

  const test = (id: string): Promise<void> =>
    withBusy(id, async () => {
      note(id, null);
      await runTest(id);
      await reload();
    });

  const save = (id: string, changes: Record<string, unknown>): Promise<void> =>
    withBusy(id, async () => {
      note(id, null);
      if (Object.keys(changes).length > 0) {
        try {
          await externalServicesApi.adminUpdate(id, { fields: changes });
        } catch (err) {
          note(id, { kind: "error", text: failureText(t, err, "errors.saveFailed") });
          return;
        }
      }
      await runTest(id);
      await reload();
    });

  const setEnabled = async (
    id: string,
    enabled: boolean,
    confirmDataSharing = false
  ): Promise<string | null> => {
    begin(id);
    note(id, null);
    const body: AdminServiceUpdate = confirmDataSharing
      ? { enabled, confirmDataSharing }
      : { enabled };
    try {
      await externalServicesApi.adminUpdate(id, body);
      await reload();
      return null;
    } catch (err) {
      const text = failureText(t, err, "errors.saveFailed");
      note(id, { kind: "error", text });
      return text;
    } finally {
      end(id);
    }
  };

  const setAllowAccountKeys = (id: string, allowed: boolean): Promise<void> =>
    withBusy(id, async () => {
      note(id, null);
      try {
        await externalServicesApi.adminUpdate(id, { allowAccountKeys: allowed });
        await reload();
      } catch (err) {
        note(id, { kind: "error", text: failureText(t, err, "errors.saveFailed") });
      }
    });

  const setConnection = (id: ConnectionId, allowed: boolean): Promise<void> =>
    withBusy(`connection:${id}`, async () => {
      note(`connection:${id}`, null);
      try {
        await externalServicesApi.adminSetConnection(id, allowed);
        await reload();
      } catch (err) {
        note(`connection:${id}`, { kind: "error", text: failureText(t, err, "errors.saveFailed") });
      }
    });

  return {
    data,
    loadError,
    isBusy,
    feedback,
    reload,
    test,
    save,
    setEnabled,
    setAllowAccountKeys,
    setConnection,
  };
}
