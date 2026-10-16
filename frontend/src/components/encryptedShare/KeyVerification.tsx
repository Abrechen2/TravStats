import { FingerprintImage } from "./FingerprintQR";
import { useEffect, useState } from "react";
import { Button } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import { pinnedDevices, pinDevice } from "../../lib/encryptedShare/vault";
import type { DeviceKeys, PublicDevice } from "../../lib/encryptedShare/crypto";
import { deviceBinding, type Audience, type Target } from "../../lib/encryptedShare/transport";
export default function KeyVerification({
  account,
  device,
  audience,
  target,
  onVerified,
}: {
  account: string;
  device: DeviceKeys;
  audience: Audience;
  target: Target;
  onVerified: () => void;
}) {
  const { t } = useTranslation("encryptedShare");
  const [pins, setPins] = useState<Record<string, PublicDevice>>({}),
    [values, setValues] = useState<Record<string, string>>({}),
    [error, setError] = useState(false);
  useEffect(() => {
    void pinnedDevices(account)
      .then(setPins)
      .catch(() => setError(true));
  }, [account, audience]);
  return (
    <section className="rounded-xl border border-[var(--ts-border)] p-4 space-y-3">
      <h3>{t("e2e.verifyTitle")}</h3>
      <p>{t("e2e.verifyHelp")}</p>
      {error && <p role="alert">{t("e2e.verifyError")}</p>}
      {audience.members.map((m) => (
        <div key={m.source}>
          <h4 className="font-bold">
            {m.label === "host" ? t("hostPerson") : m.label} ·{" "}
            {m.origin === "local" ? t("local") : m.origin}
          </h4>
          {!m.devices.length && <p>{t("e2e.noDevice")}</p>}
          {m.devices.map((d) => {
            const binding = deviceBinding(target, m.source),
              key = `${binding}:${d.fingerprint}`,
              verified = d.fingerprint === device.public.fingerprint || !!pins[key];
            return (
              <div key={key} className="py-3 break-all">
                <p>{d.name}</p>
                <code>{d.fingerprint}</code>
                {verified ? (
                  <p>{t("e2e.verified")}</p>
                ) : (
                  <>
                    <label>
                      {t("e2e.enterFingerprint")}
                      <input
                        value={values[key] ?? ""}
                        onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                        autoComplete="off"
                      />
                    </label>
                    <FingerprintImage
                      onRead={(fingerprint) => setValues((v) => ({ ...v, [key]: fingerprint }))}
                      onError={() => setError(true)}
                    />
                    <Button
                      onClick={() => {
                        setError(false);
                        void pinDevice(account, d, values[key] ?? "", binding)
                          .then(() => pinnedDevices(account))
                          .then((p) => {
                            setPins(p);
                            onVerified();
                          })
                          .catch(() => setError(true));
                      }}
                    >
                      {t("e2e.verify")}
                    </Button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}
