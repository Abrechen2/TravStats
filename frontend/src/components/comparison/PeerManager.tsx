import { useEffect, useState } from "react";
import { Button } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import { comparisonGet, comparisonPost, type PeerState } from "../../lib/api/comparison";
export default function PeerManager() {
  const { t } = useTranslation("comparison");
  const [state, setState] = useState<PeerState | null>(null),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState(""),
    [publicKey, setKey] = useState(""),
    [fingerprint, setFingerprint] = useState("");
  const load = () =>
    comparisonGet<PeerState>("/peers")
      .then(setState)
      .catch(() => setError(true));
  useEffect(() => {
    void load();
  }, []);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(false);
    try {
      await fn();
      await load();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-bold">{t("peerTitle")}</h2>
      {error && <p role="alert">{t("error")}</p>}
      {!state?.local ? (
        <p>{t("remoteUnavailable")}</p>
      ) : (
        <>
          <p>{t("peerHelp")}</p>
          <div className="rounded-xl border p-4 break-all">
            <p>{state.local.origin}</p>
            <pre className="whitespace-pre-wrap">{state.local.publicKey}</pre>
            <code>{state.local.fingerprint}</code>
          </div>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() =>
                comparisonPost("/peers", { origin, publicKey, fingerprint, enabled: true })
              );
            }}
          >
            <label>
              {t("server")}
              <input
                type="url"
                required
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
              />
            </label>
            <label>
              {t("publicKey")}
              <textarea required value={publicKey} onChange={(e) => setKey(e.target.value)} />
            </label>
            <label>
              {t("fingerprint")}
              <input
                required
                value={fingerprint}
                onChange={(e) => setFingerprint(e.target.value)}
              />
            </label>
            <Button disabled={busy} type="submit">
              {t("admit")}
            </Button>
          </form>
          {state.peers.map((peer) => (
            <div className="flex flex-wrap gap-3 items-center" key={peer.origin}>
              <span>
                {peer.origin} · {t(peer.verifiedAt ? "verified" : "pending")}
              </span>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(() => comparisonPost("/peers/verify", { origin: peer.origin }))
                }
              >
                {t("verifyPeer")}
              </Button>
            </div>
          ))}{" "}
        </>
      )}
    </section>
  );
}
