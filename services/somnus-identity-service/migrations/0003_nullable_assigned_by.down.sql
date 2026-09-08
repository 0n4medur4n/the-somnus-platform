-- Down migration for 0003_nullable_assigned_by (Addendum A §A5.4 / Checkpoint 15.2).
--
-- Reversing this requires every row to have an assigner again. The bootstrap
-- row (the first platform_super_admin, granted with no acting admin) has NULL
-- by design, so it is backfilled to the grantee's own id -- which is the exact
-- ambiguity the forward migration exists to remove. Reverse only if no
-- bootstrap assignment has been made, or accept that loss of provenance.
UPDATE `role_assignments` SET `assigned_by` = `user_id` WHERE `assigned_by` IS NULL;
ALTER TABLE `role_assignments` MODIFY COLUMN `assigned_by` varchar(36) NOT NULL;
