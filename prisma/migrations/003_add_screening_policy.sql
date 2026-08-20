-- CreateTable: screening_policies
CREATE TABLE "screening_policies" (
    "id" TEXT NOT NULL,
    "api_key_id" TEXT NOT NULL,
    "screen_user_input" BOOLEAN NOT NULL DEFAULT true,
    "screen_tool_outputs" BOOLEAN NOT NULL DEFAULT true,
    "screen_forwarded_messages" BOOLEAN NOT NULL DEFAULT true,
    "screen_all_prompts" BOOLEAN NOT NULL DEFAULT false,
    "auto_block_threshold" INTEGER NOT NULL DEFAULT 7,
    "execute_in_sandbox" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "screening_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "screening_policies_api_key_id_key" ON "screening_policies"("api_key_id");

-- AddForeignKey
ALTER TABLE "screening_policies" ADD CONSTRAINT "screening_policies_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
