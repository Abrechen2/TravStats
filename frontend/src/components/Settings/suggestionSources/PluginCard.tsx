import DateField from "../../../components/ui/DateField";
import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useDisplayFormat } from "../../../lib/format";
import Button from "../../ui/Button";
import { Field, Select, Switch } from "../../ui/Field";
import { waitForJob, JobFailedError } from "../../../lib/api/jobs";
import {
  pluginFailureKey,
  pluginRequestFailureKey,
  suggestionPluginsApi,
  type PluginPrecision,
  type SuggestionPlugin,
} from "../../../lib/api/suggestionPlugins";
import SecretOnce from "./SecretOnce";
import PluginMaintenanceDialog from "./PluginMaintenanceDialog";

const NS = "suggestionSources:plugins";
const MAX_BACKFILL_DAYS = 90;
const DAY_MS = 86_400_000;

type Line = { ok: boolean; text: string };

interface BackfillResult {
  days: number;
  asked: number;
  known: number;
  created: number;
  merged: number;
  failed: Record<string, number>;
  stoppedAt: string | null;
}

/** One plugin: its switches, its last answer, the test, the secret, the backfill. */
export default function PluginCard({
  plugin,
  disabled,
  onChanged,
  onRemove,
}: {
  plugin: SuggestionPlugin;
  disabled: boolean;
  onChanged: () => void;
  onRemove: () => void;
}): JSX.Element {
  const { t } = useTranslation(["suggestionSources"]);
  const fmt = useDisplayFormat();
  const [line, setLine] = useState<Line | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // "Standorte pflegen" only for a plugin whose hello announces `maintenance`.
  const [maintenance, setMaintenance] = useState<{ offered: boolean; error: string | null }>({
    offered: false,
    error: null,
  });
  const [maintaining, setMaintaining] = useState(false);

  useEffect(() => {
    if (!plugin.enabled || disabled) {
      setMaintenance({ offered: false, error: null });
      return;
    }
    let live = true;
    suggestionPluginsApi
      .capabilities(plugin.id)
      .then((c) => live && setMaintenance({ offered: c.maintenance, error: c.error }))
      .catch((e: unknown) => {
        // Visible below the card: a capability we could not read is not "none".
        const key = pluginRequestFailureKey(e);
        console.warn("plugin capabilities failed", key);
        if (live) setMaintenance({ offered: false, error: key });
      });
    return () => {
      live = false;
    };
  }, [plugin.id, plugin.enabled, plugin.url, disabled]);

  const run = async (work: () => Promise<Line | void>) => {
    setBusy(true);
    setLine(null);
    try {
      const l = await work();
      if (l) setLine(l);
    } catch (e) {
      const key = pluginRequestFailureKey(e);
      console.warn("plugin request failed", key);
      setLine({ ok: false, text: t(`suggestionSources:${key}`) });
    } finally {
      setBusy(false);
      onChanged();
    }
  };

  const update = (patch: Parameters<typeof suggestionPluginsApi.update>[1]) =>
    run(async () => {
      await suggestionPluginsApi.update(plugin.id, patch);
    });

  const test = () =>
    run(async () => {
      const r = await suggestionPluginsApi.test(plugin.id);
      return {
        ok: true,
        text: t(`${NS}.test.${r.outcome}`, {
          ms: r.latencyMs,
          version: r.version ?? "—",
          first: r.first?.name ?? "",
        }),
      };
    });

  const backfill = () =>
    run(async () => {
      const jobId = await suggestionPluginsApi.backfill(plugin.id, from, to);
      setLine({ ok: true, text: t(`${NS}.backfill.running`) });
      try {
        const r = await waitForJob<BackfillResult>(jobId, { intervalMs: 5000 });
        const failed = Object.values(r.failed).reduce((a, b) => a + b, 0);
        return {
          ok: failed === 0 && !r.stoppedAt,
          text:
            t(`${NS}.backfill.done`, {
              days: r.days,
              asked: r.asked,
              created: r.created,
              merged: r.merged,
              failed,
            }) +
            (r.stoppedAt
              ? ` ${t(`${NS}.backfill.stopped`, { at: r.stoppedAt.slice(0, 10) })}`
              : ""),
        };
      } catch (e) {
        if (e instanceof JobFailedError) throw { response: { data: { code: e.code } } };
        throw e;
      }
    });

  const days =
    from && to
      ? Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1
      : 0;
  const rangeOk = days >= 1 && days <= MAX_BACKFILL_DAYS;
  const outcome =
    plugin.lastOutcome && plugin.lastOutcome !== "ok" && plugin.lastOutcome !== "empty"
      ? t(`suggestionSources:${pluginFailureKey(plugin.lastOutcome)}`)
      : null;

  return (
    <div
      className="flex flex-col"
      style={{
        gap: "var(--ts-space-sm)",
        padding: "var(--ts-space-md)",
        border: "1px solid var(--ts-border)",
        borderRadius: "var(--ts-radius-card)",
      }}
      data-testid="suggestion-plugin"
    >
      <Switch
        id={`plugin-on-${plugin.id}`}
        checked={plugin.enabled}
        disabled={disabled || busy}
        onChange={(on) => void update({ enabled: on })}
        label={plugin.name}
        sub={plugin.url}
      />
      <p className="t-caption">
        {t(`${NS}.lastAnswer`, {
          version: plugin.lastVersion ?? "—",
          // In the account's zone and format, not the stored UTC text (UAT rc.45).
          at: plugin.lastCalledAt ? fmt.dateTime(plugin.lastCalledAt) : "—",
        })}
      </p>
      {outcome && (
        <p className="t-caption" role="status" style={{ color: "var(--ts-bad)" }}>
          {t(`${NS}.lastError`)}: {outcome}
          {plugin.retryAt ? ` · ${t(`${NS}.retryAt`, { at: fmt.dateTime(plugin.retryAt) })}` : ""}
        </p>
      )}
      <div
        className="grid"
        style={{
          gap: "var(--ts-space-sm)",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        }}
      >
        <Field label={t(`${NS}.precision.label`)} htmlFor={`plugin-precision-${plugin.id}`}>
          <Select
            id={`plugin-precision-${plugin.id}`}
            value={plugin.precision}
            disabled={disabled || busy}
            onChange={(e) => void update({ precision: e.target.value as PluginPrecision })}
          >
            <option value="exact">{t(`${NS}.precision.exact`)}</option>
            <option value="100m">{t(`${NS}.precision.100m`)}</option>
            <option value="1km">{t(`${NS}.precision.1km`)}</option>
          </Select>
        </Field>
        <Switch
          id={`plugin-backfill-${plugin.id}`}
          checked={plugin.backfillAllowed}
          disabled={disabled || busy}
          onChange={(on) => void update({ backfillAllowed: on })}
          label={t(`${NS}.backfillAllowed`)}
        />
      </div>
      {line && (
        <p
          className="t-caption"
          role={line.ok ? "status" : "alert"}
          style={{ color: line.ok ? "var(--ts-good)" : "var(--ts-bad)" }}
        >
          {line.text}
        </p>
      )}
      {secret && <SecretOnce secret={secret} onDone={() => setSecret(null)} />}
      {maintenance.error && (
        <p className="t-caption" role="alert" style={{ color: "var(--ts-bad)" }}>
          {t(`${NS}.maintenance.helloFailed`)}:{" "}
          {t(
            `suggestionSources:${
              maintenance.error.startsWith("plugins.")
                ? maintenance.error
                : pluginFailureKey(maintenance.error)
            }`
          )}
        </p>
      )}
      <div className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
        <Button disabled={disabled || busy} onClick={() => void test()}>
          {t(`${NS}.test.button`)}
        </Button>
        <Button
          disabled={disabled || busy}
          onClick={() =>
            void run(async () => {
              setSecret(await suggestionPluginsApi.rotate(plugin.id));
            })
          }
        >
          {t(`${NS}.rotate`)}
        </Button>
        {maintenance.offered && (
          <Button disabled={disabled || busy} onClick={() => setMaintaining(true)}>
            {t(`${NS}.maintenance.open`)}
          </Button>
        )}
        <Button disabled={disabled || busy} onClick={onRemove}>
          {t(`${NS}.remove`)}
        </Button>
      </div>
      {maintaining && (
        <PluginMaintenanceDialog
          plugin={plugin}
          open={maintaining}
          onClose={() => setMaintaining(false)}
        />
      )}
      {plugin.backfillAllowed && (
        <div className="flex flex-wrap items-end" style={{ gap: "var(--ts-space-sm)" }}>
          <Field label={t(`${NS}.backfill.from`)} htmlFor={`plugin-from-${plugin.id}`}>
            <DateField
              id={`plugin-from-${plugin.id}`}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field
            label={t(`${NS}.backfill.to`)}
            htmlFor={`plugin-to-${plugin.id}`}
            error={from && to && !rangeOk ? t(`${NS}.backfill.range`) : undefined}
          >
            <DateField
              id={`plugin-to-${plugin.id}`}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
          <Button disabled={disabled || busy || !rangeOk} onClick={() => void backfill()}>
            {t(`${NS}.backfill.button`)}
          </Button>
        </div>
      )}
    </div>
  );
}
