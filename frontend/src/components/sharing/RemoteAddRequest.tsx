import { useState } from "react";
import type { FormEvent, JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import type { AddRequestBody } from "../../types/sharingRemote";
import { Button, Field, Input, TextArea } from "../ui";

const NS = "sharing:remote.trip.addRequest";

/**
 * For a trip that came from another server (spec 2026-10-20 F5, F-S4e): only its home offers it
 * to someone new, so here the reader asks the person they share it with there. The request lands
 * in that person's inbox; nothing is offered by it.
 */
export default function RemoteAddRequest({
  tripId,
  homeOrigin,
  busy,
  onSubmit,
}: {
  tripId: string;
  homeOrigin: string;
  busy: boolean;
  onSubmit: (body: AddRequestBody) => Promise<boolean>;
}): JSX.Element {
  const { t } = useTranslation(["sharing"]);
  const [name, setName] = useState("");
  const [origin, setOrigin] = useState("");
  const [note, setNote] = useState("");

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const body: AddRequestBody = {
      displayName: name.trim(),
      ...(origin.trim() ? { origin: origin.trim().replace(/\/+$/, "") } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    if (await onSubmit(body)) {
      setName("");
      setOrigin("");
      setNote("");
    }
  };

  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => void submit(e)}>
      <h4 className="t-label-mono">{t(`${NS}.title`)}</h4>
      <p className="t-caption">{t(`${NS}.hint`, { origin: homeOrigin })}</p>
      <Field label={t(`${NS}.name`)} htmlFor={`add-request-name-${tripId}`}>
        <Input
          id={`add-request-name-${tripId}`}
          value={name}
          maxLength={160}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field
        label={t(`${NS}.origin`)}
        htmlFor={`add-request-origin-${tripId}`}
        hint={t(`${NS}.originHint`)}
      >
        <Input
          id={`add-request-origin-${tripId}`}
          value={origin}
          placeholder="https://travstats.example.org"
          onChange={(e) => setOrigin(e.target.value)}
        />
      </Field>
      <Field label={t(`${NS}.note`)} htmlFor={`add-request-note-${tripId}`}>
        <TextArea
          id={`add-request-note-${tripId}`}
          value={note}
          maxLength={500}
          rows={2}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      <div>
        <Button type="submit" disabled={busy || name.trim() === ""}>
          {t(`${NS}.submit`)}
        </Button>
      </div>
    </form>
  );
}
