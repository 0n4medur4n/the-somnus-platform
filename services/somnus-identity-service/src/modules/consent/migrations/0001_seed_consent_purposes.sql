-- Permanent reference data (build plan §13): the six purposes a user
-- consents to separately, never combined into one checkbox, plus one
-- legal document per purpose and its initial (version 1) content.
--
-- The version-1 `content` values below are short placeholders, not
-- real legal copy -- authoring the actual Terms of Service / Privacy
-- Policy / etc. text is a legal/content workstream, out of scope for
-- this checkpoint's data-layer and API work. Real content replaces
-- these via a new `legal_document_versions` row (a new version, never
-- an UPDATE of an existing one), the same way any future policy
-- change would be published.
INSERT INTO `consent_purposes` (`id`, `key`, `name`, `is_required`) VALUES
  ('019f9452-3936-749f-9ebc-2f59a6c09e6e', 'terms_acceptance', 'Terms of Service acceptance', true),
  ('019f9452-3938-7296-b556-09dd2d9b2c42', 'privacy_policy_acknowledgement', 'Privacy Policy acknowledgement', true),
  ('019f9452-3939-77df-baca-86ba34dfc3a0', 'health_data_processing', 'Health data processing', true),
  ('019f9452-3939-77df-baca-922a8474fdc7', 'professional_sharing', 'Professional data sharing', false),
  ('019f9452-3939-77df-baca-9d193224c6f5', 'marketing', 'Marketing communications', false),
  ('019f9452-3939-77df-baca-a9f29553df9b', 'research_participation', 'Research participation', false);
--> statement-breakpoint
INSERT INTO `legal_documents` (`id`, `purpose_key`, `name`) VALUES
  ('019f9452-3937-721d-b19e-1721427dc157', 'terms_acceptance', 'Terms of Service'),
  ('019f9452-3938-7296-b556-0f0ee4ff0c7c', 'privacy_policy_acknowledgement', 'Privacy Policy'),
  ('019f9452-3939-77df-baca-8bb8440f7075', 'health_data_processing', 'Health Data Processing Policy'),
  ('019f9452-3939-77df-baca-97088085c349', 'professional_sharing', 'Professional Data Sharing Policy'),
  ('019f9452-3939-77df-baca-a0653d2b551a', 'marketing', 'Marketing Communications Policy'),
  ('019f9452-3939-77df-baca-ae4af5b2e97c', 'research_participation', 'Research Participation Policy');
--> statement-breakpoint
INSERT INTO `legal_document_versions` (`id`, `legal_document_id`, `version`, `locale`, `content`) VALUES
  ('019f9452-3937-721d-b19e-188f221cc1bd', '019f9452-3937-721d-b19e-1721427dc157', 1, 'es', 'Placeholder v1 content -- Terms of Service.'),
  ('019f9452-3938-7296-b556-136b1bc906d7', '019f9452-3938-7296-b556-0f0ee4ff0c7c', 1, 'es', 'Placeholder v1 content -- Privacy Policy.'),
  ('019f9452-3939-77df-baca-8d7d92fd9277', '019f9452-3939-77df-baca-8bb8440f7075', 1, 'es', 'Placeholder v1 content -- Health Data Processing Policy.'),
  ('019f9452-3939-77df-baca-9b626034fa24', '019f9452-3939-77df-baca-97088085c349', 1, 'es', 'Placeholder v1 content -- Professional Data Sharing Policy.'),
  ('019f9452-3939-77df-baca-a7f2f05089e8', '019f9452-3939-77df-baca-a0653d2b551a', 1, 'es', 'Placeholder v1 content -- Marketing Communications Policy.'),
  ('019f9452-3939-77df-baca-b0df507097bc', '019f9452-3939-77df-baca-ae4af5b2e97c', 1, 'es', 'Placeholder v1 content -- Research Participation Policy.');
