import { useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { purposeApi, type CustomPurposeEntry } from "../../lib/api/purpose";
import { apiErrorMachineCode } from "../../lib/apiError";
import { logger } from "../../lib/logger";
import { PurposeGlyph } from "../purpose/PurposeGlyph";
import { PurposeIconPicker } from "../purpose/PurposeIconPicker";
import { usePurposeCatalogue, usePurposeCatalogueStore } from "../../store/purposeCatalogueStore";
import { PURPOSES, type Purpose } from "../../shared/purpose";
import { BUILTIN_PREFIX } from "../../shared/purposeCatalogue";
import { SectionCard } from "./SettingsShared";
import { DEFAULT_CUSTOM_PURPOSE_COLOR } from "../../theme/purposeColors";

const COARSE = "pointer-coarse:min-h-(--ts-size-touch-min)";

interface Draft {
  name: string;
  nameEn: string;
  kind: Purpose;
  color: string;
  icon: string;
}

const EMPTY: Draft = {
  name: "",
  nameEn: "",
  kind: "private",
  color: DEFAULT_CUSTOM_PURPOSE_COLOR,
  icon: "star",
};

/**
 * "Reisezwecke": the built-in purposes (read-only, each with its kind) and the user's own —
 * create, rename, recolour, change the kind, archive. Deleting is offered only while no entry
 * uses a purpose; otherwise the server answers `PURPOSE_IN_USE` and the row says "archivieren".
 * Every failure is said on the section, never swallowed.
 */
export default function PurposeCatalogueSection(): JSX.Element {
  const { t } = useTranslation(["purpose", "common"]);
  const isDemo = useIsDemoAccount();
  const catalogue = usePurposeCatalogue();
  const refresh = usePurposeCatalogueStore((s) => s.refresh);
  const loadFailed = usePurposeCatalogueStore((s) => s.failed);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState<{ id: string; draft: Draft } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (what: string, action: () => Promise<unknown>): Promise<boolean> => {
    setError(null);
    setBusy(true);
    try {
      await action();
      await refresh();
      return true;
    } catch (err) {
      const code = apiErrorMachineCode(err);
      logger.warn(`purposes: ${what} failed`, { code, err });
      setError(code === "PURPOSE_IN_USE" ? t("purpose:custom.inUse") : t("purpose:custom.error"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const toInput = (d: Draft) => ({
    name: d.name.trim(),
    nameEn: d.nameEn.trim() || null,
    kind: d.kind,
    color: d.color,
    icon: d.icon,
  });

  const create = async (): Promise<void> => {
    if (!draft.name.trim()) return;
    if (await run("create", () => purposeApi.createCustom(toInput(draft)))) setDraft(EMPTY);
  };

  const save = async (): Promise<void> => {
    if (!editing || !editing.draft.name.trim()) return;
    const { id, draft: d } = editing;
    if (await run("update", () => purposeApi.updateCustom(id, toInput(d)))) setEditing(null);
  };

  const fields = (d: Draft, set: (next: Draft) => void, idPrefix: string): JSX.Element => (
    <div className="flex flex-wrap items-end gap-2">
      <label className="t-caption flex flex-col">
        {t("purpose:custom.name")}
        <input
          id={`${idPrefix}-name`}
          value={d.name}
          maxLength={60}
          onChange={(e) => set({ ...d, name: e.target.value })}
          className={COARSE}
        />
      </label>
      <label className="t-caption flex flex-col">
        {t("purpose:custom.nameEn")}
        <input
          id={`${idPrefix}-name-en`}
          value={d.nameEn}
          maxLength={60}
          onChange={(e) => set({ ...d, nameEn: e.target.value })}
          className={COARSE}
        />
      </label>
      <label className="t-caption flex flex-col">
        {t("purpose:custom.kind")}
        <select
          value={d.kind}
          onChange={(e) => set({ ...d, kind: e.target.value as Purpose })}
          className={COARSE}
        >
          {PURPOSES.map((k) => (
            <option key={k} value={k}>
              {t(`purpose:kind.${k}`)}
            </option>
          ))}
        </select>
      </label>
      <div className="t-caption flex flex-col">
        {t("purpose:custom.icon")}
        <PurposeIconPicker
          value={d.icon}
          onChange={(icon) => set({ ...d, icon })}
          className={COARSE}
        />
      </div>
      <label className="t-caption flex flex-col">
        {t("purpose:custom.color")}
        <input
          type="color"
          value={d.color}
          onChange={(e) => set({ ...d, color: e.target.value })}
          className={COARSE}
        />
      </label>
    </div>
  );

  const row = (c: CustomPurposeEntry): JSX.Element => {
    if (editing?.id === c.id) {
      return (
        <li key={c.id} data-testid={`custom-purpose-${c.id}`} className="flex flex-col gap-2">
          {fields(editing.draft, (d) => setEditing({ id: c.id, draft: d }), `edit-${c.id}`)}
          <div className="flex gap-2">
            <button type="button" className={`underline ${COARSE}`} onClick={() => void save()}>
              {t("common:buttons.save")}
            </button>
            <button
              type="button"
              className={`underline ${COARSE}`}
              onClick={() => setEditing(null)}
            >
              {t("common:buttons.cancel")}
            </button>
          </div>
        </li>
      );
    }
    return (
      <li
        key={c.id}
        data-testid={`custom-purpose-${c.id}`}
        className="flex flex-wrap items-center gap-2"
      >
        <span style={{ color: c.color }}>
          <PurposeGlyph icon={c.icon} />
        </span>
        <span className="font-semibold">{c.name}</span>
        {c.nameEn && <span className="t-caption">({c.nameEn})</span>}
        <span className="t-caption">{t(`purpose:kind.${c.kind}`)}</span>
        <span className="t-caption">{t("purpose:custom.usage", { count: c.usage })}</span>
        {c.archived && <span className="t-caption">{t("purpose:custom.archivedTag")}</span>}
        {!isDemo && (
          <>
            <button
              type="button"
              disabled={busy}
              className={`underline ${COARSE}`}
              onClick={() =>
                setEditing({
                  id: c.id,
                  draft: {
                    name: c.name,
                    nameEn: c.nameEn ?? "",
                    kind: c.kind,
                    color: c.color,
                    icon: c.icon,
                  },
                })
              }
            >
              {t("purpose:custom.edit")}
            </button>
            <button
              type="button"
              disabled={busy}
              className={`underline ${COARSE}`}
              onClick={() =>
                void run("archive", () => purposeApi.updateCustom(c.id, { archived: !c.archived }))
              }
            >
              {c.archived ? t("purpose:custom.unarchive") : t("purpose:custom.archive")}
            </button>
            {/* Deleting only while unused: a used purpose is archived instead. */}
            {c.usage === 0 && (
              <button
                type="button"
                disabled={busy}
                className={`underline ${COARSE}`}
                onClick={() => void run("delete", () => purposeApi.deleteCustom(c.id))}
              >
                {t("purpose:custom.delete")}
              </button>
            )}
          </>
        )}
      </li>
    );
  };

  return (
    <SectionCard>
      <h3 className="t-h3">{t("purpose:custom.title")}</h3>
      <p className="t-caption">{t("purpose:custom.intro")}</p>
      {PURPOSES.map((kind) => (
        <div key={kind} style={{ marginTop: "var(--ts-space-sm)" }}>
          <p className="t-caption font-semibold">{t(`purpose:kind.${kind}`)}</p>
          <ul className="flex flex-wrap gap-2" data-testid={`builtin-purposes-${kind}`}>
            {catalogue.builtins
              .filter((b) => b.kind === kind)
              .map((b) => (
                <li
                  key={b.key}
                  className="t-caption"
                  style={{
                    border: `1px solid ${b.color}`,
                    borderRadius: 999,
                    padding: "0 var(--ts-space-sm)",
                  }}
                >
                  <PurposeGlyph icon={b.icon} />{" "}
                  {t(`purpose:builtin.${b.key.slice(BUILTIN_PREFIX.length)}`)}
                </li>
              ))}
          </ul>
        </div>
      ))}
      <p className="t-caption font-semibold" style={{ marginTop: "var(--ts-space-md)" }}>
        {t("purpose:custom.own")}
      </p>
      {catalogue.custom.length === 0 ? (
        <p className="t-caption">{t("purpose:custom.none")}</p>
      ) : (
        <ul className="flex flex-col gap-2">{catalogue.custom.map(row)}</ul>
      )}
      {!isDemo && (
        <div style={{ marginTop: "var(--ts-space-md)" }} className="flex flex-col gap-2">
          {fields(draft, setDraft, "new-purpose")}
          <button
            type="button"
            disabled={busy || !draft.name.trim()}
            className={`underline self-start ${COARSE}`}
            onClick={() => void create()}
          >
            {t("purpose:custom.add")}
          </button>
        </div>
      )}
      {loadFailed && (
        <p role="alert" className="t-caption">
          {t("purpose:custom.loadError")}{" "}
          <button type="button" className={`underline ${COARSE}`} onClick={() => void refresh()}>
            {t("common:buttons.retry")}
          </button>
        </p>
      )}
      {error && (
        <p role="alert" className="t-caption">
          {error}
        </p>
      )}
    </SectionCard>
  );
}
