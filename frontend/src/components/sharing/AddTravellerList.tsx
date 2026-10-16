import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import type { SharePerson } from "../../types/sharing";
import { Button } from "../ui";

const NS = "sharing:shareDialog.add";

/**
 * Accounts that agreed to sharing with the reader but are not travellers on
 * this trip — the share dialog's way on when nobody can be chosen yet. One
 * action each: add the account as a traveller and link it.
 */
export default function AddTravellerList({
  users,
  busy,
  onAdd,
}: {
  users: readonly SharePerson[];
  busy: boolean;
  onAdd: (user: SharePerson) => void;
}): JSX.Element {
  const { t } = useTranslation(["sharing"]);
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
      <p className="text-sm">{t(`${NS}.title`)}</p>
      <ul className="flex flex-col" style={{ gap: "var(--ts-space-xs)" }}>
        {users.map((user) => (
          <li
            key={user.id}
            className="flex flex-wrap items-center justify-between"
            style={{ gap: 8 }}
          >
            <span className="text-sm">
              {user.displayName} (@{user.username})
            </span>
            <Button
              disabled={busy}
              aria-label={t(`${NS}.actionLabel`, { name: user.displayName })}
              onClick={() => onAdd(user)}
            >
              {t(`${NS}.action`)}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
