CREATE TABLE `passkey_challenges` (
	`id` varchar(36) NOT NULL,
	`challenge` binary(32) NOT NULL,
	`purpose` enum('registration','authentication','step_up') NOT NULL,
	`user_id` varchar(36),
	`session_binding_hash` binary(32),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`expires_at` timestamp NOT NULL,
	CONSTRAINT `passkey_challenges_id` PRIMARY KEY(`id`),
	CONSTRAINT `passkey_challenges_challenge_uidx` UNIQUE(`challenge`)
);
--> statement-breakpoint
CREATE TABLE `passkey_credentials` (
	`id` varchar(36) NOT NULL,
	`credential_id` varbinary(1023) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`public_key` varbinary(1024) NOT NULL,
	`cose_algorithm` smallint NOT NULL,
	`sign_count` int unsigned NOT NULL DEFAULT 0,
	`transports` json,
	`aaguid` binary(16),
	`backup_eligible` boolean NOT NULL,
	`backup_state` boolean NOT NULL,
	`name` varchar(120) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`pending_expires_at` timestamp,
	`activated_at` timestamp,
	`last_used_at` timestamp,
	`revoked_at` timestamp,
	`locked_at` timestamp,
	CONSTRAINT `passkey_credentials_id` PRIMARY KEY(`id`),
	CONSTRAINT `passkey_credentials_credential_id_uidx` UNIQUE(`credential_id`)
);
--> statement-breakpoint
CREATE TABLE `passkey_user_handles` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`handle` binary(32) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `passkey_user_handles_id` PRIMARY KEY(`id`),
	CONSTRAINT `passkey_user_handles_user_id_uidx` UNIQUE(`user_id`),
	CONSTRAINT `passkey_user_handles_handle_uidx` UNIQUE(`handle`)
);
--> statement-breakpoint
CREATE INDEX `passkey_challenges_expires_at_idx` ON `passkey_challenges` (`expires_at`);--> statement-breakpoint
CREATE INDEX `passkey_credentials_user_id_idx` ON `passkey_credentials` (`user_id`);