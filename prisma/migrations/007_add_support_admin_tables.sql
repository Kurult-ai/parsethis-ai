-- Support intake and admin operations tables
CREATE TABLE IF NOT EXISTS "entitlement_grants" (
  "id" TEXT NOT NULL,
  "api_key_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "tier" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "granted_by" TEXT NOT NULL,
  "price_mode" TEXT NOT NULL DEFAULT 'manual',
  "price_usd_cents" INTEGER,
  "stripe_price_id" TEXT,
  "starts_at" TIMESTAMP(3) NOT NULL,
  "ends_at" TIMESTAMP(3),
  "expire_key_at_end" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "entitlement_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "entitlement_grants_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "support_tickets" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "external_id" TEXT,
  "requester_email" TEXT,
  "requester_name" TEXT,
  "subject" TEXT,
  "body" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "priority" TEXT NOT NULL DEFAULT 'normal',
  "category" TEXT,
  "api_key_id" TEXT,
  "stripe_customer_id" TEXT,
  "assigned_to" TEXT,
  "summary" TEXT,
  "resolution" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "resolved_at" TIMESTAMP(3),
  CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "support_tickets_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "support_messages" (
  "id" TEXT NOT NULL,
  "ticket_id" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "external_id" TEXT,
  "from" TEXT,
  "to" TEXT,
  "body" TEXT NOT NULL,
  "screened" BOOLEAN NOT NULL DEFAULT false,
  "risk_score" DOUBLE PRECISION,
  "verdict" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "support_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "admin_action_receipts" (
  "id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "ticket_id" TEXT,
  "api_key_id" TEXT,
  "user_id" TEXT,
  "stripe_object_id" TEXT,
  "reason" TEXT,
  "dry_run" BOOLEAN NOT NULL DEFAULT false,
  "before" JSONB,
  "after" JSONB,
  "result" JSONB,
  "risk_level" TEXT NOT NULL DEFAULT 'low',
  "approval_state" TEXT NOT NULL DEFAULT 'not_required',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_action_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "admin_action_receipts_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "admin_action_receipts_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_entitlement_grants_key_status" ON "entitlement_grants"("api_key_id", "status");
CREATE INDEX IF NOT EXISTS "idx_entitlement_grants_user" ON "entitlement_grants"("user_id");
CREATE INDEX IF NOT EXISTS "idx_entitlement_grants_ends" ON "entitlement_grants"("ends_at");
CREATE INDEX IF NOT EXISTS "idx_support_tickets_status_priority" ON "support_tickets"("status", "priority");
CREATE INDEX IF NOT EXISTS "idx_support_tickets_requester" ON "support_tickets"("requester_email");
CREATE INDEX IF NOT EXISTS "idx_support_tickets_api_key" ON "support_tickets"("api_key_id");
CREATE INDEX IF NOT EXISTS "idx_support_messages_ticket_created" ON "support_messages"("ticket_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_admin_receipts_action_created" ON "admin_action_receipts"("action", "created_at");
CREATE INDEX IF NOT EXISTS "idx_admin_receipts_ticket" ON "admin_action_receipts"("ticket_id");
CREATE INDEX IF NOT EXISTS "idx_admin_receipts_api_key" ON "admin_action_receipts"("api_key_id");
