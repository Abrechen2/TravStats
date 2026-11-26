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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        className="w-full max-w-2xl rounded-xl shadow-2xl max-h-[90vh] overflow-hidden flex flex-col"
        role="dialog"
        aria-modal="true"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
      >
        <div className="p-5 border-b" style={{ borderColor: "var(--color-border)" }}>
          <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            {trip ? t("trips:editTrip") : t("trips:createTrip")}
          </h2>
        </div>

        <div className="px-3 pt-3">
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

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {f.tab === "general" && <GeneralTab f={f} />}
          {f.tab === "people" && <PeopleTab f={f} />}
          {f.tab === "appearance" && <AppearanceTab f={f} trip={trip} />}
          {f.tab === "notes" && <NotesTab f={f} />}
        </div>

        <div
          className="flex justify-end gap-2 p-4 border-t"
          style={{ borderColor: "var(--color-border)" }}
        >
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
        </div>
      </div>
    </div>
  );
}
