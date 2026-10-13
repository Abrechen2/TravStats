import { useEffect, useState } from "react";
import { Button } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import { comparisonGet, comparisonPost, comparisonDelete } from "../../lib/api/comparison";
import {
  generateDevice,
  recoverDevice,
  type DeviceKeys,
  type PublicDevice,
} from "../../lib/comparison/crypto";
import { localDevice, storeDevice } from "../../lib/comparison/vault";
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name.replace(/[\\/]/g, "_");
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function DevicePanel({
  account,
  onDevice,
}: {
  account: string;
  onDevice: (d: DeviceKeys | null) => void;
}) {
  const { t } = useTranslation("comparison");
  const [device, setDevice] = useState<DeviceKeys | null>(null),
    [devices, setDevices] = useState<PublicDevice[]>([]),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  const [recovery, setRecovery] = useState<Awaited<ReturnType<typeof generateDevice>> | null>(null),
    [code, setCode] = useState(""),
    [file, setFile] = useState<File | null>(null);
  const refresh = async () => {
    const list = await comparisonGet<PublicDevice[]>("/sealed/devices"),
      d = await localDevice(account);
    setDevices(list);
    const active = d && list.some((p) => p.fingerprint === d.public.fingerprint) ? d : null;
    setDevice(active);
    onDevice(active);
  };
  useEffect(() => {
    void refresh().catch(() => setError(true));
  }, [account]); // device identities are account-scoped
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(false);
    try {
      await fn();
      await refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rounded-2xl border border-[var(--ts-border)] p-5 space-y-4">
      <h2 className="text-xl font-bold">{t("e2e.deviceTitle")}</h2>
      <p>{t("e2e.boundary")}</p>
      {error && <p role="alert">{t("e2e.deviceError")}</p>}
      {device ? (
        <p>
          {device.public.name} · <code className="break-all">{device.public.fingerprint}</code>
        </p>
      ) : (
        <>
          <label>
            {t("e2e.deviceName")}
            <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </label>
          <Button
            disabled={busy || !name.trim()}
            onClick={() =>
              void run(async () => {
                const generated = await generateDevice(name.trim());
                await comparisonPost("/sealed/devices", generated.device.public);
                await storeDevice(account, generated.device);
                setRecovery(generated);
              })
            }
          >
            {t("e2e.createDevice")}
          </Button>
          <details>
            <summary>{t("e2e.restore")}</summary>
            <p>{t("e2e.restoreHelp")}</p>
            <input
              type="file"
              accept="application/json"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <label>
              {t("e2e.recoveryCode")}
              <input
                type="password"
                autoComplete="off"
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <Button
              disabled={busy || !file || !code}
              onClick={() =>
                void run(async () => {
                  if (!file || file.size > 20000) throw Error("backup");
                  const restored = await recoverDevice(JSON.parse(await file.text()), code);
                  await comparisonPost("/sealed/devices", restored.public);
                  await storeDevice(account, restored);
                  setCode("");
                })
              }
            >
              {t("e2e.restore")}
            </Button>
          </details>
        </>
      )}
      {recovery && (
        <div className="space-y-3 rounded-xl bg-[var(--ts-surface)] p-4">
          <p>{t("e2e.backupHelp")}</p>
          <label>
            {t("e2e.recoveryCode")}
            <code className="block break-all select-all">{recovery.recoveryCode}</code>
          </label>
          <Button
            onClick={() =>
              downloadBlob(
                new Blob([JSON.stringify(recovery.backup)], { type: "application/json" }),
                "travstats-device-recovery.json"
              )
            }
          >
            {t("e2e.backupDownload")}
          </Button>
          <Button onClick={() => setRecovery(null)}>{t("e2e.backupSaved")}</Button>
        </div>
      )}
      <ul>
        {devices.map((d) => (
          <li key={d.id} className="py-2 break-all">
            {d.name} · {d.fingerprint.slice(0, 16)}…{" "}
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await comparisonDelete(`/sealed/devices/${d.id}`);
                })
              }
            >
              {t("e2e.revokeDevice")}
            </Button>
          </li>
        ))}
      </ul>
      <p className="text-sm">{t("e2e.deviceHelp")}</p>
    </section>
  );
}
