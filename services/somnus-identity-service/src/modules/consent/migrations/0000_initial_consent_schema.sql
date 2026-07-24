CREATE TABLE `consent_audit_events` (
	`id` varchar(36) NOT NULL,
	`event_type` varchar(120) NOT NULL,
	`user_id` varchar(36),
	`purpose_key` enum('terms_acceptance','privacy_policy_acknowledgement','health_data_processing','professional_sharing','marketing','research_participation'),
	`data` json,
	`occurred_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `consent_audit_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `consent_purposes` (
	`id` varchar(36) NOT NULL,
	`key` enum('terms_acceptance','privacy_policy_acknowledgement','health_data_processing','professional_sharing','marketing','research_participation') NOT NULL,
	`name` varchar(200) NOT NULL,
	`is_required` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `consent_purposes_id` PRIMARY KEY(`id`),
	CONSTRAINT `consent_purposes_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `consent_receipts` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`purpose_key` enum('terms_acceptance','privacy_policy_acknowledgement','health_data_processing','professional_sharing','marketing','research_participation') NOT NULL,
	`legal_document_version_id` varchar(36) NOT NULL,
	`organization_id` varchar(36),
	`source` varchar(120) NOT NULL,
	`consented_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `consent_receipts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `consent_withdrawals` (
	`id` varchar(36) NOT NULL,
	`receipt_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`reason` varchar(500),
	`withdrawn_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `consent_withdrawals_id` PRIMARY KEY(`id`),
	CONSTRAINT `consent_withdrawals_receipt_id_unique` UNIQUE(`receipt_id`)
);
--> statement-breakpoint
CREATE TABLE `legal_document_versions` (
	`id` varchar(36) NOT NULL,
	`legal_document_id` varchar(36) NOT NULL,
	`version` int NOT NULL,
	`locale` enum('es','en','ca','fr') NOT NULL,
	`content` text NOT NULL,
	`effective_at` timestamp NOT NULL DEFAULT (now()),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `legal_document_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `legal_document_versions_doc_version_locale_idx` UNIQUE(`legal_document_id`,`version`,`locale`)
);
--> statement-breakpoint
CREATE TABLE `legal_documents` (
	`id` varchar(36) NOT NULL,
	`purpose_key` enum('terms_acceptance','privacy_policy_acknowledgement','health_data_processing','professional_sharing','marketing','research_participation') NOT NULL,
	`name` varchar(200) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `legal_documents_id` PRIMARY KEY(`id`),
	CONSTRAINT `legal_documents_purpose_key_unique` UNIQUE(`purpose_key`)
);
