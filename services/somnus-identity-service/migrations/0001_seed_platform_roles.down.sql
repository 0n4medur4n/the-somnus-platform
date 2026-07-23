-- Down migration for 0001_seed_platform_roles.
DELETE FROM `roles` WHERE `key` IN (
  'individual_user',
  'professional',
  'organization_owner',
  'organization_admin',
  'professional_manager',
  'clinical_supervisor',
  'support_agent',
  'professional_verifier',
  'clinical_governance_reviewer',
  'platform_admin',
  'platform_super_admin'
);
