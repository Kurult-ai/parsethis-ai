-- Add results JSON column to evaluations table
ALTER TABLE "evaluations" ADD COLUMN "results" JSONB;

-- CreateTable: payment_records
CREATE TABLE "payment_records" (
    "id" TEXT NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "payer" TEXT NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL,
    "endpoint" TEXT NOT NULL,
    "depth" TEXT,
    "network" TEXT NOT NULL DEFAULT 'eip155:8453',
    "status" TEXT NOT NULL DEFAULT 'settled',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_records_tx_hash_key" ON "payment_records"("tx_hash");

-- CreateIndex
CREATE INDEX "idx_payments_payer" ON "payment_records"("payer");

-- CreateIndex
CREATE INDEX "idx_payments_timestamp" ON "payment_records"("timestamp" DESC);
