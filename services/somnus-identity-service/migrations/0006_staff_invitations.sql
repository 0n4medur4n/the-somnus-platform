CREATE TABLE `staff_invitations` (
	`id` varchar(36) NOT NULL,
	`email` varchar(320) NOT NULL,
	`first_name` varchar(120) NOT NULL,
	`last_name` varchar(120) NOT NULL,
	`role_key` enum('support_agent','professional_verifier','clinical_governance_reviewer','platform_admin','platform_super_admin') NOT NULL,
	`locale` enum('es','en','ca','fr') NOT NULL DEFAULT 'es',
	`status` enum('pending','accepted','revoked') NOT NULL DEFAULT 'pending',
	`invited_by` varchar(36) NOT NULL,
	`accepted_user_id` varchar(36),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`expires_at` timestamp NOT NULL,
	`accepted_at` timestamp,
	CONSTRAINT `staff_invitations_id` PRIMARY KEY(`id`)
);
