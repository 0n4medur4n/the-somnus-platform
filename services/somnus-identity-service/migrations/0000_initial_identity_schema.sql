CREATE TABLE `access_grants` (
	`id` varchar(36) NOT NULL,
	`professional_user_id` varchar(36) NOT NULL,
	`subject_user_id` varchar(36) NOT NULL,
	`organization_id` varchar(36),
	`granted_by` varchar(36) NOT NULL,
	`scope` varchar(120) NOT NULL,
	`status` enum('active','revoked','expired') NOT NULL DEFAULT 'active',
	`expires_at` timestamp,
	`revoked_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `access_grants_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `account_status_history` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`previous_status` varchar(32) NOT NULL,
	`new_status` varchar(32) NOT NULL,
	`reason` varchar(500),
	`changed_by` varchar(36),
	`changed_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `account_status_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `deletion_requests` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`status` enum('pending','completed','cancelled') NOT NULL DEFAULT 'pending',
	`requested_at` timestamp NOT NULL DEFAULT (now()),
	`completed_at` timestamp,
	CONSTRAINT `deletion_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `session_revocations` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`revoked_at` timestamp NOT NULL DEFAULT (now()),
	`reason` varchar(200),
	CONSTRAINT `session_revocations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `identity_audit_events` (
	`id` varchar(36) NOT NULL,
	`event_type` varchar(120) NOT NULL,
	`actor_user_id` varchar(36),
	`subject_user_id` varchar(36),
	`organization_id` varchar(36),
	`data` json,
	`occurred_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `identity_audit_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `organization_invitations` (
	`id` varchar(36) NOT NULL,
	`organization_id` varchar(36) NOT NULL,
	`email` varchar(320) NOT NULL,
	`role_id` varchar(36),
	`token` varchar(128) NOT NULL,
	`status` enum('pending','accepted','revoked','expired') NOT NULL DEFAULT 'pending',
	`invited_by` varchar(36) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`accepted_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `organization_invitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `organization_invitations_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `organization_locations` (
	`id` varchar(36) NOT NULL,
	`organization_id` varchar(36) NOT NULL,
	`name` varchar(200) NOT NULL,
	`address` varchar(500),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `organization_locations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `organization_memberships` (
	`id` varchar(36) NOT NULL,
	`organization_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`status` enum('active','inactive','removed') NOT NULL DEFAULT 'active',
	`invited_by` varchar(36),
	`joined_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `organization_memberships_id` PRIMARY KEY(`id`),
	CONSTRAINT `organization_memberships_org_user_idx` UNIQUE(`organization_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` varchar(36) NOT NULL,
	`name` varchar(200) NOT NULL,
	`status` enum('active','suspended') NOT NULL DEFAULT 'active',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `organizations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `permissions` (
	`id` varchar(36) NOT NULL,
	`key` varchar(120) NOT NULL,
	`description` varchar(500) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `permissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `permissions_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `role_assignments` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`role_id` varchar(36) NOT NULL,
	`organization_id` varchar(36),
	`assigned_by` varchar(36) NOT NULL,
	`assigned_at` timestamp NOT NULL DEFAULT (now()),
	`revoked_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `role_assignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`id` varchar(36) NOT NULL,
	`role_id` varchar(36) NOT NULL,
	`permission_id` varchar(36) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `role_permissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `role_permissions_role_permission_idx` UNIQUE(`role_id`,`permission_id`)
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` varchar(36) NOT NULL,
	`key` enum('individual_user','professional','organization_owner','organization_admin','professional_manager','clinical_supervisor','support_agent','professional_verifier','clinical_governance_reviewer','platform_admin','platform_super_admin') NOT NULL,
	`name` varchar(120) NOT NULL,
	`scope` enum('platform','organization') NOT NULL,
	`is_internal` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `roles_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `individual_profiles` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`first_name` varchar(120) NOT NULL,
	`last_name` varchar(120) NOT NULL,
	`date_of_birth` date,
	`phone` varchar(32),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `individual_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `individual_profiles_user_id_unique` UNIQUE(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `professional_credentials` (
	`id` varchar(36) NOT NULL,
	`professional_profile_id` varchar(36) NOT NULL,
	`credential_type` varchar(120) NOT NULL,
	`issuer` varchar(200) NOT NULL,
	`issued_at` date,
	`expires_at` date,
	`document_url` varchar(500),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `professional_credentials_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `professional_profiles` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`specialty` enum('family_physician','pediatrician','sleep_physician','psychologist','nurse','pharmacist','therapist') NOT NULL,
	`license_number` varchar(64) NOT NULL,
	`verification_status` enum('pending','verified','rejected') NOT NULL DEFAULT 'pending',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `professional_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `professional_profiles_user_id_unique` UNIQUE(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `professional_verification_cases` (
	`id` varchar(36) NOT NULL,
	`professional_profile_id` varchar(36) NOT NULL,
	`status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
	`reviewer_id` varchar(36),
	`reviewed_at` timestamp,
	`notes` varchar(2000),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `professional_verification_cases_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_identities` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`provider` enum('firebase') NOT NULL DEFAULT 'firebase',
	`provider_user_id` varchar(128) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `user_identities_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_identities_provider_uid_idx` UNIQUE(`provider`,`provider_user_id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(36) NOT NULL,
	`email` varchar(320) NOT NULL,
	`locale` enum('es','en','ca','fr') NOT NULL DEFAULT 'es',
	`status` enum('active','suspended','deleted') NOT NULL DEFAULT 'active',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
