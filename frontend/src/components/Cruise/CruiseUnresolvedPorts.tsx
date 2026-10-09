import { useEffect, useState } from "react";
import type { JSX } from "react";
import type { Cruise, Port } from "../../types";
import { cruiseApi, portsApi } from "../../lib/api";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { saveErrorKey } from "../../lib/saveErrorMessage";
import { countUniquePorts } from "./cruisePorts";
import { stopInputsOf } from "./cruiseFormDraft";
import { cruiseStopToWire } from "./cruiseStopWire";
import { PortPicker } from "./PortPicker";
import { resolveStops, unresolvedGroups } from "./cruiseUnresolved";
import type { UnresolvedGroup } from "./cruiseUnresolved";

const BUTTON_CLASS =
  "rounded-md border border-border px-3 py-1.5 text-sm text-(--text-primary) hover:bg-(--bg-elevated) disabled:opacity-50 pointer-coarse:min-h-(--ts-size-touch-min)";
const OPTION_CLASS =
  "flex items-center gap-2 text-sm text-(--text-primary) pointer-coarse:min-h-(--ts-size-touch-min)";

type Candidates = { status: "loading" } | { status: "ready"; ports: Port[] } | { status: "failed" };

const CANDIDATE_LIMIT = 5;

interface Props {
  cruise: Cruise;
  /** The saved cruise as the server returned it. */
  onUpdated: (cruise: Cruise) => void;
}

/**
 * The ports an import could not match, as one work list (forgejo#222): each
 * imported name once, with the days it appears on and the catalogue's
 * matches for it; a match is confirmed per port, and a refusal stays on the
 * row with its reason instead of vanishing.
 *
 * It also says what is incomplete while they stay open (forgejo#176): such a
 * stop counts as a port CALL but not as a port, so the port count shows
 * "0 (+2)", and the countries, the map and the sea miles to and from it leave
 * it out. There is deliberately no "sea day" choice here — the ship did call
 * at the port; only its catalogue entry is missing.
 */
export function CruiseUnresolvedPorts({ cruise, onUpdated }: Props): JSX.Element | null {
  const { t } = useTranslation("cruise");
  const groups = unresolvedGroups(cruise);
  /** One confirmation at a time: each builds on the cruise the last one returned. */
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [resolved, setResolved] = useState<string | null>(null);

  if (groups.length === 0) {
    return resolved ? (
      <p role="status" className="t-caption">
        {resolved}
      </p>
    ) : null;
  }

  const confirm = async (group: UnresolvedGroup, port: Port): Promise<string | null> => {
    setBusyKey(group.key);
    try {
      const stops = resolveStops(stopInputsOf(cruise.stops), group.key, port);
      const updated = await cruiseApi.update(cruise.id, { stops: stops.map(cruiseStopToWire) });
      setResolved(t("unresolved.done", { name: group.name, port: port.name }));
      onUpdated(updated);
      return null;
    } catch (err: unknown) {
      logger.error("CruiseUnresolvedPorts: resolving a port failed", err);
      return saveErrorKey(err, "cruise:unresolved.saveError");
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <section aria-labelledby="cruise-unresolved-title" className="flex flex-col gap-3">
      <h3 id="cruise-unresolved-title" className="text-sm font-semibold text-(--text-primary)">
        {t("unresolved.title", { count: groups.length })}
      </h3>
      <p className="t-caption">
        {t("unresolved.incomplete", {
          matched: countUniquePorts(cruise),
          count: groups.length,
        })}
      </p>
      {resolved && (
        <p role="status" className="t-caption">
          {resolved}
        </p>
      )}
      <ul className="flex flex-col gap-3">
        {groups.map((group) => (
          <UnresolvedRow
            key={group.key}
            group={group}
            busy={busyKey !== null}
            saving={busyKey === group.key}
            onConfirm={(port) => confirm(group, port)}
          />
        ))}
      </ul>
    </section>
  );
}

function UnresolvedRow({
  group,
  busy,
  saving,
  onConfirm,
}: {
  group: UnresolvedGroup;
  busy: boolean;
  saving: boolean;
  onConfirm: (port: Port) => Promise<string | null>;
}): JSX.Element {
  const { t } = useTranslation("cruise");
  const [candidates, setCandidates] = useState<Candidates>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [chosen, setChosen] = useState<Port | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const idBase = `cruise-unresolved-${group.key.replace(/[^a-z0-9]+/g, "-")}`;

  useEffect(() => {
    let cancelled = false;
    setCandidates({ status: "loading" });
    portsApi
      .search(group.name)
      .then((ports) => {
        if (cancelled) return;
        const list = (Array.isArray(ports) ? ports : []).slice(0, CANDIDATE_LIMIT);
        setCandidates({ status: "ready", ports: list });
        // One clear match is offered pre-chosen; several are the user's call.
        if (list.length === 1) setChosen((current) => current ?? list[0]);
      })
      .catch((err: unknown) => {
        logger.warn("CruiseUnresolvedPorts: catalogue search failed", err);
        if (!cancelled) setCandidates({ status: "failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [group.name, attempt]);

  const options =
    candidates.status === "ready"
      ? [
          ...candidates.ports,
          ...(chosen && !candidates.ports.some((p) => p.id === chosen.id) ? [chosen] : []),
        ]
      : chosen
        ? [chosen]
        : [];

  return (
    <li className="rounded-md border border-(--warning)/40 bg-(--warning)/5 p-3">
      <p className="text-sm font-medium text-(--text-primary)">
        <span aria-hidden="true">🔶 </span>
        {group.name}
      </p>
      <p className="t-caption">
        {t("unresolved.days", { days: group.days.join(", "), count: group.days.length })}
      </p>

      <fieldset className="mt-2" aria-describedby={failure ? `${idBase}-error` : undefined}>
        <legend className="text-xs text-(--text-muted)">{t("unresolved.candidates")}</legend>
        {candidates.status === "loading" && (
          <p className="t-caption">{t("unresolved.searching")}</p>
        )}
        {candidates.status === "failed" && (
          <p role="alert" className="text-xs text-(--danger)">
            {t("unresolved.searchFailed")}{" "}
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="underline underline-offset-2 pointer-coarse:min-h-(--ts-size-touch-min)"
            >
              {t("common:buttons.retry")}
            </button>
          </p>
        )}
        {candidates.status === "ready" && candidates.ports.length === 0 && (
          <p className="t-caption">{t("unresolved.noCandidates")}</p>
        )}
        {options.map((port) => (
          <label key={port.id} className={OPTION_CLASS}>
            <input
              type="radio"
              name={idBase}
              checked={chosen?.id === port.id}
              onChange={() => {
                setChosen(port);
                setFailure(null);
              }}
              className="pointer-coarse:h-5 pointer-coarse:w-5"
            />
            <span>
              {port.name}
              <span className="text-(--text-muted)">
                {" "}
                —{" "}
                {[port.city !== port.name ? port.city : null, port.country]
                  .filter(Boolean)
                  .join(", ")}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="mt-2">
        <PortPicker
          id={`${idBase}-search`}
          label={t("unresolved.searchOther")}
          value={null}
          onChange={(port) => {
            setChosen(port);
            setFailure(null);
          }}
        />
      </div>

      {failure && (
        <p id={`${idBase}-error`} role="alert" className="mt-2 text-xs text-(--danger)">
          {t(failure)}
        </p>
      )}
      <div className="mt-2">
        <button
          type="button"
          disabled={chosen === null || busy}
          onClick={async () => {
            if (!chosen) return;
            setFailure(await onConfirm(chosen));
          }}
          className={BUTTON_CLASS}
        >
          {saving
            ? t("unresolved.saving")
            : chosen
              ? t("unresolved.confirm", { port: chosen.name })
              : t("unresolved.confirmNone")}
        </button>
      </div>
    </li>
  );
}
