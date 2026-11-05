import { useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { parseCoordinateInput } from "../../../lib/coordinateParse";
import {
  pointsInsideOf,
  trackErrorKey,
  travTrackApi,
  type PrivacyZone,
} from "../../../lib/api/travtrack";
import Button from "../../ui/Button";
import { Field, Input, Select } from "../../ui/Field";
import { SettingItem, StatusValue } from "../../ui/settings";
import { useBlockConfirm } from "../useBlockConfirm";
import { RowFailure, useRowAction } from "./useRowAction";

/** The circles offered, metres: a flat to a small town (the server takes 50–5000). */
export const ZONE_RADII = [100, 250, 500, 1000, 2000] as const;

const NS = "settings:location.tt.zones";

/**
 * The privacy zones as one list row: each can be removed, a new one can be
 * added. A zone over stored positions deletes them, so the first attempt only
 * asks the server; when it names `pointsInside`, the confirmation shows the
 * amount and only a yes sends the zone again with `deleteStoredPoints`.
 * Removing a zone brings back nothing — the confirmation says so.
 *
 * Both writes keep the form and the list as they were on a refusal and offer
 * "Erneut versuchen" under the row.
 */
export default function TravTrackZonesRow({
  zones,
  loadFailed,
  onReload,
  canAdd,
  canRemove,
  canEdit = false,
  onChanged,
}: {
  zones: PrivacyZone[];
  loadFailed: boolean;
  onReload: () => void;
  canAdd: boolean;
  canRemove: boolean;
  /** A zone can be edited (PATCH): name, centre, radius. */
  canEdit?: boolean;
  /** A zone was added or removed: stored positions or the list changed. */
  onChanged: () => Promise<void> | void;
}): JSX.Element {
  const { t } = useTranslation(["settings"]);
  const { confirm, dialog } = useBlockConfirm();
  const [name, setName] = useState("");
  const [centre, setCentre] = useState("");
  const [radiusM, setRadiusM] = useState<number>(250);
  const [note, setNote] = useState<string | null>(null);
  const add = useRowAction((err) => {
    const key = trackErrorKey(err);
    return t(key === "track:errors.generic" ? `${NS}.notAdded` : key);
  });
  const remove = useRowAction(() => t(`${NS}.notRemoved`));
  const [editing, setEditing] = useState<PrivacyZone | null>(null);
  const [editName, setEditName] = useState("");
  const [editCentre, setEditCentre] = useState("");
  const [editRadius, setEditRadius] = useState(250);
  const edit = useRowAction((err) => {
    const key = trackErrorKey(err);
    return t(key === "track:errors.generic" ? `${NS}.notSaved` : key);
  });
  const editPoint = parseCoordinateInput(editCentre);

  const point = parseCoordinateInput(centre);
  const canSubmit = name.trim() !== "" && point !== null && !add.busy;

  const addZone = async (): Promise<void> => {
    if (!point) return;
    setNote(null);
    const input = { name: name.trim(), lat: point.lat, lon: point.lon, radiusM };
    const ok = await add.run(async () => {
      let result;
      try {
        result = await travTrackApi.createZone(input);
      } catch (err) {
        const inside = pointsInsideOf(err);
        if (inside === null) throw err;
        const agreed = await confirm({
          title: t(`${NS}.addTitle`),
          affects: t(`${NS}.confirmAffects`, { name: input.name }),
          amount: t(`${NS}.confirmAmount`, { count: inside }),
          after: t(`${NS}.confirmAfter`),
          confirmLabel: t(`${NS}.confirmDo`, { count: inside }),
        });
        if (!agreed) return;
        result = await travTrackApi.createZone({ ...input, deleteStoredPoints: true });
      }
      setName("");
      setCentre("");
      setNote(
        result.deleted > 0 ? t(`${NS}.addedDeleted`, { count: result.deleted }) : t(`${NS}.added`)
      );
      await onChanged();
    });
    if (!ok) setNote(null);
  };

  const startEdit = (zone: PrivacyZone): void => {
    edit.clear();
    setEditing(zone);
    setEditName(zone.name);
    setEditCentre(`${zone.lat}, ${zone.lon}`);
    setEditRadius(zone.radiusM);
  };

  const saveEdit = async (): Promise<void> => {
    if (!editing || !editPoint) return;
    const zone = editing;
    const patch = {
      name: editName.trim(),
      lat: editPoint.lat,
      lon: editPoint.lon,
      radiusM: editRadius,
    };
    const ok = await edit.run(async () => {
      try {
        await travTrackApi.updateZone(zone.id, patch);
      } catch (err) {
        const inside = pointsInsideOf(err);
        if (inside === null) throw err;
        const agreed = await confirm({
          title: t(`${NS}.editTitle`),
          affects: t(`${NS}.confirmAffects`, { name: patch.name }),
          amount: t(`${NS}.confirmAmount`, { count: inside }),
          after: t(`${NS}.confirmAfter`),
          confirmLabel: t(`${NS}.confirmDo`, { count: inside }),
        });
        if (!agreed) return;
        await travTrackApi.updateZone(zone.id, { ...patch, deleteStoredPoints: true });
      }
      setEditing(null);
      await onChanged();
    });
    if (!ok) setNote(null);
  };

  const removeZone = async (zone: PrivacyZone): Promise<void> => {
    setNote(null);
    await remove.run(async () => {
      const agreed = await confirm({
        title: t(`${NS}.removeTitle`, { name: zone.name }),
        affects: t(`${NS}.removeAffects`, { name: zone.name }),
        amount: t(`${NS}.removeAmount`, { metres: zone.radiusM }),
        after: t(`${NS}.removeAfter`),
        confirmLabel: t(`${NS}.removeDo`),
      });
      if (!agreed) return;
      await travTrackApi.deleteZone(zone.id);
      await onChanged();
    });
  };

  return (
    <SettingItem title={t(`${NS}.name`)} sub={t(`${NS}.sub`)} help={t(`${NS}.help`)}>
      {loadFailed ? (
        <RowFailure error={t(`${NS}.loadError`)} onRetry={onReload} />
      ) : zones.length === 0 ? (
        <p className="t-caption" style={{ margin: 0 }}>
          {t(`${NS}.none`)}
        </p>
      ) : (
        <ul className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
          {zones.map((zone) => (
            <li
              key={zone.id}
              className="flex items-center justify-between"
              style={{ gap: "var(--ts-space-md)" }}
            >
              <span className="t-body">
                {zone.name} <StatusValue>{t(`${NS}.radius`, { metres: zone.radiusM })}</StatusValue>
              </span>
              {canEdit ? (
                <Button
                  disabled={edit.busy}
                  aria-label={`${t(`${NS}.edit`)}: ${zone.name}`}
                  onClick={() => startEdit(zone)}
                >
                  {t(`${NS}.edit`)}
                </Button>
              ) : null}
              {canRemove ? (
                <Button
                  disabled={remove.busy}
                  aria-label={`${t(`${NS}.remove`)}: ${zone.name}`}
                  onClick={() => void removeZone(zone)}
                >
                  {t(`${NS}.remove`)}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <RowFailure error={remove.error} onRetry={remove.retry} />

      {editing ? (
        <div
          className="flex flex-col"
          style={{ gap: "var(--ts-space-sm)" }}
          role="group"
          aria-label={t(`${NS}.editTitle`)}
        >
          <Field label={t(`${NS}.fields.name`)} htmlFor="travtrack-zone-edit-name">
            <Input
              id="travtrack-zone-edit-name"
              value={editName}
              maxLength={80}
              onChange={(e) => setEditName(e.target.value)}
            />
          </Field>
          <Field
            label={t(`${NS}.fields.centre`)}
            htmlFor="travtrack-zone-edit-centre"
            hint={t(`${NS}.centreHint`)}
            error={
              editCentre.trim() !== "" && editPoint === null ? t(`${NS}.centreInvalid`) : undefined
            }
          >
            <Input
              id="travtrack-zone-edit-centre"
              value={editCentre}
              onChange={(e) => setEditCentre(e.target.value)}
            />
          </Field>
          <Field label={t(`${NS}.fields.radius`)} htmlFor="travtrack-zone-edit-radius">
            <Select
              id="travtrack-zone-edit-radius"
              value={String(editRadius)}
              onChange={(e) => setEditRadius(Number(e.target.value))}
            >
              {[...new Set<number>([...ZONE_RADII, editRadius])]
                .sort((a, b) => a - b)
                .map((metres) => (
                  <option key={metres} value={metres}>
                    {t(`${NS}.radius`, { metres })}
                  </option>
                ))}
            </Select>
          </Field>
          <div className="flex" style={{ gap: "var(--ts-space-sm)" }}>
            <Button
              variant="primary"
              disabled={editName.trim() === "" || editPoint === null || edit.busy}
              onClick={() => void saveEdit()}
            >
              {t(`${NS}.save`)}
            </Button>
            <Button disabled={edit.busy} onClick={() => setEditing(null)}>
              {t(`${NS}.cancel`)}
            </Button>
          </div>
          <RowFailure error={edit.error} onRetry={edit.retry} />
        </div>
      ) : null}

      {canAdd ? (
        <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
          <Field label={t(`${NS}.fields.name`)} htmlFor="travtrack-zone-name">
            <Input
              id="travtrack-zone-name"
              value={name}
              maxLength={80}
              placeholder={t(`${NS}.namePlaceholder`)}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field
            label={t(`${NS}.fields.centre`)}
            htmlFor="travtrack-zone-centre"
            hint={t(`${NS}.centreHint`)}
            error={centre.trim() !== "" && point === null ? t(`${NS}.centreInvalid`) : undefined}
          >
            <Input
              id="travtrack-zone-centre"
              value={centre}
              onChange={(e) => setCentre(e.target.value)}
            />
          </Field>
          <Field label={t(`${NS}.fields.radius`)} htmlFor="travtrack-zone-radius">
            <Select
              id="travtrack-zone-radius"
              value={String(radiusM)}
              onChange={(e) => setRadiusM(Number(e.target.value))}
            >
              {ZONE_RADII.map((metres) => (
                <option key={metres} value={metres}>
                  {t(`${NS}.radius`, { metres })}
                </option>
              ))}
            </Select>
          </Field>
          <div>
            <Button variant="primary" disabled={!canSubmit} onClick={() => void addZone()}>
              {t(`${NS}.add`)}
            </Button>
          </div>
          <RowFailure error={add.error} onRetry={add.retry} />
        </div>
      ) : null}
      {note ? (
        <p role="status" className="t-caption" style={{ margin: 0, color: "var(--ts-good)" }}>
          {note}
        </p>
      ) : null}
      {dialog}
    </SettingItem>
  );
}
