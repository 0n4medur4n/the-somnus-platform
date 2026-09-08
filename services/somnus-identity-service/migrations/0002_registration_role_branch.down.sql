-- Down migration for 0002_registration_role_branch (Addendum A, Checkpoint 14.1).
-- Drops the registration role-branch columns from individual_profiles. Reversible:
-- the columns are nullable and carry no data any other table depends on.
ALTER TABLE `individual_profiles` DROP COLUMN `minor_age_band`;
ALTER TABLE `individual_profiles` DROP COLUMN `guardianship_confirmed`;
ALTER TABLE `individual_profiles` DROP COLUMN `registration_role`;
