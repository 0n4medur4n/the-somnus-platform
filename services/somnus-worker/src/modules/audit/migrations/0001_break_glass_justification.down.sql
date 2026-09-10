-- Down migration for 0001_break_glass_justification (build plan §8 / §19: migrations up AND down).
ALTER TABLE `audit_records` DROP COLUMN `justification`;
