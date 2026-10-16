-- Down migration for 0005_profile_about.
-- Drops gender, country and city from individual_profiles. Reversible: all
-- three are nullable and nothing else depends on them.
ALTER TABLE `individual_profiles` DROP COLUMN `city`;
ALTER TABLE `individual_profiles` DROP COLUMN `country`;
ALTER TABLE `individual_profiles` DROP COLUMN `gender`;
