-- Down migration for 0004_legal_v3_profile_and_marketing: removes the v3
-- privacy and marketing versions. Receipts given against them must be erased first.
DELETE FROM `legal_document_versions` WHERE `id` IN (
  '019fe7a0-000d-7000-8000-00000000000d',
  '019fe7a0-000e-7000-8000-00000000000e',
  '019fe7a0-000f-7000-8000-00000000000f',
  '019fe7a0-0010-7000-8000-000000000010',
  '019fe7a0-0011-7000-8000-000000000011',
  '019fe7a0-0012-7000-8000-000000000012',
  '019fe7a0-0013-7000-8000-000000000013',
  '019fe7a0-0014-7000-8000-000000000014'
);
