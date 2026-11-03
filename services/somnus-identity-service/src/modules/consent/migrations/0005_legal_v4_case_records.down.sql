-- Down migration for 0005_legal_v4_case_records: removes the privacy v4 and
-- health-data v3 versions. Receipts given against them must be erased first.
DELETE FROM `legal_document_versions` WHERE `id` IN (
  '019fe7a0-0015-7000-8000-000000000015',
  '019fe7a0-0016-7000-8000-000000000016',
  '019fe7a0-0017-7000-8000-000000000017',
  '019fe7a0-0018-7000-8000-000000000018',
  '019fe7a0-0019-7000-8000-000000000019',
  '019fe7a0-001a-7000-8000-00000000001a',
  '019fe7a0-001b-7000-8000-00000000001b',
  '019fe7a0-001c-7000-8000-00000000001c'
);
