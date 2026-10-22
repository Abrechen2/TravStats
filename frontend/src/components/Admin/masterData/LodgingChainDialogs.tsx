import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useDebouncedValue } from "../../../hooks/useDebouncedValue";
import { useToastStore } from "../../../store/toastStore";
import Dialog from "../../ui/Dialog";
import Button from "../../ui/Button";
import { Field, Input, Select } from "../../ui/Field";
import { token } from "../../ui/tokens";
import {
  adminLodgingChainsApi,
  chainErrorKey,
  type CatalogueChain,
} from "../../../lib/api/adminLodgingChains";

export type ChainAction = { kind: "edit" | "merge" | "delete"; chain: CatalogueChain };

interface Props {
  action: ChainAction | null;
  onClose: () => void;
  /** The catalogue changed: reload it. */
  onDone: () => void;
}

/**
 * The three things that change a catalogue chain, each a dialog that says
 * what happens to the hotels and cards linked to it before anything does.
 */
export default function LodgingChainDialogs({
  action,
  onClose,
  onDone,
}: Props): JSX.Element | null {
  if (!action) return null;
  if (action.kind === "edit")
    return <EditDialog chain={action.chain} onClose={onClose} onDone={onDone} />;
  if (action.kind === "merge") {
    return <MergeDialog chain={action.chain} onClose={onClose} onDone={onDone} />;
  }
  return <DeleteDialog chain={action.chain} onClose={onClose} onDone={onDone} />;
}

interface DialogProps {
  chain: CatalogueChain;
  onClose: () => void;
  onDone: () => void;
}

function useRunner(onDone: () => void): {
  busy: boolean;
  error: string | null;
  run: (work: () => Promise<unknown>, success: string) => Promise<void>;
} {
  const { t } = useTranslation(["admin"]);
  const addToast = useToastStore((s) => s.addToast);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<unknown>, success: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await work();
      addToast("success", success);
      onDone();
    } catch (err) {
      // Said in the dialog, beside what was being attempted.
      setError(t(chainErrorKey(err)));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function ErrorLine({ error }: { error: string | null }): JSX.Element | null {
  return error ? (
    <p role="alert" className="text-sm" style={{ color: token("bad") }}>
      {error}
    </p>
  ) : null;
}

function EditDialog({ chain, onClose, onDone }: DialogProps): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);
  const { busy, error, run } = useRunner(onDone);
  const [name, setName] = useState(chain.name);
  const [program, setProgram] = useState(chain.loyaltyProgram ?? "");
  const [color, setColor] = useState(chain.brandColor ?? "");
  const dirty =
    name !== chain.name ||
    program !== (chain.loyaltyProgram ?? "") ||
    color !== (chain.brandColor ?? "");

  return (
    <Dialog
      open
      onClose={onClose}
      busy={busy}
      dirty={dirty}
      title={t("admin:lodgingChains.editTitle", { name: chain.name })}
      action={
        <Button
          variant="primary"
          disabled={busy || !name.trim() || !dirty}
          onClick={() =>
            void run(
              () =>
                adminLodgingChainsApi.update(chain.id, {
                  name: name.trim(),
                  loyaltyProgram: program.trim() || null,
                  brandColor: color.trim() || null,
                }),
              t("admin:lodgingChains.saved")
            )
          }
        >
          {busy ? t("common:buttons.saving") : t("common:buttons.save")}
        </Button>
      }
    >
      <div className="flex flex-col" style={{ gap: 12 }}>
        {chain.lodgingCount + chain.membershipCount > 0 && (
          <p className="t-caption">
            {t("admin:lodgingChains.renameNote", {
              lodgings: chain.lodgingCount,
              memberships: chain.membershipCount,
            })}
          </p>
        )}
        <Field label={t("admin:lodgingChains.name")} htmlFor="chain-edit-name">
          <Input id="chain-edit-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t("admin:lodgingChains.program")} htmlFor="chain-edit-program">
          <Input
            id="chain-edit-program"
            value={program}
            onChange={(e) => setProgram(e.target.value)}
          />
        </Field>
        <Field
          label={t("admin:lodgingChains.color")}
          htmlFor="chain-edit-color"
          hint={t("admin:lodgingChains.colorHint")}
        >
          <Input
            id="chain-edit-color"
            value={color}
            placeholder="#rrggbb"
            onChange={(e) => setColor(e.target.value)}
          />
        </Field>
        <ErrorLine error={error} />
      </div>
    </Dialog>
  );
}

function MergeDialog({ chain, onClose, onDone }: DialogProps): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);
  const { busy, error, run } = useRunner(onDone);
  // The list endpoint answers one page (200), so the target is searched on
  // the server: a chain past the first page must still be reachable.
  const [query, setQuery] = useState("");
  const search = useDebouncedValue(query);
  const [found, setFound] = useState<{ items: CatalogueChain[]; total: number } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [target, setTarget] = useState<CatalogueChain | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFound(null);
    setLoadFailed(false);
    adminLodgingChainsApi
      .list(search)
      .then((list) => {
        if (!cancelled) setFound(list);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [search]);

  const targets = found?.items.filter((c) => c.id !== chain.id) ?? null;
  // The chosen target stays offered while another search runs.
  const options =
    target && !targets?.some((c) => c.id === target.id) ? [target, ...(targets ?? [])] : targets;

  return (
    <Dialog
      open
      onClose={onClose}
      busy={busy}
      title={t("admin:lodgingChains.mergeTitle", { name: chain.name })}
      action={
        <Button
          variant="primary"
          disabled={busy || !target}
          onClick={() =>
            target &&
            void run(
              () => adminLodgingChainsApi.merge(chain.id, target.id),
              t("admin:lodgingChains.merged", { name: target.name })
            )
          }
        >
          {t("admin:lodgingChains.mergeConfirm")}
        </Button>
      }
    >
      <div className="flex flex-col" style={{ gap: 12 }}>
        <Input
          type="search"
          aria-label={t("admin:lodgingChains.mergeSearch")}
          placeholder={t("admin:lodgingChains.mergeSearch")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Field label={t("admin:lodgingChains.mergeTarget")} htmlFor="chain-merge-target">
          <Select
            id="chain-merge-target"
            value={target ? String(target.id) : ""}
            disabled={!options}
            onChange={(e) =>
              setTarget(options?.find((c) => String(c.id) === e.target.value) ?? null)
            }
          >
            <option value="">{t("admin:lodgingChains.mergeChoose")}</option>
            {(options ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        {loadFailed ? (
          <p role="alert" className="text-sm" style={{ color: token("bad") }}>
            {t("admin:lodgingChains.mergeSearchError")}
          </p>
        ) : !found ? (
          <p role="status" className="text-sm" style={{ color: token("muted") }}>
            {t("admin:lodgingChains.mergeSearching")}
          </p>
        ) : found.total > found.items.length ? (
          <p className="text-sm" style={{ color: token("muted") }}>
            {t("admin:lodgingChains.mergeMore", { shown: found.items.length, total: found.total })}
          </p>
        ) : null}
        {target && (
          <p className="text-sm">
            {t("admin:lodgingChains.mergeExplain", {
              source: chain.name,
              target: target.name,
              lodgings: chain.lodgingCount,
              memberships: chain.membershipCount,
            })}
          </p>
        )}
        <ErrorLine error={error} />
      </div>
    </Dialog>
  );
}

function DeleteDialog({ chain, onClose, onDone }: DialogProps): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);
  const { busy, error, run } = useRunner(onDone);
  const inUse = chain.lodgingCount + chain.membershipCount > 0;

  return (
    <Dialog
      open
      onClose={onClose}
      busy={busy}
      title={t("admin:lodgingChains.deleteTitle", { name: chain.name })}
      action={
        inUse ? undefined : (
          <Button
            variant="danger"
            disabled={busy}
            onClick={() =>
              void run(
                () => adminLodgingChainsApi.remove(chain.id),
                t("admin:lodgingChains.deleted")
              )
            }
          >
            {t("admin:lodgingChains.delete")}
          </Button>
        )
      }
    >
      <div className="flex flex-col" style={{ gap: 12 }}>
        <p className="text-sm">
          {inUse
            ? t("admin:lodgingChains.deleteInUse", {
                lodgings: chain.lodgingCount,
                memberships: chain.membershipCount,
              })
            : t("admin:lodgingChains.deleteExplain")}
        </p>
        <ErrorLine error={error} />
      </div>
    </Dialog>
  );
}
