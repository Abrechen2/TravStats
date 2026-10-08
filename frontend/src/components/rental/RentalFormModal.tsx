import { useState } from "react";
import type { JSX } from "react";
import Modal from "../Modal";
import {
  FormErrorBanner,
  RequiredLegend,
  useDirtyGuard,
  useFormFailure,
  useSaveOnce,
} from "../form";
import { useTranslation } from "../../hooks/useTranslation";
import { rentalApi } from "../../lib/api/rental";
import { isTransientSaveError } from "../../lib/saveErrorMessage";
import { logger } from "../../lib/logger";
import type { RentalBooking } from "../../types/rental";
import {
  EMPTY_RENTAL_DRAFT,
  draftFromRental,
  rentalInputFromDraft,
  rentalSaveError,
  validateRentalDraft,
  type RentalDraft,
  type RentalFormField,
} from "./rentalFormModel";
import {
  FIELD_STEP,
  RENTAL_FORM_STEPS,
  errorsPerStep,
  firstStepWith,
  openingStep,
  type RentalFormStep,
} from "./rentalFormSteps";
import { RentalBookingStep, RentalPickupStep, RentalReturnStep } from "./RentalFormStepViews";

interface Props {
  rental: RentalBooking | null;
  onClose: () => void;
  onSaved: (saved: RentalBooking) => void | Promise<void>;
  /** The step to open on; by default the booking for a new rental, the return once picked up. */
  initialStep?: RentalFormStep;
  /** What the "stored, but the follow-up failed" notice names; the list's wording by default. */
  afterSaveFailedKey?: string;
}

const PANEL_ID = "rental-form-step-panel";
const tabId = (step: RentalFormStep): string => `rental-form-step-${step}`;

/** A refusal the server tied to one field, kept for the draft it refused. */
interface FieldRefusal {
  field: RentalFormField;
  key: string;
  draft: string;
}

/**
 * Manual entry of a rental (spec 2026-10-01-rental-domain-design §6) as three
 * short steps over ONE draft (forgejo#236): Buchung, Abholung, Rückgabe.
 * Switching steps only changes the view; every field keeps what was typed.
 * Times are typed on each STATION's clock; the server places the station and
 * reads the clock in its zone (ADR 0002).
 *
 * Pattern (forgejo#245): **enabled save, a refused click focuses the first
 * gap** — on whichever step it sits, which the dialog switches to; each step
 * tab counts its gaps. Field refusals (the form's rules and the server's, by
 * `field`) sit at their field; anything else in a persistent banner with
 * "Erneut versuchen" for a transient failure. One request per save
 * (`useSaveOnce`); a changed form asks before it is discarded (`dirty`).
 */
export function RentalFormModal({
  rental,
  onClose,
  onSaved,
  initialStep,
  afterSaveFailedKey,
}: Props): JSX.Element {
  const { t } = useTranslation(["rental", "common"]);
  // ONE source for the starting draft — the state AND the dirty baseline —
  // read once per opening, so an edit form never opens already "changed".
  const [opened] = useState<RentalDraft>(() =>
    rental ? draftFromRental(rental) : EMPTY_RENTAL_DRAFT
  );
  const [draft, setDraft] = useState<RentalDraft>(opened);
  const [step, setStep] = useState<RentalFormStep>(initialStep ?? openingStep(rental));
  const { dirty, markSaved } = useDirtyGuard(opened, draft);
  const saving = useSaveOnce<RentalBooking>({ afterSaveFailedKey });
  const draftKey = JSON.stringify(draft);
  const failure = useFormFailure(draftKey);
  const [refusal, setRefusal] = useState<FieldRefusal | null>(null);
  const fieldRefusal = refusal !== null && refusal.draft === draftKey ? refusal : null;

  // The form's own rules show from the first attempt on, then live.
  const ruleErrors = failure.attempted ? validateRentalDraft(draft) : {};
  const shownErrors = {
    ...ruleErrors,
    ...(fieldRefusal ? { [fieldRefusal.field]: fieldRefusal.key } : {}),
  };
  const errorOf = (field: RentalFormField): string | null => {
    const key = shownErrors[field];
    return key ? t(key) : null;
  };
  const perStep = errorsPerStep(shownErrors);

  const submit = async (): Promise<void> => {
    failure.markAttempted();
    const gaps = Object.keys(validateRentalDraft(draft)) as RentalFormField[];
    if (gaps.length > 0) {
      setStep(firstStepWith(gaps) ?? step);
      failure.focusFirstProblem();
      return;
    }
    failure.clear();
    setRefusal(null);
    const input = rentalInputFromDraft(draft);
    // The request and what follows it are two steps (forgejo#247): a list
    // that fails to reload must not turn a stored rental into "not saved".
    const outcome = await saving.save(
      () => (rental ? rentalApi.update(rental.id, input) : rentalApi.create(input)),
      async (stored) => {
        markSaved();
        await onSaved(stored);
      }
    );
    if (outcome.status !== "failed") return;
    logger.error("RentalFormModal: save failed", outcome.error);
    const refused = rentalSaveError(outcome.error);
    if (refused.field !== null) {
      setRefusal({ field: refused.field, key: refused.key, draft: draftKey });
      setStep(FIELD_STEP[refused.field]);
      failure.focusFirstProblem();
    } else {
      failure.fail(refused.key);
    }
  };

  const stepProps = {
    draft,
    opened,
    update: (edit: (d: RentalDraft) => RentalDraft): void => setDraft(edit),
    errorOf,
  };
  const next = RENTAL_FORM_STEPS[RENTAL_FORM_STEPS.indexOf(step) + 1];

  return (
    <Modal
      open
      onClose={onClose}
      busy={saving.saving}
      dirty={dirty}
      closeLabel={t("common:buttons.close")}
      title={rental ? t("rental:form.editTitle") : t("rental:form.createTitle")}
      maxWidth={672}
      footer={(requestClose) =>
        // Stored, but the follow-up failed: closing is the only honest action
        // left — another save would send nothing.
        saving.afterSaveFailed ? (
          <>
            <p role="status" className="mr-auto self-center text-sm text-(--text-muted)">
              {t(saving.afterSaveFailedKey)}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md bg-(--accent) px-4 py-2 text-sm font-medium text-(--bg-base) hover:bg-(--accent-dim)"
            >
              {t("common:buttons.close")}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={requestClose}
              disabled={saving.saving}
              className="rounded-md border border-border px-4 py-2 text-sm text-(--text-muted) hover:bg-(--bg-surface) disabled:opacity-50"
            >
              {t("rental:form.cancel")}
            </button>
            <button
              type="button"
              onClick={(): void => void submit()}
              disabled={saving.saving || saving.saved !== null}
              className="rounded-md bg-(--accent) px-4 py-2 text-sm font-medium text-(--bg-base) hover:bg-(--accent-dim) disabled:opacity-50"
            >
              {saving.saving ? t("rental:form.saving") : t("rental:form.save")}
            </button>
          </>
        )
      }
    >
      <div ref={failure.rootRef} className="space-y-4">
        <FormErrorBanner
          message={failure.failureKey ? t(failure.failureKey) : null}
          onRetry={
            failure.failureKey && isTransientSaveError(failure.failureKey)
              ? (): void => void submit()
              : undefined
          }
          retryDisabled={saving.saving}
        />
        <div role="tablist" aria-label={t("rental:form.steps.label")} className="flex gap-1">
          {RENTAL_FORM_STEPS.map((s) => (
            <button
              key={s}
              id={tabId(s)}
              type="button"
              role="tab"
              aria-selected={step === s}
              aria-controls={PANEL_ID}
              onClick={(): void => setStep(s)}
              className={`flex-1 rounded-md border px-3 py-2 text-sm pointer-coarse:min-h-(--ts-size-touch-min) ${
                step === s
                  ? "border-(--accent) font-medium text-(--accent)"
                  : "border-border text-(--text-muted)"
              }`}
            >
              {t(`rental:form.steps.${s}`)}
              {perStep[s] > 0 ? (
                <span className="ml-1 text-(--danger)" data-testid={`rental-step-gaps-${s}`}>
                  <span aria-hidden="true">({perStep[s]})</span>
                  <span className="sr-only">
                    {t("rental:form.steps.gaps", { count: perStep[s] })}
                  </span>
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <div id={PANEL_ID} role="tabpanel" aria-labelledby={tabId(step)}>
          {step === "booking" ? <RentalBookingStep {...stepProps} /> : null}
          {step === "pickup" ? <RentalPickupStep {...stepProps} /> : null}
          {step === "return" ? <RentalReturnStep {...stepProps} /> : null}
        </div>
        {next ? (
          <button
            type="button"
            onClick={(): void => setStep(next)}
            className="text-sm text-(--accent) underline pointer-coarse:min-h-(--ts-size-touch-min)"
          >
            {t("rental:form.steps.next", { step: t(`rental:form.steps.${next}`) })}
          </button>
        ) : null}
        <RequiredLegend />
      </div>
    </Modal>
  );
}
