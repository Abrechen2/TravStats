import { useEffect, useState } from "react";
import { Button } from "../ui";
import { useTranslation } from "../../hooks/useTranslation";
/** Only explicit, locally decrypted bitmap previews. Never render peer HTML/SVG or remote URLs. */
export default function PhotoPreview({
  name,
  mime,
  load,
}: {
  name: string;
  mime: string;
  load: () => Promise<Blob>;
}) {
  const { t } = useTranslation("encryptedShare");
  const [url, setUrl] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(false);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url]
  );
  if (!["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"].includes(mime))
    return null;
  return (
    <span className="block">
      {error && <span role="alert">{t("error")}</span>}
      {url ? (
        <>
          <img src={url} alt={name} className="max-h-80 max-w-full object-contain rounded-xl" />
          <Button onClick={() => setUrl(null)}>{t("close")}</Button>
        </>
      ) : (
        <Button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(false);
            void load()
              .then((blob) => {
                if (blob.size > 30 * 1024 * 1024) throw Error("preview size");
                setUrl(URL.createObjectURL(new Blob([blob], { type: mime })));
              })
              .catch(() => setError(true))
              .finally(() => setBusy(false));
          }}
        >
          {t("e2e.photoPreview")}
        </Button>
      )}
    </span>
  );
}
