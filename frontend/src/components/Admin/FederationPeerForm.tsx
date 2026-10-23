import { useState } from "react";
import type { JSX } from "react";
import type { ConnectionFileInspection } from "../../lib/api/federationAdmin";
import { useTranslation } from "../../hooks/useTranslation";
import { Button, Field, Input, TextArea } from "../ui";
import { ConnectionFileImport } from "./FederationConnectionFile";

const NS = "federation";
const EMPTY_PEER = { origin: "", publicKey: "", fingerprint: "" };
export type PeerValues = typeof EMPTY_PEER;

/**
 * Pinning another server: from its connection file, or by hand. An imported file only fills
 * the form — the admin compares address and fingerprint over a second channel and pins
 * exactly that tuple. Any edit afterwards drops the import, so "from the file" is never
 * shown next to values the file did not say.
 */
export default function FederationPeerForm(props: {
  busy: boolean;
  /** Resolves true when the pin went through, so the form can empty itself. */
  onPin: (peer: PeerValues) => Promise<boolean>;
  onError: (key: string | null) => void;
}): JSX.Element {
  const { t } = useTranslation(["admin"]);
  const [peer, setPeer] = useState(EMPTY_PEER);
  const [imported, setImported] = useState<ConnectionFileInspection | null>(null);
  const [manualOpen, setManualOpen] = useState(false);

  const edit = (change: Partial<PeerValues>): void => {
    setImported(null);
    setPeer({ ...peer, ...change });
  };
  const onImported = (inspection: ConnectionFileInspection): void => {
    setImported(inspection);
    setPeer({
      origin: inspection.origin,
      publicKey: inspection.publicKey,
      fingerprint: inspection.fingerprint,
    });
    // The reviewed values must be visible, not tucked away in a closed section.
    setManualOpen(true);
  };
  const pin = async (): Promise<void> => {
    if (await props.onPin(peer)) {
      setPeer(EMPTY_PEER);
      setImported(null);
      setManualOpen(false);
    }
  };

  const alreadyStored = imported?.existingPeer?.sameKey === true;
  const replaces = imported?.existingPeer && !imported.existingPeer.sameKey;
  return (
    <>
      <ConnectionFileImport disabled={props.busy} onImported={onImported} onError={props.onError} />
      {imported && (
        <div data-testid="connection-file-review">
          <p className="t-label-mono">
            {t(`${NS}.importedTitle`)} · {t(`${NS}.importedStatus`)}
          </p>
          <p className="t-caption">{t(`${NS}.peerOrigin`)}</p>
          <p>
            <strong className="break-all">{imported.origin}</strong>
          </p>
          <p className="t-caption">{t(`${NS}.peerFingerprint`)}</p>
          <p>
            <code className="break-all">{imported.fingerprint}</code>
          </p>
          <p className="t-caption">{t(`${NS}.importedCompare`)}</p>
          {replaces && (
            <p role="status" className="t-caption" style={{ color: "var(--ts-warn)" }}>
              {t(`${NS}.importedReplaces`, { fingerprint: imported.existingPeer?.fingerprint })}
            </p>
          )}
          {alreadyStored && <p className="t-caption">{t(`${NS}.importedAlreadyStored`)}</p>}
        </div>
      )}
      <details open={manualOpen} onToggle={(e) => setManualOpen(e.currentTarget.open)}>
        <summary className="t-label-mono cursor-pointer">{t(`${NS}.manualEntry`)}</summary>
        <Field label={t(`${NS}.peerOrigin`)} htmlFor="peer-origin">
          <Input
            id="peer-origin"
            value={peer.origin}
            onChange={(e) => edit({ origin: e.target.value })}
          />
        </Field>
        <Field label={t(`${NS}.peerKey`)} htmlFor="peer-key">
          <TextArea
            id="peer-key"
            rows={6}
            value={peer.publicKey}
            onChange={(e) => edit({ publicKey: e.target.value })}
          />
        </Field>
        <Field
          label={t(`${NS}.peerFingerprint`)}
          htmlFor="peer-fingerprint"
          hint={t(`${NS}.peerFingerprintHint`)}
        >
          <Input
            id="peer-fingerprint"
            value={peer.fingerprint}
            onChange={(e) => edit({ fingerprint: e.target.value.trim() })}
          />
        </Field>
      </details>
      <Button
        disabled={
          props.busy || alreadyStored || !peer.origin || !peer.publicKey || !peer.fingerprint
        }
        onClick={() => void pin()}
      >
        {t(`${NS}.pin`)}
      </Button>
    </>
  );
}
