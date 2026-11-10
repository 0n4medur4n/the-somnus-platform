-- Down migration for 0008_passkey_data.
-- Drops only the passkey tables this migration adds. Earlier identity
-- tables are untouched. No foreign keys point at these tables
-- (schema/index.ts), so drop order does not matter.
DROP TABLE IF EXISTS `passkey_challenges`;
DROP TABLE IF EXISTS `passkey_credentials`;
DROP TABLE IF EXISTS `passkey_user_handles`;
