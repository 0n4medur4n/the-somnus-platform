-- Custom SQL migration file, put your code below! --

-- Seeds the fixed role catalog from build plan §11. These are reference
-- data, not dev/test fixtures (build plan §8's scripts/seed-dev.ts is a
-- separate, later concern for sample organizations/users) -- every
-- environment, including production, needs these 11 rows to exist
-- before any role can be assigned.
INSERT INTO `roles` (`id`, `key`, `name`, `scope`, `is_internal`) VALUES
  ('019f8a56-875d-70cb-9b0a-33c35f6145db', 'individual_user', 'Individual User', 'platform', false),
  ('019f8a56-875f-7495-bafe-4586e9a60da2', 'professional', 'Professional', 'platform', false),
  ('019f8a56-875f-7495-bafe-492d32d667e1', 'organization_owner', 'Organization Owner', 'organization', false),
  ('019f8a56-875f-7495-bafe-4c2b0f816336', 'organization_admin', 'Organization Admin', 'organization', false),
  ('019f8a56-875f-7495-bafe-53ebbf216a5a', 'professional_manager', 'Professional Manager', 'organization', false),
  ('019f8a56-875f-7495-bafe-566b323c36e2', 'clinical_supervisor', 'Clinical Supervisor', 'organization', false),
  ('019f8a56-875f-7495-bafe-5a083724b9e2', 'support_agent', 'Support Agent', 'platform', true),
  ('019f8a56-875f-7495-bafe-5d6bfad75436', 'professional_verifier', 'Professional Verifier', 'platform', true),
  ('019f8a56-875f-7495-bafe-6325a9766920', 'clinical_governance_reviewer', 'Clinical Governance Reviewer', 'platform', true),
  ('019f8a56-875f-7495-bafe-64bfbadecaf7', 'platform_admin', 'Platform Admin', 'platform', true),
  ('019f8a56-875f-7495-bafe-697ddd50ed69', 'platform_super_admin', 'Platform Super Admin', 'platform', true);
