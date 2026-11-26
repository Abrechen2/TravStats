import { useState, type JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../../hooks/useTranslation";
import { Switch } from "../../ui/Field";
import {
  pluginRequestFailureKey,
  suggestionPluginsApi,
  type PluginListState,
} from "../../../lib/api/suggestionPlugins";

const NS = "suggestionSources:plugins.list";

/**
 * "Orte dieses Plugins als Liste führen": a list of the places of this plugin's accepted
 * suggestions. On by default when the plugin's hello announces a list; off keeps the list.
 */
export default function PluginListSwitch({
  pluginId,
  state,
  disabled,
  onChange,
}: {
  pluginId: string;
  state: PluginListState;
  disabled: boolean;
  onChange: (next: PluginListState) => void;
}): JSX.Element {
  const { t, i18n } = useTranslation(["suggestionSources"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (enabled: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      onChange(
        await suggestionPluginsApi.setList(
          pluginId,
          enabled,
          i18n?.language?.startsWith("en") ? "en" : "de"
        )
      );
    } catch (e: unknown) {
      const key = pluginRequestFailureKey(e);
      console.warn("plugin list switch failed", key);
      setError(key);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col" style={{ gap: 2 }} data-testid="plugin-list-switch">
      <Switch
        id={`plugin-list-${pluginId}`}
        checked={state.enabled}
        disabled={disabled || busy}
        onChange={(on) => void toggle(on)}
        label={t(`${NS}.label`)}
        sub={state.announced ? undefined : t(`${NS}.generic`)}
      />
      {state.enabled && state.listId && (
        <Link className="t-caption" to={`/places/lists/${state.listId}`}>
          {t(`${NS}.open`, { name: state.listName ?? "" })}
        </Link>
      )}
      {error && (
        <p className="t-caption" role="alert" style={{ color: "var(--ts-bad)" }}>
          {t(`${NS}.failed`)}: {t(`suggestionSources:${error}`)}
        </p>
      )}
    </div>
  );
}
