import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import {
  externalServicesApi,
  type AccountExternalServices,
  type AccountService,
  type AccountServiceUpdate,
} from "../../lib/api/externalServices";
import type { RowFeedback } from "./AdminServiceRow";
import { failureText, testReasonText } from "./serviceText";

export interface AccountServices {
  data: AccountExternalServices | null;
  loadError: string | null;
  busyId: string | null;
  feedback: Record<string, RowFeedback>;
  reload: () => Promise<AccountExternalServices | null>;
  /** Saves, then says how the server's own test of the new credential went. */
  save: (id: string, body: AccountServiceUpdate, announceTest: boolean) => Promise<boolean>;
  setConsent: (
    service: { id: string; provider: string },
    consent: boolean
  ) => Promise<string | null>;
}

function findService(data: AccountExternalServices | null, id: string): AccountService | undefined {
  return [...(data?.connections ?? []), ...(data?.ownKeys ?? [])].find((s) => s.id === id);
}

/**
 * The account page's calls. Every failure stays on the row it belongs to and
 * leaves the page as it was; the page never claims "gespeichert" before the
 * server said so, and after a save it reports the server's test of the new
 * credential, because a key that was stored but does not work is not a success.
 */
export function useAccountServices(): AccountServices {
  const { t } = useTranslation(["externalServices"]);
  const [data, setData] = useState<AccountExternalServices | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, RowFeedback>>({});
  const tRef = useRef(t);
  tRef.current = t;

  const reload = useCallback(async (): Promise<AccountExternalServices | null> => {
    try {
      const next = await externalServicesApi.accountOverview();
      setData(next);
      setLoadError(null);
      return next;
    } catch (err) {
      setLoadError(failureText(tRef.current, err, "errors.loadFailed"));
      return null;
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

  const save = async (
    id: string,
    body: AccountServiceUpdate,
    announceTest: boolean
  ): Promise<boolean> => {
    setBusyId(id);
    note(id, null);
    try {
      await externalServicesApi.accountUpdate(id, body);
    } catch (err) {
      note(id, { kind: "error", text: failureText(t, err, "errors.saveFailed") });
      setBusyId(null);
      return false;
    }
    const fresh = await reload();
    const test = announceTest ? findService(fresh, id)?.lastTest : null;
    if (test && !test.ok) {
      note(id, {
        kind: "error",
        text: t("externalServices:account.savedButFailed", {
          reason: testReasonText(t, test.reason),
        }),
      });
    } else if (announceTest) {
      note(id, { kind: "ok", text: t("externalServices:account.savedAndTested") });
    }
    setBusyId(null);
    return true;
  };

  const setConsent = async (
    service: { id: string; provider: string },
    consent: boolean
  ): Promise<string | null> => {
    setBusyId(service.id);
    note(service.id, null);
    try {
      await externalServicesApi.accountSetAiConsent(service.provider, consent);
      await reload();
      return null;
    } catch (err) {
      const text = failureText(t, err, "errors.saveFailed");
      note(service.id, { kind: "error", text });
      return text;
    } finally {
      setBusyId(null);
    }
  };

  return { data, loadError, busyId, feedback, reload, save, setConsent };
}
