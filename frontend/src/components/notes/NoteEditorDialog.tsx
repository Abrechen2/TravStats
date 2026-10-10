import { useId, useMemo, useRef, useState, type JSX } from "react";

import Modal from "../Modal";
import { FormErrorBanner } from "../form";
import { Button, Field, Input, Select, TextArea, Toggletip } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
import { useTodayZone } from "../../hooks/useTodayZone";
import { notesApi, notePhotoSrc, type Note } from "../../lib/api/notes";
import { logger } from "../../lib/logger";
import { saveErrorKey } from "../../lib/saveErrorMessage";
import { supportedZones } from "../../shared/time";
import {
  draftMoment,
  draftOfNote,
  draftProblems,
  newNoteDraft,
  sameDraft,
  type DraftProblems,
  type NoteDraft,
} from "./noteDraft";
import { localPhotoProblem, NOTE_PHOTO_TYPES, photoErrorKey } from "./notePhotoError";

interface NoteEditorDialogProps {
  /** The note to edit; null writes a new one. */
  note: Note | null;
  onClose: () => void;
  /** Called with every stored state, including a note saved whose photo then failed. */
  onSaved: (note: Note) => void;
}

/** Codes this form names better than the shared sentences do. */
const NOTE_CODE_KEYS = { TZ_UNRESOLVED: "notes:errors.zoneMissing" } as const;

/**
 * Write or edit a standalone note (forgejo#137): the text, its date and
 * optional time in the zone it is written in, an optional place as text and
 * an optional photo.
 *
 * Two requests when a photo is involved — the note, then the photo — so the
 * second can fail after the first succeeded. The dialog then stays open on the
 * saved note and says exactly that: the note is kept, the photo is not.
 */
export default function NoteEditorDialog({
  note,
  onClose,
  onSaved,
}: NoteEditorDialogProps): JSX.Element {
  const { t } = useTranslation(["notes", "common"]);
  const profileZone = useTodayZone();
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);

  const [current, setCurrent] = useState<Note | null>(note);
  const [initial, setInitial] = useState<NoteDraft>(() =>
    note ? draftOfNote(note) : newNoteDraft(profileZone)
  );
  const [draft, setDraft] = useState<NoteDraft>(initial);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [dropPhoto, setDropPhoto] = useState(false);
  const [problems, setProblems] = useState<DraftProblems>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const zones = useMemo(() => {
    const all = supportedZones();
    return all.includes(draft.zone) ? all : [draft.zone, ...all];
  }, [draft.zone]);

  const dirty = !sameDraft(draft, initial) || photoFile !== null || dropPhoto;
  const set = (patch: Partial<NoteDraft>): void => setDraft((d) => ({ ...d, ...patch }));

  const choosePhoto = (file: File | undefined): void => {
    if (!file) return;
    const problem = localPhotoProblem(file);
    if (problem) {
      setFailure(t(problem));
      return;
    }
    setFailure(null);
    setPhotoFile(file);
    setDropPhoto(false);
  };

  const savePhoto = async (saved: Note): Promise<Note | null> => {
    try {
      if (photoFile) return await notesApi.setPhoto(saved.id, photoFile);
      if (dropPhoto && saved.photo) return await notesApi.removePhoto(saved.id);
      return saved;
    } catch (err: unknown) {
      logger.error({ err }, "NoteEditorDialog: photo step failed after the note was saved");
      const key = photoFile ? photoErrorKey(err) : "notes:errors.photoRemoveFailed";
      const reason = key.startsWith("notes:") ? "" : ` ${t(key)}`;
      setFailure(key.startsWith("notes:") ? t(key) : `${t("notes:errors.photoFailed")}${reason}`);
      return null;
    }
  };

  const save = async (): Promise<void> => {
    const found = draftProblems(draft);
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    setSaving(true);
    setFailure(null);
    let saved: Note;
    try {
      const input = {
        body: draft.body.trim(),
        moment: draftMoment(draft),
        placeName: draft.placeName.trim() === "" ? null : draft.placeName.trim(),
        visibility: draft.shareable ? ("shareable" as const) : ("private" as const),
      };
      saved = current ? await notesApi.update(current.id, input) : await notesApi.create(input);
    } catch (err: unknown) {
      logger.error({ err }, "NoteEditorDialog: save failed");
      setFailure(
        t(saveErrorKey(err, "notes:errors.saveFailed", NOTE_CODE_KEYS, { create: !current }))
      );
      setSaving(false);
      return;
    }
    onSaved(saved);
    const withPhoto = await savePhoto(saved);
    setSaving(false);
    if (withPhoto) {
      onSaved(withPhoto);
      onClose();
      return;
    }
    // The note is stored; what is left to do is the photo. Stay open on the
    // saved note so a second try edits it instead of writing a copy.
    setCurrent(saved);
    const savedDraft = draftOfNote(saved);
    setInitial(savedDraft);
    setDraft(savedDraft);
  };

  const shownPhoto = !dropPhoto && !photoFile && current?.photo ? current.photo : null;

  return (
    <Modal
      open
      onClose={onClose}
      busy={saving}
      dirty={dirty}
      title={current ? t("notes:editor.editTitle") : t("notes:editor.createTitle")}
      closeLabel={t("notes:editor.close")}
      footer={(requestClose) => (
        <div className="flex justify-end" style={{ gap: "var(--ts-space-sm)" }}>
          <Button onClick={requestClose} disabled={saving}>
            {t("notes:editor.cancel")}
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving}>
            {current ? t("notes:editor.save") : t("notes:editor.create")}
          </Button>
        </div>
      )}
    >
      <div className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
        <FormErrorBanner message={failure} />

        <Field
          label={t("notes:editor.body")}
          htmlFor={`${id}-body`}
          error={problems.body && t(problems.body)}
        >
          <TextArea
            id={`${id}-body`}
            value={draft.body}
            rows={5}
            maxLength={4000}
            placeholder={t("notes:editor.bodyPlaceholder")}
            onChange={(e) => set({ body: e.target.value })}
            autoFocus
          />
        </Field>

        <div className="grid sm:grid-cols-2" style={{ gap: "var(--ts-space-lg)" }}>
          <Field
            label={t("notes:editor.date")}
            htmlFor={`${id}-date`}
            error={problems.date && t(problems.date)}
          >
            <Input
              id={`${id}-date`}
              type="date"
              value={draft.date}
              onChange={(e) => set({ date: e.target.value })}
            />
          </Field>
          <Field
            label={t("notes:editor.time")}
            htmlFor={`${id}-time`}
            hint={t("notes:editor.timeHint")}
          >
            <Input
              id={`${id}-time`}
              type="time"
              value={draft.time}
              onChange={(e) => set({ time: e.target.value })}
            />
          </Field>
        </div>

        <Field
          label={t("notes:editor.zone")}
          htmlFor={`${id}-zone`}
          error={problems.zone && t(problems.zone)}
          hint={
            // The help sits beside the field, not inside its <label>: a button
            // in a label would hand every click on it to the select.
            <span className="inline-flex items-center" style={{ gap: "var(--ts-space-xs)" }}>
              {t("notes:editor.zoneHelpLabel")}
              <Toggletip content={t("notes:editor.zoneHint")} subject={t("notes:editor.zone")} />
            </span>
          }
        >
          <Select
            id={`${id}-zone`}
            value={draft.zone}
            onChange={(e) => set({ zone: e.target.value })}
          >
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label={t("notes:editor.place")}
          htmlFor={`${id}-place`}
          hint={t("notes:editor.placeHint")}
        >
          <Input
            id={`${id}-place`}
            value={draft.placeName}
            maxLength={200}
            placeholder={t("notes:editor.placePlaceholder")}
            onChange={(e) => set({ placeName: e.target.value })}
          />
        </Field>

        {/* A checkbox, not a switch: nothing happens until the note is saved. */}
        <div className="flex flex-col" style={{ gap: "var(--ts-space-xs)" }}>
          <label className="inline-flex items-center" style={{ gap: "var(--ts-space-sm)" }}>
            <input
              type="checkbox"
              checked={draft.shareable}
              aria-describedby={`${id}-shareable-hint`}
              onChange={(e) => set({ shareable: e.target.checked })}
            />
            {t("notes:editor.shareable")}
          </label>
          <span id={`${id}-shareable-hint`} className="t-caption">
            {t("notes:editor.shareableHint")}
          </span>
        </div>

        {/* No `htmlFor`: the visible control is the button below, and the file
            input it opens stays out of the tab order so it is not a second,
            invisible stop. */}
        <Field label={t("notes:editor.photo")}>
          <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
            {shownPhoto && (
              <img
                src={notePhotoSrc(shownPhoto)}
                alt=""
                className="max-h-48 w-auto self-start object-contain"
                style={{ borderRadius: "var(--ts-radius-card)" }}
              />
            )}
            {photoFile && (
              <span className="t-caption">
                {t("notes:editor.photoSelected", { name: photoFile.name })}
              </span>
            )}
            {dropPhoto && <span className="t-caption">{t("notes:editor.photoWillBeRemoved")}</span>}
            <input
              ref={fileInput}
              type="file"
              tabIndex={-1}
              aria-hidden="true"
              accept={NOTE_PHOTO_TYPES.join(",")}
              className="sr-only"
              onChange={(e) => {
                choosePhoto(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <div className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
              <Button onClick={() => fileInput.current?.click()} disabled={saving}>
                {current?.photo || photoFile
                  ? t("notes:editor.photoReplace")
                  : t("notes:editor.photoChoose")}
              </Button>
              {(shownPhoto || photoFile) && (
                <Button
                  disabled={saving}
                  onClick={() => {
                    setPhotoFile(null);
                    setDropPhoto(Boolean(current?.photo));
                  }}
                >
                  {t("notes:editor.photoRemove")}
                </Button>
              )}
            </div>
          </div>
        </Field>
      </div>
    </Modal>
  );
}
