CREATE TABLE `audit_records` (
	`id` varchar(36) NOT NULL,
	`event_id` varchar(36) NOT NULL,
	`event_type` varchar(120) NOT NULL,
	`occurred_at` varchar(40) NOT NULL,
	`producer` varchar(120) NOT NULL,
	`correlation_id` varchar(64) NOT NULL,
	`actor_type` varchar(64),
	`actor_id` varchar(200),
	`subject_type` varchar(64) NOT NULL,
	`subject_id` varchar(200) NOT NULL,
	`data` json NOT NULL,
	`received_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `audit_records_event_id_unique` UNIQUE(`event_id`)
);
