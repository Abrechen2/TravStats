import { useCallback, useEffect, useState, type JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { placeCapturesApi, type PlaceCapture } from "../../lib/api/placeCaptures";
import { useDisplayFormat } from "../../lib/displayFormat";
import { logger } from "../../lib/logger";
import { saveErrorMessage } from "../../lib/saveErrorMessage";
import { PLACE_CATEGORIES } from "../../shared/placeCategories";
import { useToastStore } from "../../store/toastStore";
import PassPlacePicker from "../Roadtrips/PassPlacePicker";
import Button from "../ui/Button";
import { Card } from "../ui/Card";
import { Field, Input, Select } from "../ui/Field";

const NS = "dataQuality:placeCaptures";
/** Codes that mean the row is no longer open: the list is stale, so it is reloaded. */
const STALE_CODES = ["CAPTURE_ALREADY_RESOLVED", "CAPTURE_NOT_FOUND"];
const CODE_KEYS = {
  CAPTURE_ALREADY_RESOLVED: `${NS}.errors.alreadyResolved`,
  CAPTURE_NOT_FOUND: `${NS}.errors.notFound`,
};

function codeOf(error: unknown): string | null {
  const data = (error as { response?: { data?: { code?: string } } } | null)?.response?.data;
  return data?.code ?? null;
}

/**
 * "Ort jetzt" positions the phone captured without a name (companion#90), in
 * the inbox until the reader names or dismisses them. Nothing at all when none
 * are open; a failed load says so and offers a retry instead of reading as an
 * empty inbox, and a failed answer keeps the row and shows why.
 */
export default function PlaceCapturesSection(): JSX.Element | null {
  const { t } = useTranslation(["dataQuality", "common", "places"]);
  const format = useDisplayFormat();
  const addToast = useToastStore((state) => state.addToast);
  const [captures, setCaptures] = useState<PlaceCapture[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("other");
  const [useExisting, setUseExisting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setCaptures(await placeCapturesApi.listOpen());
      setLoadFailed(false);
    } catch (err) {
      logger.warn("Failed to load place captures:", err);
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const fail = async (id: string, err: unknown): Promise<void> => {
    setError({ id, message: saveErrorMessage(err, t, `${NS}.errors.generic`, CODE_KEYS) });
    const code = codeOf(err);
    if (code && STALE_CODES.includes(code)) await load();
  };

  const answer = async (
    capture: PlaceCapture,
    run: () => Promise<unknown>,
    done: string
  ): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await run();
      setCaptures((rows) => rows.filter((row) => row.id !== capture.id));
      setNaming(null);
      addToast("success", t(done));
    } catch (err) {
      logger.warn("Answering a place capture failed:", err);
      await fail(capture.id, err);
    } finally {
      setBusy(false);
    }
  };

  const startNaming = (id: string): void => {
    setNaming(id);
    setName("");
    setCategory("other");
    setUseExisting(false);
    setError(null);
  };

  if (loadFailed) {
    return (
      <Card style={{ marginBottom: "var(--ts-space-xl)" }}>
        <p role="alert" style={{ color: "var(--ts-bad)" }}>
          {t(`${NS}.loadError`)}
        </p>
        <Button onClick={() => void load()}>{t("common:buttons.retry")}</Button>
      </Card>
    );
  }
  if (captures.length === 0) return null;

  return (
    <Card style={{ marginBottom: "var(--ts-space-xl)" }} aria-labelledby="place-captures-title">
      <h3
        id="place-captures-title"
        style={{ fontSize: 16, fontWeight: 700, color: "var(--ts-text-bright)" }}
      >
        {t(`${NS}.title`)}
      </h3>
      <p className="t-caption" style={{ marginTop: "var(--ts-space-xs)" }}>
        {t(`${NS}.description`)}
      </p>
      <ul
        className="flex flex-col"
        style={{ gap: "var(--ts-space-md)", marginTop: "var(--ts-space-lg)" }}
      >
        {captures.map((capture) => (
          <li
            key={capture.id}
            style={{ borderTop: "1px solid var(--ts-border)", paddingTop: "var(--ts-space-md)" }}
          >
            <div className="flex flex-wrap items-start justify-between" style={{ gap: 12 }}>
              <span className="flex flex-col" style={{ color: "var(--ts-text)" }}>
                <strong>{t(`${NS}.unnamed`)}</strong>
                <span className="t-caption">
                  <time dateTime={capture.capturedAt}>{format.dateTime(capture.capturedAt)}</time>
                  {" · "}
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${capture.lat}&mlon=${capture.lon}#map=17/${capture.lat}/${capture.lon}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "var(--ts-accent)", textDecoration: "underline" }}
                  >
                    {capture.lat.toFixed(5)}, {capture.lon.toFixed(5)}
                  </a>
                  {capture.accuracyM !== null &&
                    ` · ${t(`${NS}.accuracy`, { meters: Math.round(capture.accuracyM) })}`}
                </span>
                {capture.note && <span>{capture.note}</span>}
              </span>
              {naming !== capture.id && (
                <span className="flex flex-wrap" style={{ gap: 8 }}>
                  <Button variant="primary" disabled={busy} onClick={() => startNaming(capture.id)}>
                    {t(`${NS}.name`)}
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void answer(
                        capture,
                        () => placeCapturesApi.dismiss(capture.id),
                        `${NS}.dismissed`
                      )
                    }
                  >
                    {t(`${NS}.dismiss`)}
                  </Button>
                </span>
              )}
            </div>
            {naming === capture.id && (
              <form
                className="flex flex-col"
                style={{ gap: "var(--ts-space-md)", marginTop: "var(--ts-space-md)" }}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!name.trim()) return;
                  void answer(
                    capture,
                    () =>
                      placeCapturesApi.resolve(capture.id, {
                        name: name.trim(),
                        category,
                      }),
                    `${NS}.resolved`
                  );
                }}
              >
                {useExisting ? (
                  <PassPlacePicker
                    near={capture}
                    onPick={(place) =>
                      void answer(
                        capture,
                        () => placeCapturesApi.resolve(capture.id, { placeId: place.id }),
                        `${NS}.resolved`
                      )
                    }
                  />
                ) : (
                  <>
                    <Field label={t(`${NS}.nameLabel`)} htmlFor={`capture-name-${capture.id}`}>
                      <Input
                        id={`capture-name-${capture.id}`}
                        value={name}
                        maxLength={200}
                        required
                        onChange={(e) => setName(e.target.value)}
                      />
                    </Field>
                    <Field
                      label={t(`${NS}.categoryLabel`)}
                      htmlFor={`capture-category-${capture.id}`}
                    >
                      <Select
                        id={`capture-category-${capture.id}`}
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                      >
                        {PLACE_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {t(`places:categories.${c}`)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </>
                )}
                <div className="flex flex-wrap" style={{ gap: 8 }}>
                  {!useExisting && (
                    <Button variant="primary" type="submit" disabled={busy || !name.trim()}>
                      {t(`${NS}.save`)}
                    </Button>
                  )}
                  <Button type="button" disabled={busy} onClick={() => setUseExisting((v) => !v)}>
                    {useExisting ? t(`${NS}.newPlace`) : t(`${NS}.existingPlace`)}
                  </Button>
                  <Button type="button" disabled={busy} onClick={() => setNaming(null)}>
                    {t("common:buttons.cancel")}
                  </Button>
                </div>
              </form>
            )}
            {error?.id === capture.id && (
              <p role="alert" style={{ color: "var(--ts-bad)", marginTop: "var(--ts-space-sm)" }}>
                {error.message}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
