import { useCallback, useEffect, useState } from "react";
import type { FormEvent, JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { sharingRemoteApi } from "../../lib/api/sharingRemote";
import { logger } from "../../lib/logger";
import type {
  RemotePerson,
  RemoteServer,
  RemoteSharingStatus,
  RemoteStatsLevel,
} from "../../types/sharingRemote";
import { remoteSharingError, type RemoteSharingError } from "../sharing/remoteSharingCopy";
import Button from "../ui/Button";
import { Field, Input, Select, Switch } from "../ui/Field";
import { Segmented } from "../ui/Segmented";
import { SectionCard, SectionTitle } from "./SettingsShared";
import RemotePersonStats from "./RemotePersonStats";

const NS = "sharing:remote.connected";
const LEVELS: readonly RemoteStatsLevel[] = ["off", "overview", "full"];

/**
 * Einstellungen → Teilen → „Personen auf verbundenen Servern" (simplified setup 2026-11-02,
 * forgejo#301): be findable by connected servers (default off), find a person by username on a
 * server your admin connected, and per person a leaderboard switch and a statistics level —
 * off, Übersicht (totals, no entries) or Voll (with the entries, never notes, costs, documents).
 * Drawn only while the server has trip sharing across servers on.
 */
export default function RemotePeopleSection(): JSX.Element | null {
  const { t } = useTranslation(["sharing"]);
  const [status, setStatus] = useState<RemoteSharingStatus | null>(null);
  const [findable, setFindable] = useState(false);
  const [servers, setServers] = useState<RemoteServer[]>([]);
  const [people, setPeople] = useState<RemotePerson[]>([]);
  const [origin, setOrigin] = useState("");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<RemoteSharingError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await sharingRemoteApi.status();
      setStatus(next);
      if (!next.available) return;
      const [f, s, p] = await Promise.all([
        sharingRemoteApi.getFindable(),
        sharingRemoteApi.listServers(),
        sharingRemoteApi.listPeople(),
      ]);
      setFindable(f);
      setServers(s);
      setPeople(p);
      setOrigin((current) => current || s[0]?.origin || "");
    } catch (error) {
      logger.error("Failed to load the people on connected servers:", error);
      setFailure(remoteSharingError(error, "sharing:remote.errors.loadFailed"));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<void>, fallbackKey: string): Promise<void> => {
    setBusy(true);
    setFailure(null);
    setNotice(null);
    try {
      await action();
    } catch (error) {
      logger.error("Connected-server people action failed:", error);
      setFailure(remoteSharingError(error, fallbackKey));
    } finally {
      setBusy(false);
    }
  };
  const replace = (next: RemotePerson): void =>
    setPeople((list) => list.map((p) => (p.id === next.id ? next : p)));

  if (!status?.available) return null;

  const find = (event: FormEvent): void => {
    event.preventDefault();
    const name = username.trim();
    if (!origin || !name) return;
    void run(async () => {
      const person = await sharingRemoteApi.findPerson(origin, name);
      setPeople((list) => [person, ...list.filter((p) => p.id !== person.id)]);
      setUsername("");
      const done = t(`${NS}.find.done`, {
        name: person.displayName,
        username: person.username,
        origin: person.origin,
      });
      setNotice(person.leaderboardIssue ? `${done} ${t(`${NS}.find.leaderboardMismatch`)}` : done);
    }, "sharing:remote.errors.findFailed");
  };

  return (
    <SectionCard>
      <SectionTitle title={t(`${NS}.title`)} />
      <div className="flex flex-col gap-4 text-sm">
        <p className="t-caption">{t(`${NS}.hint`)}</p>
        <Switch
          id="remote-findable"
          label={t(`${NS}.findable.label`)}
          sub={t(`${NS}.findable.sub`)}
          checked={findable}
          disabled={busy}
          onChange={(next) =>
            void run(async () => {
              setFindable(await sharingRemoteApi.setFindable(next));
            }, "sharing:remote.errors.findableFailed")
          }
        />
        <form onSubmit={find} className="flex flex-wrap items-end gap-2">
          {servers.length === 0 ? (
            <p className="t-caption">{t(`${NS}.find.noServers`)}</p>
          ) : (
            <>
              <Field label={t(`${NS}.find.server`)} htmlFor="remote-find-server">
                <Select
                  id="remote-find-server"
                  value={origin}
                  onChange={(e) => setOrigin(e.target.value)}
                >
                  {servers.map((s) => (
                    <option key={s.origin} value={s.origin}>
                      {s.origin}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t(`${NS}.find.username`)} htmlFor="remote-find-username">
                <Input
                  id="remote-find-username"
                  value={username}
                  autoComplete="off"
                  onChange={(e) => setUsername(e.target.value)}
                />
              </Field>
              <Button type="submit" variant="primary" disabled={busy || username.trim() === ""}>
                {t(`${NS}.find.submit`)}
              </Button>
            </>
          )}
        </form>
        {failure && (
          <p role="alert" style={{ color: "var(--ts-warn)" }}>
            {t(failure.key, { origin: failure.origin })}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {people.length === 0 && <p className="t-caption">{t(`${NS}.none`)}</p>}
        <ul className="flex flex-col gap-4">
          {people
            .filter((p) => p.consent === "accepted")
            .map((person) => (
              <li key={person.id} className="flex flex-col gap-2" data-testid="connected-person">
                <span>
                  {t(`${NS}.row`, {
                    name: person.displayName,
                    username: person.username,
                    origin: person.origin,
                  })}
                </span>
                {person.leaderboard === "unavailable" ? (
                  <p className="t-caption">{t(`${NS}.leaderboard.unavailable`)}</p>
                ) : (
                  <Switch
                    id={`remote-lb-${person.id}`}
                    label={t(`${NS}.leaderboard.label`)}
                    sub={t(`${NS}.leaderboard.sub`)}
                    checked={person.leaderboard === "on"}
                    disabled={busy}
                    onChange={(on) =>
                      void run(async () => {
                        replace(await sharingRemoteApi.setLeaderboard(person.id, on));
                      }, "sharing:remote.errors.leaderboardFailed")
                    }
                  />
                )}
                <div className="flex flex-col gap-1">
                  <span>{t(`${NS}.stats.label`)}</span>
                  <Segmented
                    label={t(`${NS}.stats.label`)}
                    value={person.statsLevel}
                    disabled={busy}
                    options={LEVELS.map((level) => ({
                      value: level,
                      label: t(`${NS}.stats.${level}`),
                    }))}
                    onChange={(level) =>
                      void run(async () => {
                        replace(await sharingRemoteApi.setStatsLevel(person.id, level));
                      }, "sharing:remote.errors.levelFailed")
                    }
                  />
                  {person.statsLevel === "overview" && (
                    <p className="t-caption">{t(`${NS}.stats.hintOverview`)}</p>
                  )}
                  {person.statsLevel === "full" && (
                    <p className="t-caption">{t(`${NS}.stats.hintFull`)}</p>
                  )}
                </div>
                <div>
                  <Button onClick={() => setViewing((id) => (id === person.id ? null : person.id))}>
                    {viewing === person.id ? t(`${NS}.stats.close`) : t(`${NS}.stats.view`)}
                  </Button>
                </div>
                {viewing === person.id && <RemotePersonStats person={person} />}
              </li>
            ))}
        </ul>
      </div>
    </SectionCard>
  );
}
