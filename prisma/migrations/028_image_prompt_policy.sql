-- Org image-in-prompt policy. allow | deny | whitelist
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS image_prompt_policy TEXT NOT NULL DEFAULT 'allow';
