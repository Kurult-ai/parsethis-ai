-- Add JSONB metadata column for queryable score components on screening events
ALTER TABLE "screening_events" ADD COLUMN "metadata" JSONB;

-- Add agentSafe flag to screening policies
ALTER TABLE "screening_policies" ADD COLUMN "agent_safe" BOOLEAN NOT NULL DEFAULT false;
