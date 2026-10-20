import { useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { apiErrorMachineCode } from "../../lib/apiError";
import { logger } from "../../lib/logger";
import {
  templateRepoApi,
  type TemplateRepoSaved,
  type TemplateRepoState,
  type TemplateRepoTestResult,
} from "../../lib/api/templateRepo";
import Button from "../ui/Button";
import { Field, Input } from "../ui/Field";
import { SectionCard, SectionTitle } from "../Settings/SettingsShared";

const NS = "admin:templateRepo";

/** A save the server refused, as the copy key that says why. */
function saveErrorKey(error: unknown): string {
  const code = apiErrorMachineCode(error);
  if (code === "TEMPLATE_REPO_URL_HTTPS_REQUIRED") return `${NS}.result.httpsRequired`;
  if (code === "TEMPLATE_REPO_URL_INVALID") return `${NS}.result.invalidUrl`;
  return `${NS}.saveFailed`;
}

/**
 * Where the parser templates come from (forgejo#309): the template repository
 * URL as an instance setting. "Test" reads the repository's index and says
 * how it went; "Save" stores the URL and re-syncs at once — and when the new
 * index cannot be read, says that the last good set is still in use.
 */
export default function TemplateRepoSettings(): JSX.Element {
  const { t } = useTranslation(["admin"]);
  const [state, setState] = useState<TemplateRepoState | null>(null);
  const [value, setValue] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<{
    result: TemplateRepoTestResult;
    templates: number | null;
  } | null>(null);
  const [testFailed, setTestFailed] = useState(false);
  const [saved, setSaved] = useState<TemplateRepoSaved | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    templateRepoApi.get().then(
      (loaded) => {
        if (!alive) return;
        setState(loaded);
        setValue(loaded.url ?? "");
      },
      (error: unknown) => {
        logger.error("Loading the template repository setting failed:", error);
        if (alive) setLoadFailed(true);
      }
    );
    return () => {
      alive = false;
    };
  }, []);

  const runTest = async (): Promise<void> => {
    setBusy(true);
    setTest(null);
    setTestFailed(false);
    try {
      setTest(await templateRepoApi.test(value.trim() || null));
    } catch (error) {
      logger.error("Testing the template repository failed:", error);
      setTestFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const save = async (url: string | null): Promise<void> => {
    setBusy(true);
    setSaved(null);
    setSaveError(null);
    try {
      const result = await templateRepoApi.save(url);
      setSaved(result);
      setState(result);
      setValue(result.url ?? "");
    } catch (error) {
      logger.error("Saving the template repository failed:", error);
      setSaveError(saveErrorKey(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard>
      <SectionTitle title={t(`${NS}.title`)} description={t(`${NS}.description`)} />
      {state && (
        <div className="space-y-3">
          <Field
            label={t(`${NS}.url`)}
            htmlFor="template-repo-url"
            hint={t(`${NS}.urlHint`, { defaultUrl: state.defaultUrl })}
          >
            <Input
              id="template-repo-url"
              type="url"
              value={value}
              placeholder={state.defaultUrl}
              disabled={busy}
              onChange={(e) => {
                setValue(e.target.value);
                setTest(null);
              }}
            />
          </Field>
          <p className="t-caption" data-testid="template-repo-effective">
            {t(`${NS}.readsFrom.${state.origin}`, { url: state.effectiveUrl })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => void runTest()}>
              {t(`${NS}.test`)}
            </Button>
            <Button
              variant="primary"
              disabled={busy || (value.trim() || null) === state.url}
              onClick={() => void save(value.trim() || null)}
            >
              {t(busy ? `${NS}.working` : `${NS}.save`)}
            </Button>
            {state.url !== null && (
              <Button variant="secondary" disabled={busy} onClick={() => void save(null)}>
                {t(`${NS}.reset`)}
              </Button>
            )}
          </div>
          {test && (
            <p role="status" data-testid="template-repo-test">
              {t(`${NS}.result.${test.result}`, { count: test.templates ?? 0 })}
            </p>
          )}
          {saved && (
            <p role="status" data-testid="template-repo-saved">
              {saved.sync.index === "available"
                ? t(`${NS}.synced`, { count: saved.sync.active })
                : t(`${NS}.syncFailed`, { count: saved.sync.active })}
            </p>
          )}
        </div>
      )}
      {loadFailed && <p role="alert">{t(`${NS}.loadFailed`)}</p>}
      {testFailed && <p role="alert">{t(`${NS}.testFailed`)}</p>}
      {saveError && <p role="alert">{t(saveError)}</p>}
    </SectionCard>
  );
}
