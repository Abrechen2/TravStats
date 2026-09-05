/**
 * The primitive library. A page imports from here and never styles a card,
 * button, pill or dialog frame itself.
 *
 * Every primitive reads tokens only. If a component below needs a value that
 * is not in `design/tokens.json`, the value goes into the Companion token file
 * first and reaches this repo by copy — never into a component.
 */
export { default as AppShell, type ShellWidth } from "./AppShell";
export { default as PageHeader } from "./PageHeader";
export { default as Button, type ButtonVariant } from "./Button";
export { default as IconButton } from "./IconButton";
export { Card, Tile, HeroCard, SparseCard } from "./Card";
export { default as Pill, StatusPill, DomainPill } from "./Pill";
export { default as Chip } from "./Chip";
export { default as StatTile, SectionLabel } from "./StatTile";
export { default as Dialog } from "./Dialog";
export { Field, Input, TextArea, Select, Switch } from "./Field";
export { default as EmptyState, type EmptyStateKind } from "./EmptyState";
export { Table, TableRow, ListRow, type TableColumn } from "./Table";
export { alpha, token, MONO_KEYS, STATUS_TOKEN, DOMAIN_TOKEN, DASHED_STATUSES } from "./tokens";
