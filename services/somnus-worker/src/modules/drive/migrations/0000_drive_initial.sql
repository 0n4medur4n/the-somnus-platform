CREATE TABLE `drive_accounts` (
	`user_id` varchar(36) NOT NULL,
	`email` varchar(320) NOT NULL,
	`enc_public_key` varchar(256) NOT NULL,
	`sign_public_key` varchar(256) NOT NULL,
	`private_keys` json NOT NULL,
	`passphrase_wrap` json NOT NULL,
	`recovery_wrap` json NOT NULL,
	`state` json,
	`key_version` int NOT NULL DEFAULT 1,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `drive_accounts_user_id` PRIMARY KEY(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `drive_blocks` (
	`node_id` varchar(36) NOT NULL,
	`revision` int NOT NULL,
	`block_index` int NOT NULL,
	`share_id` varchar(36) NOT NULL,
	`size_bytes` int NOT NULL,
	`data` mediumblob NOT NULL,
	CONSTRAINT `drive_blocks_node_id_revision_block_index_pk` PRIMARY KEY(`node_id`,`revision`,`block_index`)
);
--> statement-breakpoint
CREATE TABLE `drive_members` (
	`share_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`role` varchar(16) NOT NULL,
	`member_key` json NOT NULL,
	`key_generation` int NOT NULL,
	`member_key_version` int NOT NULL,
	`granted_by` varchar(36) NOT NULL,
	`key_signed_by` varchar(36) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `drive_members_share_id_user_id_pk` PRIMARY KEY(`share_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `drive_nodes` (
	`id` varchar(36) NOT NULL,
	`share_id` varchar(36) NOT NULL,
	`parent_id` varchar(36),
	`kind` varchar(16) NOT NULL,
	`node_key` json NOT NULL,
	`key_generation` int NOT NULL,
	`meta` json NOT NULL,
	`revision` int NOT NULL DEFAULT 0,
	`block_count` int NOT NULL DEFAULT 0,
	`size_bytes` bigint NOT NULL DEFAULT 0,
	`content_hash` varchar(64) NOT NULL DEFAULT '',
	`signature` varchar(128) NOT NULL,
	`signed_by` varchar(36) NOT NULL,
	`created_by` varchar(36) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	`updated_at` timestamp(3) NOT NULL DEFAULT (now()),
	`trashed_at` timestamp(3),
	`trashed_by` varchar(36),
	CONSTRAINT `drive_nodes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `drive_shares` (
	`id` varchar(36) NOT NULL,
	`key_generation` int NOT NULL DEFAULT 1,
	`created_by` varchar(36) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `drive_shares_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `drive_uploads` (
	`node_id` varchar(36) NOT NULL,
	`revision` int NOT NULL,
	`share_id` varchar(36) NOT NULL,
	`block_count` int NOT NULL,
	`size_bytes` bigint NOT NULL,
	`content_hash` varchar(64) NOT NULL,
	`meta` json NOT NULL,
	`signature` varchar(128) NOT NULL,
	`signed_by` varchar(36) NOT NULL,
	`created_at` timestamp(3) NOT NULL DEFAULT (now()),
	CONSTRAINT `drive_uploads_node_id_revision_pk` PRIMARY KEY(`node_id`,`revision`)
);
--> statement-breakpoint
CREATE INDEX `drive_blocks_share_idx` ON `drive_blocks` (`share_id`);--> statement-breakpoint
CREATE INDEX `drive_members_user_idx` ON `drive_members` (`user_id`);--> statement-breakpoint
CREATE INDEX `drive_nodes_share_idx` ON `drive_nodes` (`share_id`);--> statement-breakpoint
CREATE INDEX `drive_uploads_share_idx` ON `drive_uploads` (`share_id`);