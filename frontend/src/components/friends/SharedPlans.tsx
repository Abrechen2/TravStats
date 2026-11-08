import type { JSX } from "react";
import { Link } from "react-router-dom";
import { Button, ListRow } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import type { Friend, FriendPlans } from "../../lib/friends/types";
import type { Loaded } from "./loadState";

interface Props {
  friend: Friend;
  plans: Loaded<FriendPlans>;
  onInvite: () => void;
  onRetry: () => void;
}

/** Gemeinsame Pläne — the one section that needs the switch on BOTH sides (§11.7). */
export default function SharedPlans({ friend, plans, onInvite, onRetry }: Props): JSX.Element {
  const { t } = useTranslation(["comparison"]);
  const tr = (key: string, options?: Record<string, unknown>): string =>
    String(t(key, options ?? {}));
  const name = friend.displayName;
  const bothOn = friend.mine.plans && friend.theirs.plans;
  return (
    <section
      className="flex flex-col"
      aria-label={tr("friend.plans.title")}
      style={{ gap: "var(--ts-space-md)" }}
    >
      <h3 className="t-screen-title">{tr("friend.plans.title")}</h3>
      {plans.status === "loading" && <p className="t-caption">{tr("friend.loading")}</p>}
      {plans.status === "error" && (
        <p role="alert">
          {tr("friend.plans.loadFailed")}{" "}
          <Button variant="secondary" onClick={onRetry}>
            {tr("friend.retry")}
          </Button>
        </p>
      )}
      {plans.status === "ok" &&
        (plans.value.plans.length === 0 ? (
          <p className="t-caption">{tr("friend.plans.none")}</p>
        ) : (
          plans.value.plans.map((p) => (
            <ListRow key={p.id} title={<Link to={`/plan/${p.id}`}>{p.title}</Link>} />
          ))
        ))}
      {bothOn ? (
        <div>
          <Button variant="secondary" onClick={onInvite}>
            {tr("friend.plans.invite")}
          </Button>
        </div>
      ) : (
        <p className="t-caption" data-testid="plans-off">
          {friend.theirs.plans
            ? tr("friend.plans.mineOff")
            : tr("friend.plans.theirsOff", { name })}
        </p>
      )}
    </section>
  );
}
