-- Down migration for 0001_sign_in_link_type: removes the sign_in_link value.
-- Delivery rows of that type must be deleted first, or the ALTER fails.
DELETE FROM `notification_deliveries` WHERE `type` = 'sign_in_link';
ALTER TABLE `notification_deliveries` MODIFY COLUMN `type` enum('invitation','report_ready') NOT NULL;
