import "dotenv/config";
import { pathToFileURL } from "node:url";
import { reviewedTcgcsvCatalogueTargets } from "./reviewed-tcgcsv-card-catalogue.mjs";
import { appBaseUrl } from "./run-live-scheduled-job.mjs";

export async function runLiveReviewedCardCatalogueRefresh({
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const baseUrl = appBaseUrl(env);
  const secret = required(
    env.JOB_SECRET,
    "JOB_SECRET must be set before refreshing the reviewed card catalogue.",
  );
  const requestedGroupIds = idSet(env.TCGCSV_REVIEWED_CATALOGUE_GROUP_IDS);
  const targets = reviewedTcgcsvCatalogueTargets()
    .filter((target) => requestedGroupIds.size === 0 || requestedGroupIds.has(target.groupId));

  if (!targets.length) {
    throw new Error("TCGCSV_REVIEWED_CATALOGUE_GROUP_IDS did not select a reviewed group.");
  }

  const results = [];
  const failures = [];

  if (targets.some((target) => target.categoryId === 3 && target.groupId === "24451")) {
    await runTarget({
      body: {
        language: "en",
        scheduled: true,
        setId: "mep",
      },
      failure: {
        language: "en",
        setId: "mep",
      },
      label: "TCGdex set en:mep",
      path: "/api/jobs/international-catalogue-refresh",
    });
  }

  for (const target of targets) {
    await runTarget({
      body: {
          categoryId: target.categoryId,
          groupId: target.groupId,
          scheduled: true,
          writePrices: true,
      },
      failure: {
        categoryId: target.categoryId,
        groupId: target.groupId,
      },
      label: `Reviewed catalogue group ${target.groupId}`,
      path: "/api/jobs/reviewed-card-catalogue-refresh",
    });
  }

  async function runTarget({ body, failure, label, path }) {
    try {
      const response = await fetchImpl(new URL(path, baseUrl), {
        body: JSON.stringify(body),
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
        },
        method: "POST",
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.error ?? `${label} failed with ${response.status}.`);
      }

      results.push(result);
    } catch (error) {
      failures.push({
        error: error instanceof Error ? error.message : String(error),
        ...failure,
      });
    }
  }

  const summary = {
    baseUrl,
    complete: failures.length === 0,
    failures,
    groupsRequested: targets.length,
    setRefreshesRequested: targets.some((target) => target.categoryId === 3 && target.groupId === "24451") ? 1 : 0,
    results,
  };

  if (failures.length) {
    const error = new Error(`Reviewed card catalogue refresh failed for ${failures.length} group(s).`);

    error.summary = summary;
    throw error;
  }

  return summary;
}

function idSet(value) {
  return new Set(String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean));
}

function required(value, message) {
  const text = String(value ?? "").trim();

  if (!text) throw new Error(message);
  return text;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLiveReviewedCardCatalogueRefresh()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      if (error?.summary) {
        console.error(JSON.stringify(error.summary, null, 2));
      }

      console.error(error);
      process.exitCode = 1;
    });
}
