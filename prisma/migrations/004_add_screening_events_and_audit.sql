-- CreateTable: screening_events
CREATE TABLE "screening_events" (
    "id" TEXT NOT NULL,
    "api_key_id" TEXT NOT NULL,
    "risk_score" DOUBLE PRECISION NOT NULL,
    "verdict" TEXT NOT NULL,
    "categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "mode" TEXT NOT NULL DEFAULT 'full',
    "latency_ms" INTEGER NOT NULL,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "screening_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_screening_apikey_created" ON "screening_events"("api_key_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_screening_created" ON "screening_events"("created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_screening_verdict" ON "screening_events"("verdict");

-- AddForeignKey
ALTER TABLE "screening_events" ADD CONSTRAINT "screening_events_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: audit_events
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "api_key_id" TEXT,
    "detail" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_audit_action" ON "audit_events"("action");

-- CreateIndex
CREATE INDEX "idx_audit_created" ON "audit_events"("created_at" DESC);
