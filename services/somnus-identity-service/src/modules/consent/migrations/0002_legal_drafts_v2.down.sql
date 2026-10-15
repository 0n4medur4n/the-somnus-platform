-- Down migration for 0002_legal_drafts_v2: removes the version-2 drafts.
-- Receipts given against them must be erased first (none exist outside dev).
DELETE FROM `legal_document_versions` WHERE `id` IN (
  '019fe7a0-0001-7000-8000-000000000001',
  '019fe7a0-0002-7000-8000-000000000002',
  '019fe7a0-0003-7000-8000-000000000003'
);
