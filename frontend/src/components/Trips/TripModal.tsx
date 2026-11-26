import Dialog from "../ui/Dialog";
import type { Trip } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { useTripModalForm } from "./tripModalForm";
import { AppearanceTab, GeneralTab, NotesTab, PeopleTab, TABS } from "./tripModalParts";

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
      <div
        className="flex gap-1 pb-3"
        style={{ borderBottom: "1px solid var(--color-border)" }}
        role="tablist"
      >
        {TABS.map((tDef) => {
          const active = f.tab === tDef.id;
          return (
            <button
              key={tDef.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => f.setTab(tDef.id)}
              className="px-3 py-2 text-sm rounded-t-md transition-colors flex items-center gap-1.5"
              style={{
                background: active ? "var(--bg-surface)" : "transparent",
                borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
                color: active ? "var(--text-primary)" : "var(--text-secondary)",
                fontWeight: active ? 600 : 400,
                marginBottom: "-1px",
              }}
            >
              <span>{tDef.icon}</span>
              <span>{t(`trips:modalTabs.${tDef.id}`)}</span>
            </button>
          );
        })}
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
