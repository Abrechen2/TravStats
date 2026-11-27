import Dialog from "../ui/Dialog";
import type { Trip } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { useTripModalForm } from "./tripModalForm";
import { AppearanceTab, GeneralTab, NotesTab, PeopleTab, TABS } from "./tripModalParts";
import { Tabs } from "../ui/Tabs";
import { Icon } from "../ui/Icon";

interface TripModalProps {
  trip: Trip | null; // null = create mode
  onClose: () => void;
  onSaved: () => void;
  /** The gap calendar's days, for a new trip. */
  initialDates?: { from: string; to: string };
}

export default function TripModal({
  trip,
  onClose,
  onSaved,
  initialDates,
}: TripModalProps): JSX.Element {
  const { t } = useTranslation(["trips", "common"]);
  const f = useTripModalForm(trip, onSaved, initialDates);

  return (
    <Dialog
      open
      onClose={onClose}
      busy={f.saving}
      maxWidth={672}
      title={trip ? t("trips:editTrip") : t("trips:createTrip")}
      footer={
        <>
          <button
            onClick={onClose}
            type="button"
            className="px-4 py-2 rounded-lg text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            {t("trips:modal.cancel")}
          </button>
          <button
            onClick={() => void f.handleSave()}
            disabled={f.saving || f.datesOutOfOrder}
            type="button"
            className="px-4 py-2 rounded-lg text-sm font-medium bg-(--accent) text-(--bg-base) disabled:opacity-50"
          >
            {f.saving ? "…" : t("trips:modal.save")}
          </button>
        </>
      }
    >
      <div className="pb-3">
        <Tabs
          label={t("trips:modalTabs.label")}
          value={f.tab}
          onChange={f.setTab}
          tabs={TABS.map((tDef) => ({
            value: tDef.id,
            label: (
              <>
                <Icon name={tDef.icon} size={16} />
                {t(`trips:modalTabs.${tDef.id}`)}
              </>
            ),
          }))}
        />
      </div>

      <div className="space-y-4">
        {f.tab === "general" && <GeneralTab f={f} />}
        {f.tab === "people" && <PeopleTab f={f} />}
        {f.tab === "appearance" && <AppearanceTab f={f} trip={trip} />}
        {f.tab === "notes" && <NotesTab f={f} />}
      </div>
    </Dialog>
  );
}
