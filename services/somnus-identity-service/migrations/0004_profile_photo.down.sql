-- Down migration for 0004_profile_photo.
-- Drops the profile-photo marker from individual_profiles. Reversible: the
-- column is nullable and nothing else depends on it (the image lives in
-- edge-api's bucket, not here).
ALTER TABLE `individual_profiles` DROP COLUMN `photo_updated_at`;
