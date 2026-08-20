CREATE TABLE `notification_deliveries` (
	`id` varchar(36) NOT NULL,
	`idempotency_key` varchar(200) NOT NULL,
	`type` enum('invitation','report_ready') NOT NULL,
	`recipient` varchar(320) NOT NULL,
	`locale` enum('es','en','ca','fr') NOT NULL,
	`status` enum('pending','sent','failed','dead_letter') NOT NULL DEFAULT 'pending',
	`attempts` int NOT NULL DEFAULT 0,
	`last_error` varchar(500),
	`provider_message_id` varchar(200),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `notification_deliveries_id` PRIMARY KEY(`id`),
	CONSTRAINT `notification_deliveries_idempotency_key_unique` UNIQUE(`idempotency_key`)
);
