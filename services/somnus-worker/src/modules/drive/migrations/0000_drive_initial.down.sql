-- Reverses 0000_drive_initial (ADR 0019). Irreversible for the DATA it holds:
-- dropping these tables destroys every enrolled key and every encrypted file.
-- Recovery path: restore somnus_drive from backup (docs/runbooks/backup-restore.md).
DROP TABLE IF EXISTS `drive_blocks`;
DROP TABLE IF EXISTS `drive_uploads`;
DROP TABLE IF EXISTS `drive_nodes`;
DROP TABLE IF EXISTS `drive_members`;
DROP TABLE IF EXISTS `drive_shares`;
DROP TABLE IF EXISTS `drive_accounts`;
