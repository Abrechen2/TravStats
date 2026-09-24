import { useEffect, useRef, useState, type JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import {
  deleteLoginBackground,
  getLoginBackgrounds,
  loginBackgroundUrl,
  uploadLoginBackgrounds,
} from "../../lib/api/loginBackgrounds";
import { useToastStore } from "../../store/toastStore";

/**
 * Pictures for the sign-in page (Alex, 2026-09-21).
 *
 * Its own file rather than another block inside `InstanceSettings`, because
 * that is a form you fill in and save, and this is not: every action here —
 * upload, remove — takes effect the moment it succeeds. Mixing the two would
 * put a Save button next to controls it has nothing to do with.
 *
 * The warning below the heading is not decoration. The sign-in page is served
 * to anyone who can reach the instance, so a picture here is published, and
 * an admin picking a holiday snap deserves to be told that before they pick
 * it, not after.
 */
export function LoginBackgroundsCard(): JSX.Element {
  const { t } = useTranslation(["admin", "common"]);
  // Selector form: the suites that mock this store hand the hook a selector
  // and call it, so a bare `useToastStore()` throws there.
  const addToast = useToastStore((s) => s.addToast);
  const fileInput = useRef<HTMLInputElement>(null);
  const [backgrounds, setBackgrounds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getLoginBackgrounds()
      .then((names) => {
        if (cancelled) return;
        setBackgrounds(names);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleFiles = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      const result = await uploadLoginBackgrounds([...files]);
      setBackgrounds(result.backgrounds);
      // A partly-good upload says so rather than reporting a clean success:
      // nine of ten pictures landing is a different fact from ten landing.
      if (result.rejected.length > 0) {
        addToast(
          "warning",
          t("admin:loginBackgrounds.partial", {
            accepted: result.accepted.length,
            rejected: result.rejected.join(", "),
          })
        );
      } else {
        addToast(
          "success",
          t("admin:loginBackgrounds.uploaded", { count: result.accepted.length })
        );
      }
    } catch {
      addToast("error", t("admin:loginBackgrounds.uploadFailed"));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const handleRemove = async (name: string): Promise<void> => {
    setBusy(true);
    try {
      setBackgrounds(await deleteLoginBackground(name));
    } catch {
      addToast("error", t("admin:loginBackgrounds.removeFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-(--border) pt-6">
      <h3 className="text-base font-semibold text-(--text-primary)">
        {t("admin:loginBackgrounds.title")}
      </h3>
      <p className="mt-1 text-sm text-(--text-muted)">{t("admin:loginBackgrounds.subtitle")}</p>
      <p className="mt-2 text-sm" style={{ color: "var(--warning)" }}>
        {t("admin:loginBackgrounds.publicWarning")}
      </p>
      <p className="mt-2 text-xs text-(--text-muted)">{t("admin:loginBackgrounds.hint")}</p>

      {loaded && backgrounds.length > 0 && (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {backgrounds.map((name) => (
            <li
              key={name}
              className="group relative overflow-hidden rounded-lg border border-(--border)"
              style={{ aspectRatio: "16 / 10" }}
            >
              <img
                src={loginBackgroundUrl(name)}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleRemove(name)}
                className="absolute right-1.5 top-1.5 rounded-md px-2 py-1 text-xs font-medium"
                // rgba over the picture rather than a surface token: this
                // sits on a photograph, and a themed surface would vanish on
                // a light one.
                style={{ background: "rgba(0,0,0,0.65)", color: "var(--ts-text-bright)" }}
              >
                {t("common:buttons.delete")}
              </button>
            </li>
          ))}
        </ul>
      )}

      {loaded && backgrounds.length === 0 && (
        <p className="mt-4 text-sm text-(--text-muted)">{t("admin:loginBackgrounds.empty")}</p>
      )}
      {loaded && backgrounds.length > 0 && (
        <p className="mt-3 text-xs text-(--text-muted)">
          {t("admin:loginBackgrounds.replacesShipped")}
        </p>
      )}

      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        className="hidden"
        onChange={(e) => void handleFiles(e.target.files)}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => fileInput.current?.click()}
        className="mt-4 rounded-lg border border-(--border) bg-(--bg-elevated) px-3 py-2 text-sm font-medium"
      >
        {busy ? t("common:buttons.uploading") : t("admin:loginBackgrounds.add")}
      </button>
    </div>
  );
}
