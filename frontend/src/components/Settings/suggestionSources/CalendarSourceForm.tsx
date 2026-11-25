import { useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import Button from "../../ui/Button";
import { Field, Input } from "../../ui/Field";
import { Segmented } from "../../ui/Segmented";
import {
  calendarRequestFailureKey,
  calendarSourcesApi,
  type CalendarCollection,
} from "../../../lib/api/calendarSources";

const NS = "suggestionSources:calendar.form";

/**
 * Adding a calendar: an ICS subscription address (the "secret address" of
 * iCloud or Google — it is the key, so it is typed like a password), or a
 * CalDAV account whose calendars are listed first and then picked.
 */
export default function CalendarSourceForm({
  onAdded,
  onCancel,
}: {
  onAdded: () => void;
  onCancel: () => void;
}): JSX.Element {
  const { t } = useTranslation(["suggestionSources"]);
  const [kind, setKind] = useState<"ics" | "caldav">("ics");
  const [label, setLabel] = useState("");
  const [icsUrl, setIcsUrl] = useState("");
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [found, setFound] = useState<CalendarCollection[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = (e: unknown) => {
    const key = calendarRequestFailureKey(e);
    setError(t(`suggestionSources:${key}`));
    console.warn("calendar source request failed", key);
  };

  const discover = async () => {
    setBusy(true);
    setError(null);
    try {
      const list = await calendarSourcesApi.discover({ url, username, password });
      setFound(list);
      setChosen(new Set(list.map((c) => c.href)));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (kind === "ics") await calendarSourcesApi.add({ kind, label, icsUrl });
      else
        await calendarSourcesApi.add({
          kind,
          label,
          url,
          username,
          password,
          collections: (found ?? []).filter((c) => chosen.has(c.href)),
        });
      onAdded();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const canSave =
    label.trim() !== "" &&
    (kind === "ics" ? icsUrl.trim() !== "" : found !== null && chosen.size > 0);

  return (
    <form
      className="flex flex-col"
      style={{ gap: "var(--ts-space-md)" }}
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave && !busy) void save();
      }}
      data-testid="calendar-source-form"
    >
      <Segmented<"ics" | "caldav">
        label={t(`${NS}.kind`)}
        value={kind}
        onChange={(v) => {
          setKind(v);
          setError(null);
        }}
        options={[
          { value: "ics", label: t(`${NS}.ics`) },
          { value: "caldav", label: t(`${NS}.caldav`) },
        ]}
      />
      <Field label={t(`${NS}.label`)} htmlFor="cal-label" hint={t(`${NS}.labelHint`)}>
        <Input
          id="cal-label"
          value={label}
          maxLength={60}
          onChange={(e) => setLabel(e.target.value)}
        />
      </Field>
      {kind === "ics" ? (
        <Field label={t(`${NS}.icsUrl`)} htmlFor="cal-ics" hint={t(`${NS}.icsHint`)}>
          <Input
            id="cal-ics"
            type="password"
            autoComplete="off"
            value={icsUrl}
            onChange={(e) => setIcsUrl(e.target.value)}
          />
        </Field>
      ) : (
        <>
          <Field label={t(`${NS}.server`)} htmlFor="cal-dav-url" hint={t(`${NS}.serverHint`)}>
            <Input
              id="cal-dav-url"
              type="url"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setFound(null);
              }}
            />
          </Field>
          <Field label={t(`${NS}.username`)} htmlFor="cal-dav-user">
            <Input
              id="cal-dav-user"
              autoComplete="off"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </Field>
          <Field
            label={t(`${NS}.password`)}
            htmlFor="cal-dav-pw"
            hint={`${t(`${NS}.appPasswordHint`)} ${t(`${NS}.passwordHint`)}`}
          >
            <Input
              id="cal-dav-pw"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <div>
            <Button
              type="button"
              disabled={busy || !url || !username || !password}
              onClick={() => void discover()}
            >
              {t(`${NS}.discover`)}
            </Button>
          </div>
          {found && (
            <fieldset className="flex flex-col" style={{ gap: "var(--ts-space-xs)" }}>
              <legend className="t-caption">{t(`${NS}.collections`)}</legend>
              {found.map((c) => (
                <label
                  key={c.href}
                  className="flex items-center"
                  style={{ gap: "var(--ts-space-sm)", minHeight: "var(--ts-size-touch-min)" }}
                >
                  <input
                    type="checkbox"
                    checked={chosen.has(c.href)}
                    onChange={(e) => {
                      const next = new Set(chosen);
                      if (e.target.checked) next.add(c.href);
                      else next.delete(c.href);
                      setChosen(next);
                    }}
                  />
                  <span className="t-body">{c.name || c.href}</span>
                </label>
              ))}
            </fieldset>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="t-body" style={{ color: "var(--ts-bad)" }}>
          {error}
        </p>
      )}
      <div className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
        <Button type="submit" variant="primary" disabled={!canSave || busy}>
          {t(`${NS}.save`)}
        </Button>
        <Button type="button" onClick={onCancel} disabled={busy}>
          {t(`${NS}.cancel`)}
        </Button>
      </div>
    </form>
  );
}
