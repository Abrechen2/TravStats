import { LOG_LEVELS, LogLevelName, LogLevelSource } from "../../shared/logContract";

/**
 * Which log level is in force, and why — the one place that decides it.
 *
 * Precedence (owner-facing, shown in the admin UI):
 *  1. `LOG_LEVEL` in the environment pins the level. An operator who set it
 *     in their compose file meant it, and a setting in the database must not
 *     silently override a deployment decision. The UI says so and disables
 *     the picker.
 *  2. Otherwise the admin setting.
 *  3. Before the database has been read (boot, a script), the historical
 *     default: `info` in production, `debug` elsewhere.
 *
 * Until 2026-09-26 only (1)/(3) existed in practice: the admin setting was
 * stored and never applied to a single logger.
 */

export function isLogLevel(value: unknown): value is LogLevelName {
  return typeof value === "string" && (LOG_LEVELS as readonly string[]).includes(value);
}

export interface EffectiveLogLevel {
  level: LogLevelName;
  source: LogLevelSource;
}

export function environmentLogLevel(env: NodeJS.ProcessEnv = process.env): LogLevelName | null {
  const raw = env.LOG_LEVEL?.trim().toLowerCase();
  return isLogLevel(raw) ? raw : null;
}

export function defaultLogLevel(env: NodeJS.ProcessEnv = process.env): LogLevelName {
  return env.NODE_ENV === "production" ? "info" : "debug";
}

export function resolveEffectiveLogLevel(
  storedSetting: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env
): EffectiveLogLevel {
  const pinned = environmentLogLevel(env);
  if (pinned) return { level: pinned, source: "environment" };
  if (isLogLevel(storedSetting)) return { level: storedSetting, source: "settings" };
  return { level: defaultLogLevel(env), source: "default" };
}

/** Debug and trace are the levels at which the opt-in category logs run. */
export function isVerboseLevel(level: LogLevelName): boolean {
  return level === "debug" || level === "trace";
}
