import { useRef, useState } from "react";
import type { JSX } from "react";
import {
  federationAdminApi,
  federationErrorCode,
  type ConnectionFileInspection,
} from "../../lib/api/federationAdmin";
import { downloadBlob } from "../../lib/export";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { Button } from "../ui";

const NS = "federation";
const errorKeyOf = (error: unknown) => `${NS}.error.${federationErrorCode(error) ?? "generic"}`;

/**
 * "Verbindungsdatei herunterladen": this server's address, key and fingerprint as the ZIP the
 * server builds. `stale` while the address field differs from the saved one — the file names
 * the saved address, and handing that on while the admin is mid-edit would send the old one.
 */
export function ConnectionFileDownload(props: {
  disabled: boolean;
  stale: boolean;
  onError: (key: string | null) => void;
}): JSX.Element {
  const { t } = useTranslation(["admin"]);
  const [busy, setBusy] = useState(false);
  const download = async (): Promise<void> => {
    setBusy(true);
    props.onError(null);
    try {
      const { blob, filename } = await federationAdminApi.downloadConnectionFile();
      downloadBlob(blob, filename);
    } catch (error) {
      logger.error("Downloading the connection file failed:", error);
      props.onError(errorKeyOf(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <Button
        variant="secondary"
        disabled={props.disabled || props.stale || busy}
        onClick={() => void download()}
      >
        {t(`${NS}.downloadFile`)}
      </Button>
      <p className="t-caption">
        {t(props.stale ? `${NS}.downloadOriginPending` : `${NS}.downloadHint`)}
      </p>
    </div>
  );
}

/**
 * "Verbindungsdatei einlesen": the server reads the file and answers what it says. Nothing is
 * pinned here — the values go into the peer form for the admin to compare and pin.
 */
export function ConnectionFileImport(props: {
  disabled: boolean;
  onImported: (inspection: ConnectionFileInspection) => void;
  onError: (key: string | null) => void;
}): JSX.Element {
  const { t } = useTranslation(["admin"]);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const read = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setBusy(true);
    props.onError(null);
    try {
      props.onImported(await federationAdminApi.inspectConnectionFile(file));
    } catch (error) {
      logger.error("Reading the connection file failed:", error);
      props.onError(errorKeyOf(error));
    } finally {
      setBusy(false);
      // The same file again after a fix on the other side must fire `change` once more.
      if (input.current) input.current.value = "";
    }
  };
  return (
    <div>
      <input
        ref={input}
        type="file"
        accept=".zip,.json,application/zip,application/json"
        className="hidden"
        data-testid="connection-file-input"
        aria-label={t(`${NS}.importFile`)}
        onChange={(e) => void read(e.target.files?.[0])}
      />
      <Button
        variant="secondary"
        disabled={props.disabled || busy}
        onClick={() => input.current?.click()}
      >
        {t(`${NS}.importFile`)}
      </Button>
      <p className="t-caption">{t(`${NS}.importHint`)}</p>
    </div>
  );
}
