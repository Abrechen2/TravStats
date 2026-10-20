import type { V2TemplateStatus } from "../lib/api";
import { useDisplayFormat } from "../lib/displayFormat";
import { useTranslation } from "../hooks/useTranslation";

/**
 * What went wrong at the last template sync, said on the page (forgejo#309).
 *
 * The repository sync keeps the last good set when the index is unreachable
 * or a template fails, which is right — and until now it was also SILENT: the
 * failure reached the log and nowhere else, so a stale set looked current.
 * This names the failure and its date. Nothing is drawn when the last sync
 * went through cleanly, or before the first one.
 */
export default function TemplateSyncNotice({ v2 }: { v2: V2TemplateStatus }): JSX.Element | null {
  const { t } = useTranslation(["parser"]);
  const format = useDisplayFormat();
  const date = v2.ranAt ? format.dateTime(v2.ranAt) : null;
  const rejected = v2.templates.filter((tpl) => tpl.state === "rejected");
  // An admin sees the detail, and with it a newer version that was refused
  // while the older one keeps serving.
  const refused = v2.templates.filter((tpl) => tpl.state === "active" && tpl.detail);
  const unreachable = v2.index === "unavailable";
  if (!unreachable && rejected.length === 0 && refused.length === 0) return null;

  const active = v2.templates.filter((tpl) => tpl.state === "active").length;
  return (
    <div role="alert" className="text-sm flex flex-col gap-1" style={{ color: "var(--warning)" }}>
      {unreachable && (
        <p>
          {date
            ? t("parser:communityTemplates.sync.indexUnreachable", { date, count: active })
            : t("parser:communityTemplates.sync.indexUnreachableNoDate", { count: active })}
        </p>
      )}
      {rejected.length > 0 && (
        <>
          <p>
            {date
              ? t("parser:communityTemplates.sync.rejectedTitle", { date, count: rejected.length })
              : t("parser:communityTemplates.sync.rejectedTitleNoDate", {
                  count: rejected.length,
                })}
          </p>
          <ul className="list-disc pl-5">
            {rejected.map((tpl) => (
              <li key={tpl.id}>
                <span className="font-mono">{tpl.id}</span>
                {tpl.version ? ` v${tpl.version}` : ""}
                {tpl.reason
                  ? ` — ${t(`parser:communityTemplates.sync.reasons.${tpl.reason}`)}`
                  : ""}
              </li>
            ))}
          </ul>
        </>
      )}
      {refused.map((tpl) => (
        <p key={tpl.id}>
          {t("parser:communityTemplates.sync.refusedUpdate", {
            id: tpl.id,
            version: tpl.version ?? "?",
          })}
        </p>
      ))}
    </div>
  );
}
