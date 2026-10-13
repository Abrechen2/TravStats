import PhotoPreview from "./PhotoPreview";
import { useMemo, useState } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { Button } from "../ui";
import { downloadBlob } from "./DevicePanel";
import type { OpenData, SourceData } from "../../lib/comparison/transport";
export interface TravelPerson {
  id: string;
  label: string;
  data: SourceData;
  opened?: OpenData;
}
export function fieldPaths(value: unknown, prefix = "", into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const row of value) fieldPaths(row, prefix, into);
  } else if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value))
      if (!/^(id|userId)$|Id$/.test(key)) fieldPaths(v, prefix ? `${prefix}.${key}` : key, into);
  } else if (prefix) into.add(prefix);
  return into;
}
export function fieldValues(value: unknown, path: string[]): unknown[] {
  if (Array.isArray(value)) return value.flatMap((row) => fieldValues(row, path));
  if (!path.length) return value === null || value === undefined ? [] : [value];
  return value && typeof value === "object"
    ? fieldValues((value as Record<string, unknown>)[path[0]], path.slice(1))
    : [];
}
export function aggregate(values: unknown[], operation: string): string | number | null {
  if (!values.length) return null;
  if (operation === "values") return [...new Set(values.map(String))].join(" · ");
  if (operation === "count") return values.length;
  if (!values.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const numbers = values as number[],
    total = numbers.reduce((a, b) => a + b, 0);
  if (operation === "sum") return total;
  if (operation === "mean") return total / numbers.length;
  return numbers.reduce((a, b) => (operation === "min" ? Math.min(a, b) : Math.max(a, b)));
}
export function lines(value: unknown, into: number[][][] = []): number[][][] {
  if (Array.isArray(value)) {
    for (const child of value) lines(child, into);
    return into;
  }
  if (!value || typeof value !== "object") return into;
  const v = value as Record<string, unknown>;
  const geometry =
    v.geometry && typeof v.geometry === "object" ? (v.geometry as Record<string, unknown>) : v;
  const coords =
    geometry.type === "LineString" && Array.isArray(geometry.coordinates)
      ? geometry.coordinates
      : Array.isArray(v.waypoints)
        ? v.waypoints
        : null;
  if (coords) {
    const starts = new Set(
      Array.isArray(v.segmentStarts) ? v.segmentStarts.filter((n) => Number.isInteger(n)) : []
    );
    let segment: number[][] = [];
    const flush = () => {
      if (segment.length > 1) into.push(segment);
      segment = [];
    };
    for (const [i, p] of coords.entries()) {
      if (
        !Array.isArray(p) ||
        typeof p[0] !== "number" ||
        typeof p[1] !== "number" ||
        Math.abs(p[0]) > 180 ||
        Math.abs(p[1]) > 90
      ) {
        flush();
        continue;
      }
      if (
        starts.has(i) ||
        (segment.length && Math.abs(p[0] - segment[segment.length - 1][0]) > 180)
      )
        flush();
      segment.push(p as number[]);
    }
    flush();
  }
  for (const [key, child] of Object.entries(v))
    if (!coords || !["geometry", "coordinates", "waypoints", "segmentStarts"].includes(key))
      lines(child, into);
  return into;
}
export default function TravelComparison({ people }: { people: TravelPerson[] }) {
  const { t, i18n } = useTranslation("comparison");
  const sections = [...new Set(people.flatMap((p) => Object.keys(p.data.sections)))].sort();
  const [section, setSection] = useState("flights"),
    [field, setField] = useState(""),
    [operation, setOperation] = useState("values"),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false);
  const active = sections.includes(section) ? section : (sections[0] ?? "");
  const fields = [...fieldPaths(people.flatMap((p) => p.data.sections[active] ?? []))].sort();
  const selected = fields.includes(field) ? field : (fields[0] ?? "");
  const tracks = useMemo(
    () => people.map((p) => ({ ...p, lines: lines(p.data.sections) })),
    [people]
  );
  const fmt = (v: string | number | null) =>
    v === null
      ? "—"
      : typeof v === "number"
        ? new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 3 }).format(v)
        : v;
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-bold">{t("e2e.allData")}</h2>
      <p>{t("e2e.matrixHelp")}</p>
      <div className="flex flex-wrap gap-4">
        <label>
          {t("e2e.dataset")}
          <select
            value={active}
            onChange={(e) => {
              setSection(e.target.value);
              setField("");
            }}
          >
            {sections.map((s) => (
              <option key={s} value={s}>
                {t(`e2e.section.${s}`, { defaultValue: s })}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("e2e.field")}
          <select value={selected} onChange={(e) => setField(e.target.value)}>
            {fields.map((f) => (
              <option key={f} value={f}>
                {t(`field.${f}`, { defaultValue: f })}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("e2e.operation")}
          <select value={operation} onChange={(e) => setOperation(e.target.value)}>
            {["values", "count", "sum", "mean", "min", "max"].map((o) => (
              <option key={o} value={o}>
                {t(`e2e.${o}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[500px] text-left">
          <thead>
            <tr>
              <th className="p-3">{t("person")}</th>
              <th className="p-3">{t("e2e.records")}</th>
              <th className="p-3">{selected}</th>
              <th className="p-3">{t("year")}</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const records = p.data.sections[active],
                currencies = new Set(fieldValues(records, ["currency"]).map(String));
              const incompatible =
                operation !== "values" &&
                operation !== "count" &&
                /price|amount|cost/i.test(selected) &&
                !/base/i.test(selected) &&
                currencies.size > 1;
              return (
                <tr key={p.id} className="border-t border-[var(--ts-border)]">
                  <th className="p-3">{p.label}</th>
                  <td className="p-3">{records?.length ?? "—"}</td>
                  <td className="p-3 max-w-xl break-words">
                    {incompatible
                      ? t("e2e.mixedCurrencies")
                      : fmt(aggregate(fieldValues(records, selected.split(".")), operation))}
                    {/price|amount|cost/i.test(selected) && currencies.size === 1
                      ? ` ${[...currencies][0]}`
                      : ""}
                  </td>
                  <td className="p-3">{p.data.scope.year ?? t("lifetime")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <details>
        <summary>{t("e2e.map")}</summary>
        <p>{t("e2e.mapHelp")}</p>
        <svg
          viewBox="0 0 720 360"
          className="w-full rounded-xl bg-[var(--ts-surface)]"
          role="img"
          aria-label={t("e2e.map")}
        >
          {[90, 180, 270].map((y) => (
            <path key={y} d={`M0 ${y}H720`} stroke="currentColor" opacity=".1" />
          ))}
          {tracks.flatMap((p, index) =>
            p.lines.map((line, i) => (
              <polyline
                key={`${p.id}:${i}`}
                points={line.map(([lon, lat]) => `${(lon + 180) * 2},${(90 - lat) * 2}`).join(" ")}
                fill="none"
                stroke={["#f0a947", "#4aa6b0", "#dc7faa", "#5ec2b2"][index % 4]}
                strokeWidth="1.5"
              >
                <title>{p.label}</title>
              </polyline>
            ))
          )}
        </svg>
        <ul>
          {tracks.map((p, i) => (
            <li key={p.id} style={{ color: ["#f0a947", "#4aa6b0", "#dc7faa", "#5ec2b2"][i % 4] }}>
              {p.label}: {p.lines.length}
            </li>
          ))}
        </ul>
      </details>
      {error && <p role="alert">{t("error")}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {people.map((p) => (
          <article
            key={p.id}
            className="min-w-0 rounded-xl border border-[var(--ts-border)] p-4 space-y-3"
          >
            <h3 className="font-bold">{p.label}</h3>
            <p>
              {t("updated")}: {p.data.asOf}
            </p>
            {p.data.omitted.length > 0 && (
              <p>
                {t("e2e.filtered")}: {p.data.omitted.join(", ")}
              </p>
            )}
            <details>
              <summary>{t("e2e.inspect")}</summary>
              <pre className="max-h-96 overflow-auto text-xs whitespace-pre-wrap break-all">
                {JSON.stringify(p.data.sections[active] ?? [], null, 2)}
              </pre>
            </details>
            <Button
              onClick={() =>
                downloadBlob(
                  new Blob([JSON.stringify(p.data, null, 2)], { type: "application/json" }),
                  `${p.label}-comparison.json`
                )
              }
            >
              {t("e2e.dataDownload")}
            </Button>
            <details>
              <summary>
                {t("e2e.files", { count: p.opened?.files.length ?? p.data.assets.length })}
              </summary>
              <ul className="space-y-2">
                {p.opened?.files.map((f) => (
                  <li key={f.key} className="break-all">
                    {f.name} · {f.size} B{" "}
                    <Button
                      disabled={busy}
                      onClick={() => {
                        setBusy(true);
                        setError(false);
                        void p
                          .opened!.download(f.key)
                          .then((b) => downloadBlob(b, f.name))
                          .catch(() => setError(true))
                          .finally(() => setBusy(false));
                      }}
                    >
                      {t("download")}
                    </Button>
                    <PhotoPreview
                      name={f.name}
                      mime={f.mime}
                      load={() => p.opened!.download(f.key)}
                    />
                  </li>
                ))}
              </ul>
            </details>
          </article>
        ))}
      </div>
    </section>
  );
}
