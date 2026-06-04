import "dotenv/config";
import { booleanSetting, positiveInteger } from "./catalogue-batch-options.mjs";
import { startJobServer, stopServer, waitForServer } from "./job-server-runner.mjs";

const port = positiveInteger(process.env.JOB_SERVER_PORT, 3014);
const runNetworkRepairs = booleanSetting(process.env.OPERATIONS_QA_NETWORK_REPAIRS, false);
const secret = process.env.JOB_SECRET?.trim();

if (!secret) {
  throw new Error("JOB_SECRET must be set before running Operations QA.");
}

const { baseUrl, output, server } = startJobServer({ port });

try {
  await waitForServer({ server, url: baseUrl, output });

  const status = await getJson("/api/jobs/catalogue-status");
  const gapReport = await getJson("/api/jobs/catalogue-gaps");
  const duplicateReview = await getJson("/api/jobs/duplicate-provider-review?limit=50");
  const initialRuns = await getJson("/api/jobs/runs?limit=10");
  const cardImageRepair = await postJson("/api/jobs/card-image-repair", { dryRun: true, limit: 1 });
  const sealedImageRepair = shouldRunSealedImageRepair(status.status)
    ? await postJson("/api/jobs/sealed-image-repair", { dryRun: true, limit: 1, waitMs: 0 })
    : skippedRepairJob({
      gapCount: status.status.sealedMissingImageCount,
      gapLabel: "sealed image",
      job: "sealed_image_repair",
    });
  const variantMetadataRepair = shouldRunVariantMetadataRepair(status.status)
    ? await postJson("/api/jobs/variant-metadata-repair", { dryRun: true, limit: 1, waitMs: 0 })
    : skippedRepairJob({
      gapCount: status.status.cardMissingVariantMetadataCount,
      gapLabel: "variant metadata",
      job: "variant_metadata_repair",
    });
  const finalRuns = await getJson("/api/jobs/runs?limit=10");

  assertCatalogueStatus(status);
  assertGapReport(gapReport);
  assertDuplicateReview(duplicateReview);
  assertJobRuns(initialRuns);
  assertDryRunJob(cardImageRepair, "card_image_repair");
  assertDryRunOrSkippedJob(sealedImageRepair, "sealed_image_repair");
  assertDryRunOrSkippedJob(variantMetadataRepair, "variant_metadata_repair");
  assertJobRuns(finalRuns);

  console.log(JSON.stringify({
    catalogueStatus: {
      cardPrintings: status.status.cardCount,
      duplicateProviderGroups: status.status.duplicateProviderIdCount,
      sealedProducts: status.status.sealedProductCount,
    },
    duplicateMerge: duplicateReview.groups?.length
      ? {
        groupsAvailable: duplicateReview.groups.length,
        status: "review_required",
      }
      : {
        reason: "No duplicate provider groups are currently present.",
        status: "skipped",
      },
    exports: {
      catalogueGaps: {
        cardsMissingImages: gapReport.status.cardMissingImageCount,
        cardsMissingVariantMetadata: gapReport.status.cardMissingVariantMetadataCount,
        duplicateProviderGroups: gapReport.status.duplicateProviderIdCount,
        recommendations: gapReport.recommendations.length,
      },
      duplicateProviderReviewGroups: duplicateReview.groups?.length ?? 0,
    },
    jobs: {
      cardImageRepair: summarizeTrackedJob(cardImageRepair),
      initialRuns: initialRuns.runs.length,
      latestRunType: finalRuns.runs[0]?.jobType ?? null,
      sealedImageRepair: summarizeTrackedJob(sealedImageRepair),
      variantMetadataRepair: summarizeTrackedJob(variantMetadataRepair),
    },
    ok: true,
  }, null, 2));
} finally {
  await stopServer(server);
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      authorization: `Bearer ${secret}`,
    },
  });

  return parseJsonResponse(response, path);
}

async function postJson(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return parseJsonResponse(response, path);
}

async function parseJsonResponse(response, path) {
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result.error ?? `${path} failed with HTTP ${response.status}.`);
  }

  return result;
}

function assertCatalogueStatus(result) {
  const status = result.status;

  if (!status || typeof status.cardCount !== "number" || typeof status.sealedProductCount !== "number") {
    throw new Error("Catalogue status did not include expected catalogue counts.");
  }
}

function assertGapReport(result) {
  if (!result.generatedAt || !result.status || !Array.isArray(result.recommendations)) {
    throw new Error("Catalogue gap report did not include expected sections.");
  }
}

function assertDuplicateReview(result) {
  if (!result.generatedAt || !Array.isArray(result.groups)) {
    throw new Error("Duplicate provider review did not include expected groups.");
  }
}

function assertJobRuns(result) {
  if (!Array.isArray(result.runs)) {
    throw new Error("Job runs response did not include a runs array.");
  }
}

function assertDryRunJob(result, expectedJob) {
  if (result.job !== expectedJob || result.dryRun !== true) {
    throw new Error(`${expectedJob} dry run did not return the expected job result.`);
  }

  if (result.jobRun?.status !== "succeeded") {
    throw new Error(`${expectedJob} did not record a succeeded job run.`);
  }
}

function assertDryRunOrSkippedJob(result, expectedJob) {
  if (result.status === "skipped" && result.job === expectedJob) {
    return;
  }

  assertDryRunJob(result, expectedJob);
}

function summarizeTrackedJob(result) {
  if (result.status === "skipped") {
    return result;
  }

  return {
    candidatesChecked: result.candidatesChecked,
    jobRunId: result.jobRun.id,
    status: result.jobRun.status,
  };
}

function shouldRunSealedImageRepair(status) {
  return runNetworkRepairs && status.sealedMissingImageCount > 0;
}

function shouldRunVariantMetadataRepair(status) {
  return runNetworkRepairs && status.cardMissingVariantMetadataCount > 0;
}

function skippedRepairJob({
  gapCount,
  gapLabel,
  job,
}) {
  return {
    job,
    reason: gapCount > 0
      ? `${gapCount} ${gapLabel} gap${gapCount === 1 ? "" : "s"} present; network-backed repairs are disabled for the default Operations QA pass.`
      : `No ${gapLabel} gaps are present and network-backed repairs are disabled.`,
    status: "skipped",
  };
}
