import { useCallback, useEffect, useState } from "react";
import type { FormEvent, JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { sharingConnectionsApi } from "../../lib/api/sharingConnections";
import { sharingRemoteApi } from "../../lib/api/sharingRemote";
import { logger } from "../../lib/logger";
import {
  NO_SWITCHES,
  type Connection,
  type ConnectionSwitches,
  type RemoteServer,
  type RemoteSharingStatus,
} from "../../types/sharingRemote";
import { remoteSharingError, type RemoteSharingError } from "../sharing/remoteSharingCopy";
import Button from "../ui/Button";
import ConfirmModal from "../ui/ConfirmModal";
import Dialog from "../ui/Dialog";
import { Field, Input, Select, Switch } from "../ui/Field";
import { SectionCard, SectionTitle } from "./SettingsShared";
import ConnectionSwitchesForm, { theirsSummary } from "./ConnectionSwitchesForm";
import RemotePersonStats from "./RemotePersonStats";

const NS = "sharing:remote.connections";

/** What one dialog is doing: confirming a request, or changing an active connection. */
type Editing = { connection: Connection; mode: "confirm" | "change" };

/**
 * Einstellungen → Teilen → „Verbindungen" (user connections, spec 2026-11-02): ask a person on a
 * connected server with the switches you choose, confirm requests (and pairings from before
 * connections) with your own, change what you give, end it. Being findable only lets people ask
 * you. Drawn only while the server has trip sharing across servers on.
 */
export default function ConnectionsSection(): JSX.Element | null {
  const { t } = useTranslation(["sharing"]);
  const [status, setStatus] = useState<RemoteSharingStatus | null>(null);
  const [findable, setFindable] = useState(false);
  const [servers, setServers] = useState<RemoteServer[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [origin, setOrigin] = useState("");
  const [username, setUsername] = useState("");
  const [requestSwitches, setRequestSwitches] = useState<ConnectionSwitches>(NO_SWITCHES);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [draft, setDraft] = useState<ConnectionSwitches>(NO_SWITCHES);
  const [ending, setEnding] = useState<Connection | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<RemoteSharingError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await sharingRemoteApi.status();
      setStatus(next);
      if (!next.available) return;
      const [f, s, c] = await Promise.all([
        sharingRemoteApi.getFindable(),
        sharingRemoteApi.listServers(),
        sharingConnectionsApi.list(),
      ]);
      setFindable(f);
      setServers(s);
      setConnections(c);
      setOrigin((current) => current || s[0]?.origin || "");
    } catch (error) {
      logger.error("Failed to load the connections:", error);
      setFailure(remoteSharingError(error, "sharing:remote.errors.loadFailed"));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<void>, fallbackKey: string): Promise<boolean> => {
    setBusy(true);
    setFailure(null);
    setNotice(null);
    try {
      await action();
      return true;
    } catch (error) {
      logger.error("Connection action failed:", error);
      setFailure(remoteSharingError(error, fallbackKey));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const replace = (next: Connection): void =>
    setConnections((list) => list.map((c) => (c.id === next.id ? next : c)));

  if (!status?.available) return null;

  const ask = (event: FormEvent): void => {
    event.preventDefault();
    const name = username.trim();
    if (!origin || !name) return;
    void run(async () => {
      const created = await sharingConnectionsApi.request(origin, name, requestSwitches);
      setConnections((list) => [created, ...list.filter((c) => c.id !== created.id)]);
      setUsername("");
      setRequestSwitches(NO_SWITCHES);
      setNotice(t(`${NS}.request.sent`, { username: name, origin }));
    }, "sharing:remote.errors.requestFailed");
  };

  const openDialog = (connection: Connection, mode: Editing["mode"]): void => {
    setFailure(null);
    setDraft(
      mode === "confirm" && connection.state === "pending_in" ? NO_SWITCHES : connection.mine
    );
    setEditing({ connection, mode });
  };

  const submitDialog = (): void => {
    if (!editing) return;
    const { connection, mode } = editing;
    void run(
      async () => {
        replace(
          mode === "confirm"
            ? await sharingConnectionsApi.accept(connection.id, draft)
            : await sharingConnectionsApi.setSwitches(connection.id, draft)
        );
        setEditing(null);
      },
      mode === "confirm"
        ? "sharing:remote.errors.confirmFailed"
        : "sharing:remote.errors.switchesFailed"
    );
  };

  const decline = (connection: Connection): void => {
    void run(async () => {
      replace(await sharingConnectionsApi.decline(connection.id));
    }, "sharing:remote.errors.declineFailed");
  };

  const end = (): void => {
    const connection = ending;
    if (!connection) return;
    void run(async () => {
      replace(await sharingConnectionsApi.end(connection.id));
      setEnding(null);
      setViewing(null);
    }, "sharing:remote.errors.endFailed").then((ok) => {
      if (!ok) setEnding(null);
    });
  };

  const waiting = connections.filter((c) => c.state === "pending_in" || c.state === "reconfirm");
  const others = connections.filter((c) => c.state !== "pending_in" && c.state !== "reconfirm");
  const who = (c: Connection): string =>
    t(`${NS}.row`, { name: c.displayName, username: c.username, origin: c.origin });
  const theirsLine = (c: Connection): string =>
    theirsSummary(c.theirs, t) ?? t(`${NS}.theirsNothing`);

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
        <form onSubmit={ask} className="flex flex-col gap-3">
          <span className="font-semibold">{t(`${NS}.request.title`)}</span>
          {servers.length === 0 ? (
            <p className="t-caption">{t(`${NS}.request.noServers`)}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <Field label={t(`${NS}.request.server`)} htmlFor="connection-server">
                  <Select
                    id="connection-server"
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
                <Field label={t(`${NS}.request.username`)} htmlFor="connection-username">
                  <Input
                    id="connection-username"
                    value={username}
                    autoComplete="off"
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </Field>
              </div>
              <p className="t-caption">{t(`${NS}.request.switchesHint`)}</p>
              <ConnectionSwitchesForm
                idPrefix="connection-request"
                value={requestSwitches}
                onChange={setRequestSwitches}
                disabled={busy}
              />
              <div>
                <Button type="submit" variant="primary" disabled={busy || username.trim() === ""}>
                  {t(`${NS}.request.submit`)}
                </Button>
              </div>
            </>
          )}
        </form>
        {failure && !editing && !ending && (
          <p role="alert" style={{ color: "var(--ts-warn)" }}>
            {t(failure.key, { origin: failure.origin })}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}

        {waiting.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="font-semibold">{t(`${NS}.waiting.title`)}</span>
            <ul className="flex flex-col gap-3">
              {waiting.map((c) => (
                <li key={c.id} className="flex flex-col gap-1" data-testid="connection-request">
                  <span>{who(c)}</span>
                  <span className="t-caption">
                    {c.state === "reconfirm"
                      ? t(`${NS}.waiting.reconfirm`)
                      : t(`${NS}.waiting.asks`, { gives: theirsLine(c) })}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="primary"
                      disabled={busy}
                      onClick={() => openDialog(c, "confirm")}
                    >
                      {t(`${NS}.waiting.confirm`)}
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() => (c.state === "reconfirm" ? setEnding(c) : decline(c))}
                    >
                      {c.state === "reconfirm" ? t(`${NS}.end.action`) : t(`${NS}.waiting.decline`)}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {connections.length === 0 && <p className="t-caption">{t(`${NS}.none`)}</p>}
        <ul className="flex flex-col gap-4">
          {others.map((c) => (
            <li key={c.id} className="flex flex-col gap-1" data-testid="connection">
              <span>{who(c)}</span>
              <span className="t-caption">{t(`${NS}.state.${c.state}`)}</span>
              {c.state === "active" && (
                <>
                  <span className="t-caption">{t(`${NS}.theirs`, { gives: theirsLine(c) })}</span>
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={busy} onClick={() => openDialog(c, "change")}>
                      {t(`${NS}.change`)}
                    </Button>
                    {c.theirs.stats !== "off" && (
                      <Button onClick={() => setViewing((id) => (id === c.id ? null : c.id))}>
                        {viewing === c.id
                          ? t("sharing:remote.connected.stats.close")
                          : t("sharing:remote.connected.stats.view")}
                      </Button>
                    )}
                    <Button disabled={busy} onClick={() => setEnding(c)}>
                      {t(`${NS}.end.action`)}
                    </Button>
                  </div>
                  {viewing === c.id && <RemotePersonStats person={c} />}
                </>
              )}
              {c.state === "pending_out" && (
                <div>
                  <Button disabled={busy} onClick={() => setEnding(c)}>
                    {t(`${NS}.withdraw`)}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={
          editing?.mode === "confirm" ? t(`${NS}.confirm.title`) : t(`${NS}.changeDialog.title`)
        }
        dismissLabel={t(`${NS}.cancel`)}
        closeLabel={t(`${NS}.close`)}
        busy={busy}
        action={
          <Button variant="primary" disabled={busy} onClick={submitDialog}>
            {editing?.mode === "confirm"
              ? t(`${NS}.confirm.submit`)
              : t(`${NS}.changeDialog.submit`)}
          </Button>
        }
      >
        {editing && (
          <div className="flex flex-col gap-3">
            <p>{who(editing.connection)}</p>
            <p className="t-caption">
              {t(`${NS}.confirm.theirs`, { gives: theirsLine(editing.connection) })}
            </p>
            {editing.mode === "confirm" && <p className="t-caption">{t(`${NS}.confirm.mine`)}</p>}
            <ConnectionSwitchesForm
              idPrefix="connection-edit"
              value={draft}
              onChange={setDraft}
              disabled={busy}
            />
            {failure && (
              <p role="alert" style={{ color: "var(--ts-warn)" }}>
                {t(failure.key, { origin: failure.origin })}
              </p>
            )}
          </div>
        )}
      </Dialog>

      <ConfirmModal
        isOpen={ending !== null}
        onClose={() => setEnding(null)}
        onConfirm={end}
        title={t(`${NS}.end.title`)}
        message={ending ? t(`${NS}.end.message`, { name: ending.displayName }) : ""}
        confirmText={t(`${NS}.end.action`)}
        cancelText={t(`${NS}.cancel`)}
        isLoading={busy}
      />
    </SectionCard>
  );
}
