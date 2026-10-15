import { QRCodeSVG } from "qrcode.react";
import { useTranslation } from "../../hooks/useTranslation";
import { fingerprintCode, readFingerprintCode } from "../../lib/comparison/verificationCode";
export function FingerprintQR({ fingerprint }: { fingerprint: string }) {
  const { t } = useTranslation("comparison");
  return (
    <details>
      <summary>{t("e2e.qrShow")}</summary>
      <p>{t("e2e.qrHelp")}</p>
      <div className="inline-block bg-white p-4 my-3">
        <QRCodeSVG
          value={fingerprintCode(fingerprint)}
          size={192}
          level="M"
          title={t("e2e.qrShow")}
        />
      </div>
    </details>
  );
}
export function FingerprintImage({
  onRead,
  onError,
}: {
  onRead: (fingerprint: string) => void;
  onError: () => void;
}) {
  const { t } = useTranslation("comparison");
  return (
    <label className="block my-3">
      {t("e2e.qrRead")}
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          if (
            file.size > 5 * 1024 * 1024 ||
            !["image/png", "image/jpeg", "image/webp"].includes(file.type)
          ) {
            onError();
            return;
          }
          const url = URL.createObjectURL(file);
          void import("@zxing/browser")
            .then(async ({ BrowserQRCodeReader }) => {
              const result = await new BrowserQRCodeReader().decodeFromImageUrl(url);
              onRead(readFingerprintCode(result.getText()));
            })
            .catch(onError)
            .finally(() => URL.revokeObjectURL(url));
        }}
      />
    </label>
  );
}
