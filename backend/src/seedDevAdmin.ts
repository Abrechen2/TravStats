/**
 * Dev-only seed: ensure `admin:admin123` exists as the standard admin
 * account on a developer's local DB and load the same demo dataset that
 * `seedDemoUser` ships into that admin's account.
 *
 * Idempotent — safe to re-run. Existing admin password and flag get reset
 * on each run so a forgotten dev password is always recoverable.
 *
 *   npm run seed:dev-admin
 *
 * NEVER run against a production DB. The DATABASE_URL gate in CLAUDE.local.md
 * (localhost:5433/flights_dev) is the operator's responsibility.
 */
import { seedDemoUser } from "./seedDemoUser";

void seedDemoUser({
  username: "admin",
  password: "admin123",
  isAdmin: true,
  resetCredentials: true,
});
