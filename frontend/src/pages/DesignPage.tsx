import { useState } from "react";
import {
  AppShell,
  Button,
  Card,
  Chip,
  Dialog,
  DomainPill,
  EmptyState,
  Field,
  HeroCard,
  IconButton,
  Input,
  ListRow,
  PageHeader,
  Pill,
  SectionLabel,
  Select,
  SparseCard,
  StatTile,
  StatusPill,
  Switch,
  Table,
  TableRow,
  Tile,
  alpha,
  token,
  type TableColumn,
} from "../components/ui";

/**
 * The acceptance surface. Every primitive, in every state, with the token it
 * reads written next to it.
 *
 * Deliberately untranslated: this page is read by whoever is building the
 * system, not by a user, and mirroring forty labels into the DE/EN files would
 * put strings into the parity test that no product surface ever shows.
 *
 * Dev only — `App.tsx` mounts the route behind `import.meta.env.DEV`, so it is
 * absent from a production bundle rather than merely unlinked.
 */

const SWATCHES: { title: string; items: [string, string][] }[] = [
  {
    title: "Flächen",
    items: [
      ["canvas", "canvas"],
      ["bg", "bg"],
      ["surface2", "surface2"],
      ["surface", "surface"],
      ["tile", "tile"],
      ["paper", "paper"],
    ],
  },
  {
    title: "Text",
    items: [
      ["textBright", "text-bright"],
      ["text", "text"],
      ["muted", "muted"],
      ["faint (dekorativ)", "faint"],
      ["border", "border"],
    ],
  },
  {
    title: "Akzent · nie Status",
    items: [
      ["accent", "accent"],
      ["accentHover", "accent-hover"],
      ["accentPressed", "accent-pressed"],
      ["proBg", "pro-bg"],
    ],
  },
  {
    title: "Semantik",
    items: [
      ["good / live", "good"],
      ["info · offline", "info"],
      ["warn", "warn"],
      ["bad", "bad"],
    ],
  },
  {
    title: "Domäne",
    items: [
      ["flight", "domain-flight"],
      ["cruise", "domain-cruise"],
      ["hotel", "domain-hotel"],
      ["poi", "domain-poi"],
      ["tour", "domain-tour"],
    ],
  },
  {
    title: "Tier",
    items: [
      ["bronze", "tier-bronze"],
      ["silver", "tier-silver"],
      ["gold", "tier-gold"],
      ["platinum", "tier-platinum"],
      ["diamond", "tier-diamond"],
    ],
  },
];

const TYPE_ROLES: [string, string][] = [
  ["t-hero", "42 / 800 · tabular"],
  ["t-screen-title", "26 / 800 — die eine h1"],
  ["t-greeting", "30 serif kursiv"],
  ["t-card-title", "16 / 700"],
  ["t-stat-number", "20 / 800 · tabular"],
  ["t-body", "14 / 400"],
  ["t-caption", "12 / 400 muted"],
  ["t-label-mono", "11 / 500 mono versal"],
  ["t-meta-mono", "10 / 400 mono"],
  ["t-code", "mono 500 — IATA, Flugnr., Messwerte"],
];

const STATUSES: [string, string][] = [
  ["scheduled", "Geplant"],
  ["pending", "Vorläufig"],
  ["flown", "Geflogen"],
  ["cancelled", "Storniert"],
  ["historical", "Historisch"],
  ["review", "Prüfen"],
  ["duplicated", "Dublette"],
];

const COLUMNS: readonly TableColumn[] = [
  { key: "date", label: "Datum", width: "88px", mono: true, onNarrow: "subtitle" },
  { key: "route", label: "Strecke", width: "minmax(0,1fr)", onNarrow: "title" },
  { key: "code", label: "Flug", width: "120px", mono: true, onNarrow: "hide" },
  { key: "dist", label: "Distanz", width: "96px", mono: true, align: "end", onNarrow: "hide" },
  { key: "status", label: "Status", width: "120px", align: "end", onNarrow: "trailing" },
];

const ROWS = [
  {
    date: "12.09.26",
    route: "Hamburg → Warschau",
    code: "LO380",
    dist: "755 km",
    status: "scheduled",
    label: "Geplant",
  },
  {
    date: "03.09.26",
    route: "Frankfurt → New York",
    code: "LH400",
    dist: "6 206 km",
    status: "pending",
    label: "Vorläufig",
  },
  {
    date: "14.07.26",
    route: "München → Lissabon",
    code: "LH1782",
    dist: "1 980 km",
    status: "flown",
    label: "Geflogen",
  },
  {
    date: "02.05.26",
    route: "Berlin → Wien",
    code: "OS230",
    dist: "520 km",
    status: "cancelled",
    label: "Storniert",
  },
];

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
      <div className="flex flex-col" style={{ gap: 2 }}>
        <SectionLabel>{title}</SectionLabel>
        {hint ? <span className="t-caption">{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

export default function DesignPage(): JSX.Element {
  const [chip, setChip] = useState("Alle");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [switchOn, setSwitchOn] = useState(true);
  const [switchOff, setSwitchOff] = useState(false);

  return (
    <AppShell width="list">
      <PageHeader
        title="Design"
        meta="Jedes Primitiv in jedem Zustand. Alles liest design/tokens.json — ein Hex hier wäre ein Defekt."
      />

      <div className="flex flex-col" style={{ gap: "var(--ts-space-xxl)" }}>
        <Section
          title="Farbe"
          hint="Werte aus tokens.json, nichts abgeleitet außer den vier Web-Schattierungen."
        >
          <div
            className="grid"
            style={{
              gap: "var(--ts-space-lg)",
              gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
            }}
          >
            {SWATCHES.map((group) => (
              <Card key={group.title} style={{ padding: "var(--ts-space-lg)" }}>
                <SectionLabel>{group.title}</SectionLabel>
                <div className="mt-2 flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
                  {group.items.map(([name, key]) => (
                    <div
                      key={key}
                      className="flex items-center"
                      style={{ gap: "var(--ts-space-md)" }}
                    >
                      <span
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: "var(--ts-radius-tile)",
                          background: token(key),
                          border: "1px solid var(--ts-border)",
                          flexShrink: 0,
                        }}
                      />
                      <span className="t-caption" style={{ flex: 1 }}>
                        {name}
                      </span>
                      <span className="t-meta-mono">--ts-{key}</span>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </Section>

        <Section
          title="Typografie"
          hint="Eine Utility je Rolle aus typography.scale. Eine Seitenüberschrift ist .t-screen-title."
        >
          <Card>
            <div className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
              {TYPE_ROLES.map(([cls, note]) => (
                <div
                  key={cls}
                  className="flex flex-wrap items-baseline"
                  style={{ gap: "var(--ts-space-lg)" }}
                >
                  <span className={cls} style={{ flex: "1 1 260px" }}>
                    Reisen, gemessen 1234
                  </span>
                  <span className="t-meta-mono">.{cls}</span>
                  <span className="t-caption">{note}</span>
                </div>
              ))}
            </div>
          </Card>
        </Section>

        <Section title="Knöpfe" hint="Zwei Varianten. danger nur im Bestätigungsdialog. Nie mono.">
          <Card>
            <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-md)" }}>
              <Button variant="primary">Speichern</Button>
              <Button variant="secondary">Abbrechen</Button>
              <Button variant="danger">Löschen</Button>
              <Button variant="primary" disabled>
                Deaktiviert
              </Button>
              <Button variant="secondary" disabled>
                Deaktiviert
              </Button>
              <IconButton label="Mehr">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="1" />
                  <circle cx="19" cy="12" r="1" />
                  <circle cx="5" cy="12" r="1" />
                </svg>
              </IconButton>
              <Button variant="secondary" onClick={() => setDialogOpen(true)}>
                Dialog öffnen
              </Button>
            </div>
          </Card>
        </Section>

        <Section
          title="Pillen"
          hint="12 % Fläche, 45 % Rand, 11/700 versal, nie mono. Gestrichelt heißt vorläufig."
        >
          <Card>
            <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-md)" }}>
              {STATUSES.map(([status, label]) => (
                <StatusPill key={status} status={status}>
                  {label}
                </StatusPill>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center" style={{ gap: "var(--ts-space-md)" }}>
              <DomainPill domain="flight">Flug</DomainPill>
              <DomainPill domain="cruise">Kreuzfahrt</DomainPill>
              <DomainPill domain="lodging">Unterkunft</DomainPill>
              <DomainPill domain="poi">Ort</DomainPill>
              <DomainPill domain="tour">Tour</DomainPill>
              <Pill color={token("accent")}>Beta</Pill>
            </div>
          </Card>
        </Section>

        <Section
          title="Chips"
          hint="Höchstens eine Chip-Zeile vor einer Liste. Aktiv ist eine Akzentfüllung."
        >
          <Card>
            <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
              {["Alle", "Geplant", "Geflogen", "2026", "Langstrecke"].map((name) => (
                <Chip
                  key={name}
                  active={chip === name}
                  onClick={() => setChip(name)}
                  meta={name === "Alle" ? "160" : undefined}
                >
                  {name}
                </Chip>
              ))}
            </div>
          </Card>
        </Section>

        <Section
          title="Flächen"
          hint="Karte, Kachel, Hero, karge Karte. Ein Schatten kommt nur auf Dialog und Papier."
        >
          <div
            className="grid"
            style={{
              gap: "var(--ts-space-lg)",
              gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
            }}
          >
            <Card>
              <div className="t-card-title">Card</div>
              <div className="t-caption">surface · Radius 16 · Haarlinie, kein Schatten</div>
            </Card>
            <Tile>
              <div className="t-card-title">Tile</div>
              <div className="t-caption">tile · Radius 14 · liegt IN einer Karte</div>
            </Tile>
            <HeroCard>
              <div className="t-card-title">HeroCard</div>
              <div className="t-caption">heroGradient · Radius 18</div>
            </HeroCard>
            <SparseCard>
              SparseCard — spricht die Kargheit aus. Kein Leerzustand: die Sache existiert, wir
              wissen nur wenig.
            </SparseCard>
          </div>
        </Section>

        <Section
          title="Kennzahlen"
          hint="Tabellarische Ziffern. Ein Chevron nur, wenn die Kachel irgendwohin führt."
        >
          <div
            className="grid"
            style={{
              gap: "var(--ts-space-md)",
              gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))",
            }}
          >
            <StatTile value="160" label="Flüge" />
            <StatTile value="284 512" suffix="km" label="Strecke" />
            <StatTile value="52" label="Länder" onClick={() => undefined} />
            <StatTile value="—" label="Noch nicht berechnet" />
          </div>
        </Section>

        <Section
          title="Formularfelder"
          hint="44 hoch, Fehler als Zeile unter dem Feld — nie als Toast."
        >
          <Card>
            <div
              className="grid"
              style={{
                gap: "var(--ts-space-lg)",
                gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))",
              }}
            >
              <Field label="Flugnummer" htmlFor="d-code" hint="IATA oder ICAO.">
                <Input id="d-code" placeholder="LH400" defaultValue="" />
              </Field>
              <Field label="Abflughafen" htmlFor="d-bad" error="Kein Flughafen mit diesem Code.">
                <Input id="d-bad" invalid defaultValue="XXX" />
              </Field>
              <Field label="Kabinenklasse" htmlFor="d-sel">
                <Select id="d-sel" defaultValue="economy">
                  <option value="economy">Economy</option>
                  <option value="business">Business</option>
                </Select>
              </Field>
              <div className="flex flex-col justify-center" style={{ gap: "var(--ts-space-lg)" }}>
                <Switch
                  id="d-sw1"
                  checked={switchOn}
                  onChange={setSwitchOn}
                  label="Historische Einträge zeigen"
                  sub="Flüge vor dem Kontostart, gedämpft als Pille"
                />
                <Switch
                  id="d-sw2"
                  checked={switchOff}
                  onChange={setSwitchOff}
                  label="Weniger Bewegung"
                  sub="Folgt sonst der Systemeinstellung"
                />
              </div>
            </div>
          </Card>
        </Section>

        <Section
          title="Tabelle"
          hint="Unter 640 px wird dieselbe Zeile zur ListRow — ein DOM, zwei Layouts."
        >
          <Table columns={COLUMNS} label="Beispieltabelle">
            {ROWS.map((row) => (
              <TableRow
                key={row.code}
                columns={COLUMNS}
                dashed={row.status === "pending"}
                onClick={() => undefined}
                cells={[
                  row.date,
                  row.route,
                  row.code,
                  row.dist,
                  <StatusPill key="s" status={row.status}>
                    {row.label}
                  </StatusPill>,
                ]}
              />
            ))}
          </Table>
        </Section>

        <Section
          title="ListRow"
          hint="Führende Marke · Titel und Unterzeile · eine Pille oder ein Chevron."
        >
          <Card flush>
            <ListRow
              mark={
                <span
                  style={{
                    width: "var(--ts-size-airline-monogram)",
                    height: "var(--ts-size-airline-monogram)",
                    borderRadius: "var(--ts-radius-tile)",
                    background: "var(--ts-tile)",
                    border: "1px solid var(--ts-border)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: "var(--ts-font-mono)",
                    fontSize: 12,
                    color: "var(--ts-muted)",
                  }}
                >
                  LH
                </span>
              }
              title="Frankfurt → New York"
              subtitle="LH400 · 6 206 km"
              trailing={<StatusPill status="flown">Geflogen</StatusPill>}
            />
            <ListRow
              title="Hamburg → Warschau"
              subtitle="LO380 · 755 km"
              dashed
              trailing={<StatusPill status="pending">Vorläufig</StatusPill>}
            />
          </Card>
        </Section>

        <Section
          title="Leerzustände"
          hint="Vier Arten, keine davon rot. Offline ist ein Wartezustand."
        >
          <div
            className="grid"
            style={{
              gap: "var(--ts-space-lg)",
              gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
            }}
          >
            <Card flush>
              <EmptyState
                kind="nothing"
                title="Noch keine Flüge"
                description="Trag den ersten von Hand ein oder lass eine Buchungs-E-Mail lesen."
                action={<Button variant="primary">Flug hinzufügen</Button>}
              />
            </Card>
            <Card flush>
              <EmptyState
                kind="degraded"
                title="Ich erreiche den Anbieter gerade nicht"
                description="Die zuletzt geholten Daten stehen weiter in der Liste."
                log="aerodatabox · 503 · 2026-09-06T04:12Z"
                action={<Button variant="secondary">Noch einmal versuchen</Button>}
              />
            </Card>
            <Card flush>
              <EmptyState
                kind="pending"
                title="Die Auswertung läuft heute Nacht"
                description="Neue Belege werden um 02:00 UTC geprüft."
                action={<Button variant="secondary">Jetzt senden</Button>}
              />
            </Card>
            <Card flush>
              <EmptyState
                kind="unpaired"
                banner="Noch kein Telefon gekoppelt."
                title="Hier stehen deine Geräte"
                description="Nach der Kopplung siehst du, wann jedes zuletzt abgeglichen hat."
                action={<Button variant="primary">Gerät koppeln</Button>}
              />
            </Card>
          </div>
        </Section>

        <Section
          title="Mono-Disziplin"
          hint="Codes, Kennungen, Messwerte, Zeitstempel. Nie Pillen, Knöpfe, Namen, Fließtext."
        >
          <Card>
            <p className="t-body">
              <span className="t-code">LO380</span> · LOT Polish Airlines — in einer gemischten
              Zeile ist nur der Code mono, der Name steht in derselben Größe und Farbe in der
              UI-Schrift.
            </p>
            <p className="t-body" style={{ marginTop: "var(--ts-space-md)" }}>
              Falsch wäre: eine Pille in mono, ein Knopf in mono, oder{" "}
              <span className="t-code">755 km</span> mitten im Satz — die Zahl mit Einheit im
              Fließtext gehört in die UI-Schrift.
            </p>
            <div
              className="mt-4"
              style={{
                padding: "var(--ts-space-md) var(--ts-space-lg)",
                borderRadius: "var(--ts-radius-button)",
                background: alpha("var(--ts-warn)", 12),
                border: `1px solid ${alpha("var(--ts-warn)", 45)}`,
              }}
            >
              <span className="t-caption" style={{ color: "var(--ts-warn)" }}>
                faint ist dekorativ — Trenner, Platzhalter, Icon-Ruhe. Nie für lesbaren Text:
                gemessen 3,8 : 1.
              </span>
            </div>
          </Card>
        </Section>
      </div>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Reise löschen?"
        dismissLabel="Behalten"
        action={
          <Button variant="danger" onClick={() => setDialogOpen(false)}>
            Löschen
          </Button>
        }
      >
        <p>
          &bdquo;Ostsee 2025&ldquo; mit <span className="t-code">3</span> Kreuzfahrten und{" "}
          <span className="t-code">4</span> Unterkünften. Die Einträge bleiben im Logbuch; nur der
          Rahmen geht.
        </p>
        <p className="t-caption" style={{ marginTop: "var(--ts-space-md)" }}>
          Objekt · Reichweite · Folge — eine Vorlage.
        </p>
      </Dialog>
    </AppShell>
  );
}
