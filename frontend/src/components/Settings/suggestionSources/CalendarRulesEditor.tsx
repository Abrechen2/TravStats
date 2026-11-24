import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import Button from "../../ui/Button";
import { Field, Input, Select } from "../../ui/Field";
import { SettingItem } from "../../ui/settings";
import {
  calendarSourcesApi,
  type CalendarRule,
  type CalendarSource,
} from "../../../lib/api/calendarSources";
import { dawarichStaysApi } from "../../../lib/api/dawarichStays";

const NS = "suggestionSources:rules";
const MAX_RULES = 50;

const blank = (sourceId: string | null): CalendarRule => ({
  kind: "keyword",
  sourceId,
  token: "",
  matchMode: "contains",
  purpose: "business",
  nameTemplate: null,
  placeId: null,
});

/**
 * The calendar rules (spec 2026-11-23-plugins-and-calendar.md, "Rules → purpose
 * and name"): an ordered list, the first that matches wins, saved as a whole.
 */
export default function CalendarRulesEditor({
  sources,
  disabled,
}: {
  sources: CalendarSource[];
  disabled: boolean;
}): JSX.Element {
  const { t } = useTranslation(["suggestionSources", "purpose"]);
  const [rules, setRules] = useState<CalendarRule[] | null>(null);
  const [places, setPlaces] = useState<{ id: string; name: string }[]>([]);
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    calendarSourcesApi
      .rules()
      .then((r) => live && setRules(r))
      .catch((e: unknown) => {
        console.warn("calendar rules could not be loaded", e);
        if (live) setState({ ok: false, text: `${NS}.error` });
      });
    dawarichStaysApi
      .choices()
      .then((c) => live && setPlaces(c.places))
      .catch((e: unknown) => console.warn("places for calendar rules could not be loaded", e));
    return () => {
      live = false;
    };
  }, []);

  const change = (i: number, patch: Partial<CalendarRule>) =>
    setRules((list) => list && list.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, by: number) =>
    setRules((list) => {
      if (!list) return list;
      const next = [...list];
      const [r] = next.splice(i, 1);
      next.splice(i + by, 0, r);
      return next;
    });

  const save = async () => {
    if (!rules) return;
    setBusy(true);
    setState(null);
    try {
      setRules(await calendarSourcesApi.saveRules(rules));
      setState({ ok: true, text: `${NS}.saved` });
    } catch (e) {
      const code = (e as { response?: { data?: { code?: string } } })?.response?.data?.code;
      console.warn("calendar rules could not be saved", code ?? e);
      setState({ ok: false, text: code === "CALENDAR_RULE_LIMIT" ? `${NS}.limit` : `${NS}.error` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingItem title={t(`${NS}.title`)} sub={t(`${NS}.sub`)} help={t(`${NS}.help`)}>
      <div className="flex flex-col" style={{ gap: "var(--ts-space-md)" }}>
        {rules?.length === 0 && <p className="t-body">{t(`${NS}.empty`)}</p>}
        {rules?.map((rule, i) => (
          <fieldset
            key={i}
            className="grid"
            style={{
              gap: "var(--ts-space-sm)",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              padding: "var(--ts-space-md)",
              border: "1px solid var(--ts-border)",
              borderRadius: "var(--ts-radius-card)",
            }}
            data-testid="calendar-rule"
          >
            <Field label={`${i + 1}.`} htmlFor={`rule-kind-${i}`}>
              <Select
                id={`rule-kind-${i}`}
                value={rule.kind}
                disabled={disabled}
                onChange={(e) =>
                  change(i, {
                    kind: e.target.value as CalendarRule["kind"],
                    sourceId:
                      e.target.value === "calendar"
                        ? (rule.sourceId ?? sources[0]?.id ?? null)
                        : rule.sourceId,
                  })
                }
              >
                <option value="keyword">{t(`${NS}.kind.keyword`)}</option>
                <option value="calendar">{t(`${NS}.kind.calendar`)}</option>
              </Select>
            </Field>
            <Field label={t(`${NS}.source`)} htmlFor={`rule-source-${i}`}>
              <Select
                id={`rule-source-${i}`}
                value={rule.sourceId ?? ""}
                disabled={disabled}
                onChange={(e) => change(i, { sourceId: e.target.value || null })}
              >
                {rule.kind === "keyword" && <option value="">{t(`${NS}.anySource`)}</option>}
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
            </Field>
            {rule.kind === "keyword" && (
              <>
                <Field label={t(`${NS}.token`)} htmlFor={`rule-token-${i}`}>
                  <Input
                    id={`rule-token-${i}`}
                    value={rule.token ?? ""}
                    maxLength={80}
                    disabled={disabled}
                    onChange={(e) => change(i, { token: e.target.value })}
                  />
                </Field>
                <Field label=" " htmlFor={`rule-mode-${i}`}>
                  <Select
                    id={`rule-mode-${i}`}
                    value={rule.matchMode}
                    disabled={disabled}
                    onChange={(e) =>
                      change(i, { matchMode: e.target.value as CalendarRule["matchMode"] })
                    }
                  >
                    <option value="contains">{t(`${NS}.matchMode.contains`)}</option>
                    <option value="startsWith">{t(`${NS}.matchMode.startsWith`)}</option>
                  </Select>
                </Field>
              </>
            )}
            <Field label={t(`${NS}.purpose`)} htmlFor={`rule-purpose-${i}`}>
              <Select
                id={`rule-purpose-${i}`}
                value={rule.purpose ?? ""}
                disabled={disabled}
                onChange={(e) =>
                  change(i, { purpose: (e.target.value || null) as CalendarRule["purpose"] })
                }
              >
                <option value="">{t("purpose:field.unknown")}</option>
                <option value="private">{t("purpose:field.private")}</option>
                <option value="business">{t("purpose:field.business")}</option>
              </Select>
            </Field>
            <Field
              label={t(`${NS}.nameTemplate`)}
              htmlFor={`rule-name-${i}`}
              hint={t(`${NS}.nameTemplateHint`)}
            >
              <Input
                id={`rule-name-${i}`}
                value={rule.nameTemplate ?? ""}
                maxLength={200}
                disabled={disabled}
                onChange={(e) => change(i, { nameTemplate: e.target.value || null })}
              />
            </Field>
            {rule.kind === "keyword" && (
              <Field
                label={t(`${NS}.place`)}
                htmlFor={`rule-place-${i}`}
                hint={t(`${NS}.placeHint`)}
              >
                <Select
                  id={`rule-place-${i}`}
                  value={rule.placeId ?? ""}
                  disabled={disabled}
                  onChange={(e) => change(i, { placeId: e.target.value || null })}
                >
                  <option value="">{t(`${NS}.noPlace`)}</option>
                  {places.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <div className="flex flex-wrap items-end" style={{ gap: "var(--ts-space-sm)" }}>
              <Button disabled={disabled || i === 0} onClick={() => move(i, -1)}>
                {t(`${NS}.up`)}
              </Button>
              <Button disabled={disabled || i === rules.length - 1} onClick={() => move(i, 1)}>
                {t(`${NS}.down`)}
              </Button>
              <Button
                disabled={disabled}
                onClick={() => setRules((list) => list && list.filter((_, j) => j !== i))}
              >
                {t(`${NS}.remove`)}
              </Button>
            </div>
          </fieldset>
        ))}
        {state && (
          <p
            className="t-body"
            role={state.ok ? "status" : "alert"}
            style={{ color: state.ok ? "var(--ts-good)" : "var(--ts-bad)" }}
          >
            {t(state.text)}
          </p>
        )}
        <div className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
          <Button
            disabled={disabled || !rules || rules.length >= MAX_RULES}
            onClick={() => setRules((list) => [...(list ?? []), blank(null)])}
          >
            {t(`${NS}.add`)}
          </Button>
          <Button
            variant="primary"
            disabled={disabled || busy || !rules}
            onClick={() => void save()}
          >
            {t(`${NS}.save`)}
          </Button>
        </div>
      </div>
    </SettingItem>
  );
}
