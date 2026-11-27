import { useCallback, useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useIsDemoAccount } from "../../../hooks/useIsDemoAccount";
import Button from "../../ui/Button";
import { Field, Input, Select, Switch } from "../../ui/Field";
import { SettingRows } from "../../ui/SettingRow";
import { ConfirmDialog, SettingItem } from "../../ui/settings";
import { SectionCard } from "../SettingsShared";
import {
  pluginRequestFailureKey,
  suggestionPluginsApi,
  type PluginPrecision,
  type SuggestionPlugin,
} from "../../../lib/api/suggestionPlugins";
import PluginCard from "./PluginCard";
import SecretOnce from "./SecretOnce";
import InlineError from "../../ui/InlineError";

const NS = "suggestionSources:plugins";
const MAX_PLUGINS = 5;

/**
 * Settings → TravTrack → Erkennung → Externe Vorschlagsquellen (spec 2026-11-23,
 * Part B): the account's plugins, what is sent to them, and how to add one.
 */
export default function PluginsSection(): JSX.Element {
  const { t } = useTranslation(["suggestionSources"]);
  const isDemo = useIsDemoAccount();
  const [plugins, setPlugins] = useState<SuggestionPlugin[] | null>(null);
  const [blocked, setBlocked] = useState<"internet_off" | "service_off" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [precision, setPrecision] = useState<PluginPrecision>("100m");
  const [backfillAllowed, setBackfillAllowed] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [removing, setRemoving] = useState<SuggestionPlugin | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await suggestionPluginsApi.list();
      setPlugins(r.plugins);
      setBlocked(r.blocked);
    } catch (e) {
      console.warn("plugins could not be loaded", e);
      setError(`suggestionSources:${pluginRequestFailureKey(e)}`);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await suggestionPluginsApi.add({ name, url, precision, backfillAllowed });
      setSecret(r.secret);
      setAdding(false);
      setName("");
      setUrl("");
      await load();
    } catch (e) {
      console.warn("plugin could not be added", e);
      setError(`suggestionSources:${pluginRequestFailureKey(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: SuggestionPlugin) => {
    setRemoving(null);
    try {
      await suggestionPluginsApi.remove(p.id);
    } catch (e) {
      console.warn("plugin could not be removed", e);
      setError(`suggestionSources:${pluginRequestFailureKey(e)}`);
    }
    await load();
  };

  return (
    <SectionCard>
      <SettingRows>
        <SettingItem title={t(`${NS}.title`)} sub={t(`${NS}.sub`)} help={t(`${NS}.help`)}>
          <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
            {blocked && <InlineError>{t(`${NS}.blocked.${blocked}`)}</InlineError>}
            {error && <InlineError>{t(error)}</InlineError>}
            {secret && <SecretOnce secret={secret} onDone={() => setSecret(null)} />}
            {plugins?.length === 0 && <p className="t-body">{t(`${NS}.empty`)}</p>}
            {plugins?.map((p) => (
              <PluginCard
                key={p.id}
                plugin={p}
                disabled={isDemo}
                onChanged={() => void load()}
                onRemove={() => setRemoving(p)}
              />
            ))}
            {adding ? (
              <form
                className="flex flex-col"
                style={{ gap: "var(--ts-space-md)" }}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (name && url && !busy) void add();
                }}
              >
                <Field label={t(`${NS}.form.name`)} htmlFor="plugin-name">
                  <Input
                    id="plugin-name"
                    value={name}
                    maxLength={60}
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>
                <Field
                  label={t(`${NS}.form.url`)}
                  htmlFor="plugin-url"
                  hint={t(`${NS}.form.urlHint`)}
                >
                  <Input
                    id="plugin-url"
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                </Field>
                <Field label={t(`${NS}.precision.label`)} htmlFor="plugin-precision">
                  <Select
                    id="plugin-precision"
                    value={precision}
                    onChange={(e) => setPrecision(e.target.value as PluginPrecision)}
                  >
                    <option value="exact">{t(`${NS}.precision.exact`)}</option>
                    <option value="100m">{t(`${NS}.precision.100m`)}</option>
                    <option value="1km">{t(`${NS}.precision.1km`)}</option>
                  </Select>
                </Field>
                <Switch
                  id="plugin-backfill"
                  checked={backfillAllowed}
                  onChange={setBackfillAllowed}
                  label={t(`${NS}.backfillAllowed`)}
                />
                <div className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
                  <Button type="submit" variant="primary" disabled={!name || !url || busy}>
                    {t(`${NS}.form.save`)}
                  </Button>
                  <Button onClick={() => setAdding(false)}>{t(`${NS}.form.cancel`)}</Button>
                </div>
              </form>
            ) : (
              <div>
                <Button
                  disabled={isDemo || (plugins?.length ?? 0) >= MAX_PLUGINS}
                  onClick={() => setAdding(true)}
                >
                  {t(`${NS}.add`)}
                </Button>
              </div>
            )}
          </div>
        </SettingItem>
        <SettingItem
          title={t(`${NS}.sent.title`)}
          sub={t(`${NS}.sent.sub`)}
          help={t(`${NS}.sent.help`)}
        />
      </SettingRows>
      <ConfirmDialog
        open={removing !== null}
        title={t(`${NS}.removeConfirm.title`, { name: removing?.name ?? "" })}
        affects={t(`${NS}.removeConfirm.affects`)}
        amount={removing?.name ?? ""}
        after={t(`${NS}.removeConfirm.after`)}
        confirmLabel={t(`${NS}.remove`)}
        onConfirm={() => removing && void remove(removing)}
        onCancel={() => setRemoving(null)}
      />
    </SectionCard>
  );
}
