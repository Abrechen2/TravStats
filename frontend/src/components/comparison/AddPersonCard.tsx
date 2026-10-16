import { useState } from "react";
import { Button, Card, Field, Input, SectionLabel } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import { comparisonApi, comparisonFailureCode } from "../../lib/api/comparison";
import { logger } from "../../lib/logger";
import ConsentDialog from "./ConsentDialog";

/** `<origin>#<64 hex>` — the shape the server mints; anything else is a typo, caught before sending. */
const INVITE_CODE = /^https?:\/\/[^\s#]+#[a-f0-9]{64}$/;

type Pending =
  { kind: "username"; username: string } | { kind: "code"; code: string; origin: string | null };

/**
 * Same server: ask by username. Another server: pass on a code, or redeem one.
 * A freshly minted code lives in component state only — it is shown once and
 * never written to browser storage.
 */
export default function AddPersonCard({ onChanged }: { onChanged: () => void }): JSX.Element {
  const { t } = useTranslation(["comparison"]);
  const tr = (key: string, options?: Record<string, unknown>): string =>
    String(t(key, options ?? {}));
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [invite, setInvite] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const trimmed = code.trim();
  const codeValid = INVITE_CODE.test(trimmed);
  const codeInvalid = trimmed !== "" && !codeValid;

  const createInvite = async (): Promise<void> => {
    setFailed(null);
    setCopied(false);
    try {
      setInvite((await comparisonApi.createInvite()).code);
    } catch (failure) {
      setFailed(tr(`error.${comparisonFailureCode(failure)}`));
    }
  };
  const copyInvite = async (): Promise<void> => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite);
      setCopied(true);
    } catch (failure) {
      // The field stays selectable, so copying by hand still works.
      logger.debug("invite copy failed", failure);
    }
  };

  return (
    <Card style={{ marginTop: "var(--ts-space-2xl)" }}>
      <div className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
        <SectionLabel>{tr("add.title")}</SectionLabel>
        <Field label={tr("add.username")} htmlFor="comparison-username">
          <Input
            id="comparison-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </Field>
        <div>
          <Button
            disabled={!username.trim()}
            onClick={() => setPending({ kind: "username", username: username.trim() })}
          >
            {tr("add.ask")}
          </Button>
        </div>

        <SectionLabel>{tr("add.inviteTitle")}</SectionLabel>
        <div>
          <Button variant="secondary" onClick={() => void createInvite()}>
            {tr("add.createInvite")}
          </Button>
        </div>
        {invite && (
          <Field
            label={tr("add.inviteCodeLabel")}
            htmlFor="comparison-invite"
            hint={`${tr("add.inviteHint")} ${tr("add.inviteOnce")}`}
          >
            <div className="flex" style={{ gap: "var(--ts-space-xs)" }}>
              <Input
                id="comparison-invite"
                readOnly
                value={invite}
                onFocus={(e) => e.target.select()}
              />
              <Button variant="secondary" onClick={() => void copyInvite()}>
                {tr(copied ? "add.copied" : "add.copy")}
              </Button>
            </div>
          </Field>
        )}

        <Field
          label={tr("add.claimLabel")}
          htmlFor="comparison-claim"
          error={codeInvalid ? tr("add.claimInvalid") : undefined}
        >
          <Input
            id="comparison-claim"
            value={code}
            invalid={codeInvalid}
            onChange={(e) => setCode(e.target.value)}
          />
        </Field>
        <div>
          <Button
            variant="secondary"
            disabled={!codeValid}
            onClick={() =>
              setPending({ kind: "code", code: trimmed, origin: trimmed.split("#")[0] || null })
            }
          >
            {tr("add.claim")}
          </Button>
        </div>
        {failed && <p role="alert">{failed}</p>}
      </div>
      {pending && (
        <ConsentDialog
          open
          person={
            pending.kind === "username"
              ? { displayName: pending.username, origin: null }
              : { displayName: tr("people.remoteFriend"), origin: pending.origin }
          }
          onClose={() => setPending(null)}
          onConfirm={async (scope) => {
            if (pending.kind === "username") await comparisonApi.request(pending.username, scope);
            else await comparisonApi.claimInvite(pending.code, scope);
            setPending(null);
            setUsername("");
            setCode("");
            onChanged();
          }}
        />
      )}
    </Card>
  );
}
