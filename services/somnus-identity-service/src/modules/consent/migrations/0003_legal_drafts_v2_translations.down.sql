-- Down migration for 0003_legal_drafts_v2_translations: removes the en/ca/fr
-- version-2 drafts. Receipts given against them must be erased first.
DELETE FROM `legal_document_versions` WHERE `id` IN (
  '019fe7a0-0004-7000-8000-000000000004',
  '019fe7a0-0005-7000-8000-000000000005',
  '019fe7a0-0006-7000-8000-000000000006',
  '019fe7a0-0007-7000-8000-000000000007',
  '019fe7a0-0008-7000-8000-000000000008',
  '019fe7a0-0009-7000-8000-000000000009',
  '019fe7a0-000a-7000-8000-00000000000a',
  '019fe7a0-000b-7000-8000-00000000000b',
  '019fe7a0-000c-7000-8000-00000000000c'
);
