-- Per-file ACL (plan: docs/plans/2026-08-22-file-acl-plan.md)

-- Tier 1: path patterns on data sources
ALTER TABLE data_sources ADD COLUMN IF NOT EXISTS path_pattern TEXT;

-- Tier 2: org file ACL rules (gateway-observed enforcement)
CREATE TABLE IF NOT EXISTS file_acl_rules (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    path_pattern TEXT NOT NULL,
    action TEXT NOT NULL DEFAULT 'block',
    priority INT NOT NULL DEFAULT 0,
    comment TEXT,
    created_at TIMESTAMP(3) NOT NULL DEFAULT now(),
    CONSTRAINT fk_file_acl_org FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_file_acl_rules_org ON file_acl_rules(org_id);
CREATE INDEX IF NOT EXISTS idx_file_acl_rules_org_priority ON file_acl_rules(org_id, priority);
