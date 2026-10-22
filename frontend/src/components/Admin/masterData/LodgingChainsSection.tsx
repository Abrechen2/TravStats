import { useCallback, useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useToastStore } from "../../../store/toastStore";
import { logger } from "../../../lib/logger";
import { Field, Input } from "../../ui/Field";
import Button from "../../ui/Button";
import { token } from "../../ui/tokens";
import {
  adminLodgingChainsApi,
  chainErrorKey,
  type CatalogueChain,
} from "../../../lib/api/adminLodgingChains";
import LodgingChainDialogs, { type ChainAction } from "./LodgingChainDialogs";

/**
 * Admin › Unterkünfte › Hotelketten (forgejo#321): the chain catalogue every
 * account picks from — count, search, add, edit, merge, delete. A user's own
 * chains are not shown: they are that user's.
 *
 * The prototype's "Ortssuche für Hotels: Photon | Nominatim" selector is not
 * here: no such setting exists. Both geocoders' addresses live under Externe
 * Dienste › Karten & Ortssuche, and every lookup uses both.
 */
export default function LodgingChainsSection(): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const [chains, setChains] = useState<CatalogueChain[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [newName, setNewName] = useState("");
  const [newProgram, setNewProgram] = useState("");
  const [creating, setCreating] = useState(false);
  const [action, setAction] = useState<ChainAction | null>(null);

  const load = useCallback(async (search: string, signal?: { cancelled: boolean }) => {
    setLoading(true);
    try {
      const list = await adminLodgingChainsApi.list(search);
      if (signal?.cancelled) return;
      setChains(list.items);
      setTotal(list.total);
      setLoadFailed(false);
    } catch (err) {
      logger.warn("Failed to load lodging chains", err);
      if (!signal?.cancelled) setLoadFailed(true);
    } finally {
      if (!signal?.cancelled) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const signal = { cancelled: false };
    void load(query, signal);
    return () => {
      signal.cancelled = true;
    };
  }, [query, load]);

  const create = async (): Promise<void> => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await adminLodgingChainsApi.create({
        name: newName.trim(),
        loyaltyProgram: newProgram.trim() || null,
      });
      addToast("success", t("admin:lodgingChains.created"));
      setNewName("");
      setNewProgram("");
      await load(query);
    } catch (err) {
      addToast("error", t(chainErrorKey(err)));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div data-testid="admin-lodging-chains-section" className="flex flex-col" style={{ gap: 12 }}>
      <p className="t-caption">{t("admin:lodgingChains.description")}</p>

      <div className="grid grid-cols-1 md:grid-cols-[2fr_2fr_auto] items-end" style={{ gap: 8 }}>
        <Field label={t("admin:lodgingChains.name")} htmlFor="chain-new-name">
          <Input id="chain-new-name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        </Field>
        <Field label={t("admin:lodgingChains.program")} htmlFor="chain-new-program">
          <Input
            id="chain-new-program"
            value={newProgram}
            onChange={(e) => setNewProgram(e.target.value)}
          />
        </Field>
        <Button
          variant="primary"
          disabled={creating || !newName.trim()}
          onClick={() => void create()}
        >
          {creating ? t("common:buttons.saving") : t("admin:lodgingChains.add")}
        </Button>
      </div>

      <Input
        type="search"
        aria-label={t("admin:lodgingChains.search")}
        placeholder={t("admin:lodgingChains.search")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <p className="t-caption" data-testid="lodging-chains-count">
        {t("admin:lodgingChains.count", { count: total })}
      </p>

      {loadFailed ? (
        <p role="alert" className="text-sm" style={{ color: token("bad") }}>
          {t("admin:lodgingChains.loadError")}
        </p>
      ) : loading && chains.length === 0 ? (
        <p className="t-caption">{t("common:loading.default")}</p>
      ) : chains.length === 0 ? (
        <p className="t-caption">{t("admin:lodgingChains.empty")}</p>
      ) : (
        <ul className="divide-y" style={{ borderColor: "var(--color-border)" }}>
          {chains.map((c) => (
            <li
              key={c.id}
              data-testid={`lodging-chain-${c.id}`}
              className="flex flex-wrap items-center justify-between py-2"
              style={{ gap: 8 }}
            >
              <div className="flex min-w-0 items-center" style={{ gap: 8, flex: "1 1 220px" }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 3,
                    flexShrink: 0,
                    background: c.brandColor ?? "var(--ts-surface2)",
                    border: "1px solid var(--ts-border)",
                  }}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium" style={{ color: "var(--ts-text-bright)" }}>
                    {c.name}
                  </span>
                  <span className="t-caption">
                    {[
                      c.loyaltyProgram,
                      t("admin:lodgingChains.links", {
                        lodgings: c.lodgingCount,
                        memberships: c.membershipCount,
                      }),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </div>
              <div className="flex flex-wrap" style={{ gap: 6 }}>
                <Button onClick={() => setAction({ kind: "edit", chain: c })}>
                  {t("admin:lodgingChains.edit")}
                </Button>
                <Button onClick={() => setAction({ kind: "merge", chain: c })}>
                  {t("admin:lodgingChains.merge")}
                </Button>
                <Button onClick={() => setAction({ kind: "delete", chain: c })}>
                  {t("admin:lodgingChains.delete")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {total > chains.length && (
        <p className="t-caption">
          {t("admin:masterData.showingOf", { shown: chains.length, total })}
        </p>
      )}

      <LodgingChainDialogs
        action={action}
        onClose={() => setAction(null)}
        onDone={() => {
          setAction(null);
          void load(query);
        }}
      />
    </div>
  );
}
