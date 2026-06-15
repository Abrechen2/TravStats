-- Admin instance settings: public_url / lan_url — Phase S.2
--
-- Hand-written additive migration (see CLAUDE.md). Both are nullable column
-- adds, idempotent via IF NOT EXISTS — safe to re-apply.

-- Externally reachable base URL handed to the mobile app after pairing.
ALTER TABLE "admin_settings" ADD COLUMN IF NOT EXISTS "public_url" TEXT;

-- Optional secondary LAN base URL hint for on-network clients.
ALTER TABLE "admin_settings" ADD COLUMN IF NOT EXISTS "lan_url" TEXT;
