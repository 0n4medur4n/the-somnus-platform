DELETE FROM `legal_document_versions` WHERE `id` IN (
  '019f9452-3937-721d-b19e-188f221cc1bd',
  '019f9452-3938-7296-b556-136b1bc906d7',
  '019f9452-3939-77df-baca-8d7d92fd9277',
  '019f9452-3939-77df-baca-9b626034fa24',
  '019f9452-3939-77df-baca-a7f2f05089e8',
  '019f9452-3939-77df-baca-b0df507097bc'
);
DELETE FROM `legal_documents` WHERE `id` IN (
  '019f9452-3937-721d-b19e-1721427dc157',
  '019f9452-3938-7296-b556-0f0ee4ff0c7c',
  '019f9452-3939-77df-baca-8bb8440f7075',
  '019f9452-3939-77df-baca-97088085c349',
  '019f9452-3939-77df-baca-a0653d2b551a',
  '019f9452-3939-77df-baca-ae4af5b2e97c'
);
DELETE FROM `consent_purposes` WHERE `key` IN (
  'terms_acceptance',
  'privacy_policy_acknowledgement',
  'health_data_processing',
  'professional_sharing',
  'marketing',
  'research_participation'
);
