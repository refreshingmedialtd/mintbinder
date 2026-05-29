-- CreateEnum
CREATE TYPE "job_run_type" AS ENUM ('price_alerts', 'catalogue_refresh', 'pricing_refresh');

-- CreateEnum
CREATE TYPE "job_run_status" AS ENUM ('running', 'succeeded', 'failed');

-- CreateTable
CREATE TABLE "job_runs" (
    "id" UUID NOT NULL,
    "job_type" "job_run_type" NOT NULL,
    "status" "job_run_status" NOT NULL DEFAULT 'running',
    "request_payload" JSONB NOT NULL DEFAULT '{}',
    "result_payload" JSONB NOT NULL DEFAULT '{}',
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_runs_job_type_started_at_idx" ON "job_runs"("job_type", "started_at");

-- CreateIndex
CREATE INDEX "job_runs_status_started_at_idx" ON "job_runs"("status", "started_at");
