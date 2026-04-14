-- Drop dead canTrainLLM flag — field was never set by any backend route
-- and was always `false` for non-admin users. Parser access is gated
-- exclusively by `isAdmin` now. See ROADMAP if a per-user parser
-- permission is reintroduced later.
ALTER TABLE "users" DROP COLUMN IF EXISTS "can_train_llm";
