CREATE TABLE `platform_invitations` (
	`id` varchar(36) NOT NULL,
	`email` varchar(320) NOT NULL,
	`pending_email` varchar(320),
	`first_name` varchar(120) NOT NULL,
	`last_name` varchar(120) NOT NULL,
	`role` enum('adult','professional') NOT NULL,
	`locale` enum('es','en','ca','fr') NOT NULL,
	`status` enum('pending','accepted','revoked') NOT NULL DEFAULT 'pending',
	`invited_by` varchar(36) NOT NULL,
	`prepared_user_id` varchar(36),
	`expires_at` timestamp NOT NULL,
	`accepted_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `platform_invitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `platform_invitations_pending_email_unique` UNIQUE(`pending_email`)
);
