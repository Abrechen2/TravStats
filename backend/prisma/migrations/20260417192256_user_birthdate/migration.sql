-- Birthday stored per-user so the BIRTHDAY_FLIGHT achievement (v1.1) can
-- match a flight's departure month+day against it. Only month+day are used
-- for achievement logic, but storing DateTime lets the UI preserve the
-- full value if the user enters one.

ALTER TABLE "users"
  ADD COLUMN "birthdate" TIMESTAMP(3);
