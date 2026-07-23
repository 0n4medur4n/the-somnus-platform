-- Down migration for 0000_initial_identity_schema.
-- Drizzle Kit only generates "up" SQL; this file is hand-maintained
-- per build plan §8's migration rollback policy ("every migration
-- must be reversible, or explicitly documented as irreversible with a
-- stated recovery path"). No FK constraints exist between these
-- tables (see schema/index.ts), so drop order does not matter for
-- correctness -- listed in reverse-creation order for readability.
DROP TABLE IF EXISTS `users`;
DROP TABLE IF EXISTS `user_identities`;
DROP TABLE IF EXISTS `professional_verification_cases`;
DROP TABLE IF EXISTS `professional_profiles`;
DROP TABLE IF EXISTS `professional_credentials`;
DROP TABLE IF EXISTS `individual_profiles`;
DROP TABLE IF EXISTS `roles`;
DROP TABLE IF EXISTS `role_permissions`;
DROP TABLE IF EXISTS `role_assignments`;
DROP TABLE IF EXISTS `permissions`;
DROP TABLE IF EXISTS `organizations`;
DROP TABLE IF EXISTS `organization_memberships`;
DROP TABLE IF EXISTS `organization_locations`;
DROP TABLE IF EXISTS `organization_invitations`;
DROP TABLE IF EXISTS `identity_audit_events`;
DROP TABLE IF EXISTS `session_revocations`;
DROP TABLE IF EXISTS `deletion_requests`;
DROP TABLE IF EXISTS `account_status_history`;
DROP TABLE IF EXISTS `access_grants`;
