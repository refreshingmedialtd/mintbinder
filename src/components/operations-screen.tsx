"use client";

import {
  ArrowDownUp,
  BarChart3,
  Check,
  Database,
  Download,
  GalleryVerticalEnd,
  History,
  Info,
  Languages,
  Layers3,
  Mail,
  PackagePlus,
  RefreshCw,
  Search,
  Sparkles,
  TerminalSquare,
} from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import {
  catalogueDisplayCardForText,
  catalogueDisplaySetForText,
} from "@/lib/catalogue/name-aliases";
import { CATALOGUE_LANGUAGE_OPTIONS } from "@/lib/catalogue/languages";
import { isOptimizableCatalogueImageUrl } from "@/lib/catalogue/image-url";
import type {
  DuplicateProviderReview,
  DuplicateProviderReviewCard,
  DuplicateProviderReviewGroup,
} from "@/lib/catalogue/duplicate-provider-review";
import {
  catalogueGapRecommendations,
  type CatalogueGapRecommendation,
} from "@/lib/jobs/catalogue-gap-report";
import { priceSourceLabel } from "@/lib/pricing/market-context";

type ToastTone = "error" | "success" | "warning";

export type OperationsScreenProps = {
  refreshAppData: (options?: { quiet?: boolean }) => Promise<boolean>;
  showToast: (message: string, tone?: ToastTone) => void;
};

type JobType =
  | "billing_checkout_retirement"
  | "password_reset_delivery"
  | "price_alerts"
  | "card_image_repair"
  | "catalogue_refresh"
  | "pricing_refresh"
  | "sealed_image_repair"
  | "sealed_pricing_refresh"
  | "variant_metadata_repair";
type OperationsJobKind =
  | "alerts"
  | "card-image-repair"
  | "catalogue"
  | "international-catalogue"
  | "pricing"
  | "sealed"
  | "sealed-image-repair"
  | "variant-metadata-repair";
type JobStatus = "running" | "succeeded" | "failed";
type ImportPreset = {
  expectedTotal: number;
  label: string;
  note: string;
  query: string;
  setNames: string[];
};

type JobRunRecord = {
  id: string;
  jobType: JobType;
  status: JobStatus;
  requestPayload: unknown;
  resultPayload: unknown;
  errorMessage?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
};

type JobApiResult = {
  cardsFetched?: number;
  cardImagesUpdated?: number;
  cardsUpdated?: number;
  candidatesChecked?: number;
  cardsUpserted?: number;
  canMerge?: boolean;
  collectionItemsMoved?: number;
  collectionItemsToMove?: number;
  complete?: boolean;
  duplicateCardDeleted?: boolean;
  dryRun?: boolean;
  duplicateCardCount?: number;
  duplicateCardId?: string;
  duplicateGroupCount?: number;
  duplicateCardWillBeDeleted?: boolean;
  error?: string;
  errors?: string[];
  groupsAvailable?: number;
  groupsMatched?: number;
  groupsProcessed?: number;
  groupsFetched?: number;
  imageFieldsUpdated?: number;
  job?: string;
  jobRun?: JobRunRecord;
  maxPages?: number;
  nextPage?: number | null;
  page?: number;
  pageSize?: number;
  priceOnlyUnpriced?: boolean;
  priceSnapshotsMoved?: number;
  priceSnapshotsToMove?: number;
  primaryCardId?: string;
  highRiskGroupCount?: number;
  lowRiskGroupCount?: number;
  pagesProcessed?: number;
  pricingSnapshotsCreated?: number;
  productsFetched?: number;
  query?: string;
  mediumRiskGroupCount?: number;
  mode?: string;
  report?: string;
  repairableCards?: number;
  repairableProducts?: number;
  sealedProductsSkipped?: number;
  sealedProductsUpdated?: number;
  sealedProductsUpserted?: number;
  setsUpserted?: number;
  tcgcsvProductsFetched?: number;
  tcgcsvImageProductsFetched?: number;
  totalCount?: number;
  pokemonTcgCardsFetched?: number;
  wishlistConflictsMerged?: number;
  wishlistConflictsToMerge?: number;
  wishlistItemsMoved?: number;
  wishlistItemsToMove?: number;
  writePrices?: boolean;
};

type PricingBySeriesGap = {
  cardCount: number;
  pricedCardCount: number;
  pricingCoveragePercent: number | null;
  series: string;
  unpricedCardCount: number;
};

type PricingBySourceSummary = {
  itemType: string;
  pricedItemCount: number;
  priceSnapshotCount: number;
  source: string;
};

type PricingByLanguageGap = {
  cardCount: number;
  cardImageCount: number;
  cardImageCoveragePercent: number | null;
  language: string;
  languageLabel: string;
  pricedCardCount: number;
  pricingCoveragePercent: number | null;
  region: string;
  regionLabel: string;
  setCount: number;
  unpricedCardCount: number;
};

type SealedPricingByProductTypeGap = {
  pricedSealedProductCount: number;
  productType: string;
  sealedPriceSnapshotCount: number;
  sealedPricingCoveragePercent: number | null;
  sealedProductCount: number;
  unpricedSealedProductCount: number;
};

type CatalogueStatusRecord = {
  cardCount: number;
  cardImageCount: number;
  cardImageCoveragePercent: number | null;
  cardMissingImageCount: number;
  cardMissingVariantMetadataCount: number;
  cardVariantMetadataCount: number;
  cardVariantMetadataCoveragePercent: number | null;
  coveragePercent: number | null;
  duplicateProviderIdCount: number;
  latestCatalogueResult: JobApiResult | null;
  latestPricingResult: JobApiResult | null;
  latestSealedPricingResult: JobApiResult | null;
  nextCataloguePage: number | null;
  priceSnapshotCount: number;
  pricedCardCount: number;
  pricedSealedProductCount: number;
  pricingByLanguage: PricingByLanguageGap[];
  pricingBySeries: PricingBySeriesGap[];
  pricingBySource: PricingBySourceSummary[];
  pricingCoveragePercent: number | null;
  providerTotalCount: number | null;
  sealedPricingByProductType: SealedPricingByProductTypeGap[];
  sealedPriceSnapshotCount: number;
  sealedImageCount: number;
  sealedImageCoveragePercent: number | null;
  sealedMissingImageCount: number;
  sealedPricingCoveragePercent: number | null;
  sealedProductCount: number;
  setCount: number;
};

type CatalogueStatusApiResult = {
  error?: string;
  latestCatalogueRun?: JobRunRecord | null;
  latestPricingRun?: JobRunRecord | null;
  latestSealedPricingRun?: JobRunRecord | null;
  status?: CatalogueStatusRecord;
};

type BetaEnvironmentSnapshot = {
  appUrl: string;
  authUrl: string;
  billingProvider: string;
  databaseConfigured: boolean;
  emailProvider: string;
  emailSmokeToConfigured: boolean;
  jobMonitorAlertToConfigured: boolean;
  jobMonitorDryRun: boolean;
  jobSecretConfigured: boolean;
  priceAlertAllowLiveRecipients: boolean;
  priceAlertDryRun: boolean;
  squareEnvironment: string;
};

type BetaLaunchCheck = {
  detail: string;
  label: string;
  level: "good" | "watch" | "action";
  passed: boolean;
};

type BetaStatusApiResult = {
  catalogue?: CatalogueStatusApiResult;
  env?: BetaEnvironmentSnapshot;
  error?: string;
  generatedAt?: string;
  jobRuns?: JobRunRecord[];
  launchChecks?: BetaLaunchCheck[];
};

type ResumeJob = {
  kind: "catalogue" | "pricing";
  nextPage: number;
  pageSize: number;
  query?: string;
};

const importPresets: ImportPreset[] = [
  {
    expectedTotal: 207,
    label: "151",
    note: "Scarlet & Violet special set",
    query: "set.id:sv3pt5",
    setNames: ["151"],
  },
  {
    expectedTotal: 237,
    label: "Evolving Skies",
    note: "Sword & Shield chase set",
    query: "set.id:swsh7",
    setNames: ["Evolving Skies"],
  },
  {
    expectedTotal: 160,
    label: "Crown Zenith",
    note: "Main Crown Zenith set",
    query: "set.id:swsh12pt5",
    setNames: ["Crown Zenith"],
  },
  {
    expectedTotal: 70,
    label: "Crown Zenith GG",
    note: "Galarian Gallery subset",
    query: "set.id:swsh12pt5gg",
    setNames: ["Crown Zenith Galarian Gallery"],
  },
];

function BetaStatusPanel({
  error,
  isLoading,
  onRefresh,
  status,
}: {
  error: string;
  isLoading: boolean;
  onRefresh: () => void;
  status: BetaStatusApiResult | null;
}) {
  const checks = status?.launchChecks ?? [];
  const actionCount = checks.filter((check) => check.level === "action").length;
  const watchCount = checks.filter((check) => check.level === "watch").length;
  const catalogue = status?.catalogue?.status;
  const jobRuns = status?.jobRuns ?? [];
  const env = status?.env;

  return (
    <section className="tool-panel beta-status-panel">
      <div className="panel-title-row">
        <div>
          <h2>Beta status</h2>
          <p className="muted">
            {status?.generatedAt ? `Updated ${formatEventDate(status.generatedAt)}` : "Live admin readiness snapshot"}
          </p>
        </div>
        <div className="actions">
          <span className={actionCount ? "tag red" : watchCount ? "tag amber" : "tag green"}>
            {actionCount ? `${actionCount} action` : watchCount ? `${watchCount} watch` : "Ready"}
          </span>
          <button className="button small" type="button" onClick={onRefresh} disabled={isLoading}>
            <RefreshCw size={15} />
            {isLoading ? "Loading" : "Refresh"}
          </button>
        </div>
      </div>
      {error ? <p className="form-note danger">{error}</p> : null}
      {status ? (
        <>
          <div className="beta-status-grid">
            <span>
              <b>{formatCount(catalogue?.cardCount)}</b>
              Cards
            </span>
            <span>
              <b>{formatPercent(catalogue?.pricingCoveragePercent)}</b>
              Card pricing
            </span>
            <span>
              <b>{formatPercent(catalogue?.sealedPricingCoveragePercent)}</b>
              Sealed pricing
            </span>
            <span>
              <b>{env?.squareEnvironment ?? "unknown"}</b>
              Square
            </span>
          </div>
          <div className="beta-check-list">
            {checks.map((check) => (
              <article className="beta-check-row" key={check.label}>
                <span className={`beta-check-icon ${check.level}`}>
                  {check.level === "good" ? <Check size={15} /> : <Info size={15} />}
                </span>
                <div>
                  <strong>{check.label}</strong>
                  <p className="muted">{check.detail}</p>
                </div>
                <span className={`tag ${betaCheckTagClass(check.level)}`}>
                  {check.level}
                </span>
              </article>
            ))}
          </div>
          {env ? (
            <div className="beta-env-row">
              <span>{env.databaseConfigured ? "Database configured" : "Database missing"}</span>
              <span>{env.jobSecretConfigured ? "Jobs protected" : "Job secret missing"}</span>
              <span>{env.priceAlertDryRun ? "Alerts dry run" : "Alerts live"}</span>
              <span>
                {!env.jobMonitorDryRun && env.jobMonitorAlertToConfigured
                  ? "Monitor alerts live"
                  : "Monitor alerts not live"}
              </span>
              <span>{env.emailSmokeToConfigured ? "Smoke recipient set" : "No smoke recipient"}</span>
            </div>
          ) : null}
          {jobRuns.length ? (
            <div className="beta-job-strip">
              {jobRuns.slice(0, 4).map((run) => (
                <span key={run.id}>
                  <b className={`tag ${jobStatusClass(run.status)}`}>{run.status}</b>
                  {jobTypeLabel(run.jobType)}
                </span>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <p className="muted">{isLoading ? "Loading beta readiness." : "Refresh to load beta readiness."}</p>
      )}
    </section>
  );
}

export function OperationsScreen({
  refreshAppData,
  showToast,
}: OperationsScreenProps) {
  const [jobSecret, setJobSecret] = useState("");
  const [query, setQuery] = useState("set.id:sv3pt5");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [maxPages, setMaxPages] = useState(1);
  const [cardPriceOnlyUnpriced, setCardPriceOnlyUnpriced] = useState(true);
  const [sealedGroupIds, setSealedGroupIds] = useState("");
  const [sealedGroupLimit, setSealedGroupLimit] = useState(10);
  const [sealedPriceOnlyUnpriced, setSealedPriceOnlyUnpriced] = useState(true);
  const [sealedUsdToGbpRate, setSealedUsdToGbpRate] = useState("");
  const [internationalLanguage, setInternationalLanguage] = useState("zh-cn");
  const [internationalPage, setInternationalPage] = useState(1);
  const [internationalPageSize, setInternationalPageSize] = useState(250);
  const [internationalMaxPages, setInternationalMaxPages] = useState(2);
  const [mergePrimaryCardId, setMergePrimaryCardId] = useState("");
  const [mergeDuplicateCardId, setMergeDuplicateCardId] = useState("");
  const [betaStatus, setBetaStatus] = useState<BetaStatusApiResult | null>(null);
  const [betaStatusError, setBetaStatusError] = useState("");
  const [jobRuns, setJobRuns] = useState<JobRunRecord[]>([]);
  const [catalogueStatus, setCatalogueStatus] = useState<CatalogueStatusRecord | null>(null);
  const [lastResult, setLastResult] = useState<unknown>(null);
  const [isBusy, setIsBusy] = useState("");
  const latestJobResult = parseJobApiResult(lastResult);
  const duplicateProviderReview = parseDuplicateProviderReview(lastResult);
  const resumableJob = getResumeJob(latestJobResult);
  const gapRecommendations = catalogueStatus ? catalogueGapRecommendations(catalogueStatus) : [];
  const presetRows = importPresets.map((preset) => ({
    ...preset,
    pageSize: Math.min(250, preset.expectedTotal),
  }));

  const loadBetaStatus = useCallback(
    async (options?: { quiet?: boolean }) => {
      if (!options?.quiet) {
        setIsBusy("beta-status");
      }

      try {
        const response = await fetch("/api/admin/beta-status", { cache: "no-store" });
        const body = (await response.json()) as BetaStatusApiResult;

        if (!response.ok) {
          throw new Error(body.error ?? `Beta status failed with ${response.status}`);
        }

        setBetaStatus(body);
        setBetaStatusError("");

        if (body.catalogue?.status) {
          setCatalogueStatus(body.catalogue.status);
        }

        if (body.jobRuns?.length) {
          setJobRuns(body.jobRuns);
        }

        if (!options?.quiet) {
          showToast("Beta status loaded.");
        }

        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to load beta status.";

        console.warn("Unable to load beta status.", error);
        setBetaStatusError(message);

        if (!options?.quiet) {
          showToast(message, "error");
        }

        return false;
      } finally {
        if (!options?.quiet) {
          setIsBusy("");
        }
      }
    },
    [showToast],
  );

  useEffect(() => {
    void loadBetaStatus({ quiet: true });
  }, [loadBetaStatus]);

  async function loadJobRuns() {
    setIsBusy("runs");
    try {
      const response = await fetch("/api/jobs/runs?limit=10", {
        headers: jobHeaders(jobSecret),
      });
      const body = (await response.json()) as { error?: string; runs?: JobRunRecord[] };

      if (!response.ok) {
        throw new Error(body.error ?? `Job runs failed with ${response.status}`);
      }

      setJobRuns(body.runs ?? []);
      void loadCatalogueStatus({ quiet: true });
      showToast("Job runs loaded.");
      return true;
    } catch (error) {
      console.warn("Unable to load job runs.", error);
      showToast(error instanceof Error ? error.message : "Unable to load job runs.", "error");
      return false;
    } finally {
      setIsBusy("");
    }
  }

  async function loadCatalogueStatus(options?: { quiet?: boolean }) {
    if (!options?.quiet) {
      setIsBusy("status");
    }

    try {
      const response = await fetch("/api/jobs/catalogue-status", {
        headers: jobHeaders(jobSecret),
      });
      const body = (await response.json()) as CatalogueStatusApiResult;

      if (!response.ok || !body.status) {
        throw new Error(body.error ?? `Catalogue status failed with ${response.status}`);
      }

      setCatalogueStatus(body.status);
      setJobRuns((current) =>
        [
          body.latestCatalogueRun,
          body.latestPricingRun,
          body.latestSealedPricingRun,
          ...current,
        ]
          .filter((run): run is JobRunRecord => Boolean(run))
          .filter((run, index, runs) => runs.findIndex((entry) => entry.id === run.id) === index)
          .slice(0, 10),
      );

      if (!options?.quiet) {
        showToast("Catalogue status loaded.");
      }

      return true;
    } catch (error) {
      console.warn("Unable to load catalogue status.", error);
      if (!options?.quiet) {
        showToast(error instanceof Error ? error.message : "Unable to load catalogue status.", "error");
      }
      return false;
    } finally {
      if (!options?.quiet) {
        setIsBusy("");
      }
    }
  }

  function applyPreset(preset: ImportPreset) {
    setQuery(preset.query);
    setPage(1);
    setPageSize(Math.min(250, preset.expectedTotal));
    setMaxPages(1);
  }

  function prepareDuplicateMerge(primaryCardId: string, duplicateCardId: string) {
    setMergePrimaryCardId(primaryCardId);
    setMergeDuplicateCardId(duplicateCardId);
    showToast("Duplicate merge prepared.");
  }

  async function runPresetJob(preset: ImportPreset, kind: "catalogue" | "pricing") {
    applyPreset(preset);
    await runJob(kind, {
      maxPages: 1,
      page: 1,
      pageSize: Math.min(250, preset.expectedTotal),
      q: preset.query,
    });
  }

  async function resumeLatestJob() {
    if (!resumableJob) {
      return;
    }

    setQuery(resumableJob.query ?? "");
    setPage(resumableJob.nextPage);
    setPageSize(resumableJob.pageSize);
    await runJob(resumableJob.kind, {
      maxPages,
      page: resumableJob.nextPage,
      pageSize: resumableJob.pageSize,
      q: resumableJob.query,
    });
  }

  async function runGapRecommendation(recommendation: CatalogueGapRecommendation) {
    if (recommendation.type === "catalogue_resume" && catalogueStatus?.nextCataloguePage) {
      setQuery("");
      setPage(catalogueStatus.nextCataloguePage);
      setPageSize(250);
      await runJob("catalogue", {
        maxPages,
        page: catalogueStatus.nextCataloguePage,
        pageSize: 250,
        q: "",
      });
      return;
    }

    if (recommendation.type === "card_pricing") {
      setQuery("");
      setPage(1);
      setPageSize(250);
      await runJob("pricing", {
        maxPages,
        page: 1,
        pageSize: 250,
        q: "",
      });
      return;
    }

    if (recommendation.type === "sealed_pricing") {
      await runJob("sealed");
      return;
    }

    if (recommendation.type === "duplicate_review") {
      await loadDuplicateProviderReview();
      return;
    }

    if (recommendation.type === "card_image_refresh") {
      await runJob("card-image-repair");
      return;
    }

    if (recommendation.type === "sealed_image_refresh") {
      await runJob("sealed-image-repair");
      return;
    }

    if (recommendation.type === "variant_metadata_refresh") {
      await runJob("variant-metadata-repair");
    }
  }

  async function runJob(
    kind: OperationsJobKind,
    override?: { maxPages?: number; page?: number; pageSize?: number; q?: string },
  ) {
    const path =
      kind === "catalogue"
        ? "/api/jobs/catalogue-refresh"
        : kind === "international-catalogue"
          ? "/api/jobs/international-catalogue-refresh"
        : kind === "pricing"
          ? "/api/jobs/pricing-refresh"
          : kind === "sealed"
            ? "/api/jobs/sealed-pricing-refresh"
            : kind === "card-image-repair"
              ? "/api/jobs/card-image-repair"
              : kind === "sealed-image-repair"
                ? "/api/jobs/sealed-image-repair"
                : kind === "variant-metadata-repair"
                  ? "/api/jobs/variant-metadata-repair"
                  : "/api/jobs/price-alerts";
    const body =
      kind === "alerts"
        ? { dryRun: true }
        : kind === "international-catalogue"
          ? internationalCatalogueJobBody()
        : kind === "sealed"
          ? sealedJobBody()
          : kind === "card-image-repair"
            ? { dryRun: false, limit: 500 }
            : kind === "sealed-image-repair"
              ? { dryRun: false, limit: 500, waitMs: 120 }
              : kind === "variant-metadata-repair"
                ? { dryRun: false, limit: 500, waitMs: 120 }
                : {
                  maxPages: override?.maxPages ?? maxPages,
                  page: override?.page ?? page,
                  pageSize: override?.pageSize ?? pageSize,
                  priceOnlyUnpriced: kind === "pricing" ? cardPriceOnlyUnpriced : undefined,
                  q: override?.q?.trim() || query.trim() || undefined,
                };

    setIsBusy(kind);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: {
          ...jobHeaders(jobSecret),
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as { error?: string; jobRun?: JobRunRecord };

      if (!response.ok) {
        setLastResult(result);
        setJobRuns((current) => (result.jobRun ? [result.jobRun, ...current].slice(0, 10) : current));
        throw new Error(result.error ?? `Job failed with ${response.status}`);
      }

      setLastResult(result);
      setJobRuns((current) => (result.jobRun ? [result.jobRun, ...current].slice(0, 10) : current));
      showToast("Job completed.");

      if (kind !== "alerts") {
        await refreshAppData({ quiet: true });
        void loadCatalogueStatus({ quiet: true });
      }
      return true;
    } catch (error) {
      console.warn("Unable to run job.", error);
      showToast(error instanceof Error ? error.message : "Unable to run job.", "error");
      if (error instanceof Error) {
        setLastResult({ error: error.message });
      }
      return false;
    } finally {
      setIsBusy("");
    }
  }

  function sealedJobBody() {
    const rate = Number(sealedUsdToGbpRate);

    return {
      groupIds: sealedGroupIds.trim() || undefined,
      groupLimit: sealedGroupLimit,
      priceOnlyUnpriced: sealedPriceOnlyUnpriced,
      usdToGbpRate: Number.isFinite(rate) && rate > 0 ? rate : undefined,
      writePrices: true,
    };
  }

  function internationalCatalogueJobBody() {
    return {
      language: internationalLanguage,
      maxPages: internationalMaxPages,
      page: internationalPage,
      pageSize: internationalPageSize,
    };
  }

  async function exportCatalogueGaps() {
    setIsBusy("gap-export");
    try {
      const response = await fetch("/api/jobs/catalogue-gaps", {
        headers: jobHeaders(jobSecret),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };

        throw new Error(body.error ?? `Catalogue gap export failed with ${response.status}`);
      }

      downloadBlob(`mintbinder-catalogue-gaps-${dateStamp()}.json`, await response.blob());
      showToast("Catalogue gap report downloaded.");
      return true;
    } catch (error) {
      console.warn("Unable to export catalogue gaps.", error);
      showToast(error instanceof Error ? error.message : "Unable to export catalogue gaps.", "error");
      return false;
    } finally {
      setIsBusy("");
    }
  }

  async function loadDuplicateProviderReview() {
    setIsBusy("duplicate-review");
    try {
      const response = await fetch("/api/jobs/duplicate-provider-review?limit=50", {
        headers: jobHeaders(jobSecret),
      });
      const result = (await response.json()) as JobApiResult & { error?: string };

      if (!response.ok) {
        throw new Error(result.error ?? `Duplicate review failed with ${response.status}`);
      }

      setLastResult(result);
      showToast("Duplicate provider review loaded.");
      return true;
    } catch (error) {
      console.warn("Unable to review duplicate provider IDs.", error);
      showToast(error instanceof Error ? error.message : "Unable to review duplicate provider IDs.", "error");
      if (error instanceof Error) {
        setLastResult({ error: error.message });
      }
      return false;
    } finally {
      setIsBusy("");
    }
  }

  async function runDuplicateCardMerge(execute: boolean) {
    if (!mergePrimaryCardId.trim() || !mergeDuplicateCardId.trim()) {
      showToast("Both card IDs are required.", "error");
      return false;
    }

    setIsBusy(execute ? "duplicate-merge" : "duplicate-merge-dry-run");
    try {
      const response = await fetch("/api/jobs/duplicate-card-merge", {
        body: JSON.stringify({
          duplicateCardId: mergeDuplicateCardId.trim(),
          execute,
          primaryCardId: mergePrimaryCardId.trim(),
        }),
        headers: {
          ...jobHeaders(jobSecret),
          "content-type": "application/json",
        },
        method: "POST",
      });
      const result = (await response.json()) as JobApiResult & { error?: string };

      if (!response.ok) {
        throw new Error(result.error ?? `Duplicate merge failed with ${response.status}`);
      }

      setLastResult(result);
      showToast(execute ? "Duplicate card merged." : "Duplicate merge dry run ready.");

      if (execute) {
        void loadCatalogueStatus({ quiet: true });
        void refreshAppData();
      }

      return true;
    } catch (error) {
      console.warn("Unable to merge duplicate card.", error);
      showToast(error instanceof Error ? error.message : "Unable to merge duplicate card.", "error");
      if (error instanceof Error) {
        setLastResult({ error: error.message });
      }
      return false;
    } finally {
      setIsBusy("");
    }
  }

  return (
    <section className="page">
      <PageHeader title="Operations" action={<span className="status-pill"><TerminalSquare size={17} />Jobs</span>} />
      <BetaStatusPanel
        error={betaStatusError}
        isLoading={isBusy === "beta-status" && !betaStatus}
        status={betaStatus}
        onRefresh={() => void loadBetaStatus()}
      />
      <div className="stats-grid compact">
        <StatCard
          label="Catalogue cards"
          value={formatCount(catalogueStatus?.cardCount)}
          note={
            catalogueStatus?.providerTotalCount
              ? `${formatPercent(catalogueStatus.coveragePercent)} of provider`
              : "Load live status"
          }
        />
        <StatCard label="Provider total" value={formatCount(catalogueStatus?.providerTotalCount)} note="Pokemon TCG API" />
        <StatCard label="Next page" value={catalogueStatus?.nextCataloguePage?.toString() ?? "-"} note="Broad import resume point" />
        <StatCard label="Pages/job" value={maxPages.toString()} note="Capped at 20 for safety" />
        <StatCard label="Access" value="Admin session" note={jobSecret ? "Secret fallback active" : "No secret entry needed"} />
      </div>

      <div className="dashboard-grid">
        <section className="tool-panel">
          <div className="panel-title-row">
            <h2>Import presets</h2>
            <Layers3 size={18} />
          </div>
          <div className="preset-grid">
            {presetRows.map((preset) => {
              return (
                <article className="preset-card" key={preset.query}>
                  <div className="preset-card-header">
                    <div>
                      <strong>{preset.label}</strong>
                      <span>{preset.note}</span>
                    </div>
                    <span className="tag blue">Preset</span>
                  </div>
                  <div className="set-stat-row">
                    <span>Up to {preset.expectedTotal} cards</span>
                    <span>{preset.query}</span>
                  </div>
                  <div className="actions">
                    <button className="button small" disabled={Boolean(isBusy)} onClick={() => applyPreset(preset)}>
                      <Check size={15} />
                      Use
                    </button>
                    <button className="button small primary" disabled={Boolean(isBusy)} onClick={() => void runPresetJob(preset, "catalogue")}>
                      <Database size={15} />
                      Catalogue
                    </button>
                    <button className="button small" disabled={Boolean(isBusy)} onClick={() => void runPresetJob(preset, "pricing")}>
                      <RefreshCw size={15} />
                      Pricing
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="tool-panel">
          <div className="panel-title-row">
            <h2>Import controls</h2>
            <Database size={18} />
          </div>
          <div className="field-grid">
            <Field label="Job secret fallback">
              <input
                type="password"
                value={jobSecret}
                onChange={(event) => setJobSecret(event.currentTarget.value)}
                placeholder="Optional for scripts"
              />
            </Field>
            <Field label="Pokemon query">
              <input
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="set.id:sv3pt5"
              />
            </Field>
            <Field label="Page">
              <input
                min={1}
                type="number"
                value={page}
                onChange={(event) => setPage(Math.max(1, Number(event.currentTarget.value) || 1))}
              />
            </Field>
            <Field label="Page size">
              <input
                max={250}
                min={1}
                type="number"
                value={pageSize}
                onChange={(event) => setPageSize(Math.min(250, Math.max(1, Number(event.currentTarget.value) || 1)))}
              />
            </Field>
            <Field label="Max pages">
              <input
                max={20}
                min={1}
                type="number"
                value={maxPages}
                onChange={(event) => setMaxPages(Math.min(20, Math.max(1, Number(event.currentTarget.value) || 1)))}
              />
            </Field>
            <label className="check-row">
              <input
                checked={cardPriceOnlyUnpriced}
                type="checkbox"
                onChange={(event) => setCardPriceOnlyUnpriced(event.currentTarget.checked)}
              />
              <span>Only unpriced cards</span>
            </label>
          </div>
          <div className="ops-subsection">
            <div className="panel-title-row">
              <h3>Sealed pricing</h3>
              <PackagePlus size={17} />
            </div>
            <div className="field-grid">
              <Field label="TCGCSV groups">
                <input
                  value={sealedGroupIds}
                  onChange={(event) => setSealedGroupIds(event.currentTarget.value)}
                  placeholder="Optional IDs"
                />
              </Field>
              <Field label="Group limit">
                <input
                  min={1}
                  type="number"
                  value={sealedGroupLimit}
                  onChange={(event) => setSealedGroupLimit(Math.max(1, Number(event.currentTarget.value) || 1))}
                />
              </Field>
              <Field label="USD to GBP">
                <input
                  inputMode="decimal"
                  value={sealedUsdToGbpRate}
                  onChange={(event) => setSealedUsdToGbpRate(event.currentTarget.value)}
                  placeholder="Env fallback"
                />
              </Field>
              <label className="check-row">
                <input
                  checked={sealedPriceOnlyUnpriced}
                  type="checkbox"
                  onChange={(event) => setSealedPriceOnlyUnpriced(event.currentTarget.checked)}
                />
                <span>Only unpriced</span>
              </label>
            </div>
          </div>
          <div className="ops-subsection">
            <div className="panel-title-row">
              <h3>International catalogue</h3>
              <Languages size={17} />
            </div>
            <div className="field-grid">
              <Field label="Language">
                <select
                  value={internationalLanguage}
                  onChange={(event) => {
                    setInternationalLanguage(event.currentTarget.value);
                    setInternationalPage(1);
                  }}
                >
                  {CATALOGUE_LANGUAGE_OPTIONS
                    .filter((language) => language.code !== "en")
                    .map((language) => (
                      <option key={language.code} value={language.code}>
                        {language.label}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Page">
                <input
                  min={1}
                  type="number"
                  value={internationalPage}
                  onChange={(event) => setInternationalPage(Math.max(1, Number(event.currentTarget.value) || 1))}
                />
              </Field>
              <Field label="Page size">
                <input
                  max={250}
                  min={1}
                  type="number"
                  value={internationalPageSize}
                  onChange={(event) =>
                    setInternationalPageSize(Math.min(250, Math.max(1, Number(event.currentTarget.value) || 1)))}
                />
              </Field>
              <Field label="Max pages">
                <input
                  max={20}
                  min={1}
                  type="number"
                  value={internationalMaxPages}
                  onChange={(event) =>
                    setInternationalMaxPages(Math.min(20, Math.max(1, Number(event.currentTarget.value) || 1)))}
                />
              </Field>
            </div>
          </div>
          <div className="actions">
            <button className="button primary" disabled={Boolean(isBusy)} onClick={() => void runJob("catalogue")}>
              <Database size={17} />
              {isBusy === "catalogue" ? "Running" : "Catalogue"}
            </button>
            <button className="button" disabled={Boolean(isBusy)} onClick={() => void runJob("international-catalogue")}>
              <Languages size={17} />
              {isBusy === "international-catalogue" ? "Running" : "International"}
            </button>
            <button className="button" disabled={Boolean(isBusy)} onClick={() => void runJob("pricing")}>
              <RefreshCw size={17} />
              {isBusy === "pricing" ? "Running" : "Pricing"}
            </button>
            <button className="button" disabled={Boolean(isBusy)} onClick={() => void runJob("sealed")}>
              <PackagePlus size={17} />
              {isBusy === "sealed" ? "Running" : "Sealed pricing"}
            </button>
            <button className="button" disabled={Boolean(isBusy)} onClick={() => void runJob("card-image-repair")}>
              <GalleryVerticalEnd size={17} />
              {isBusy === "card-image-repair" ? "Running" : "Repair card images"}
            </button>
            <button className="button" disabled={Boolean(isBusy)} onClick={() => void runJob("sealed-image-repair")}>
              <GalleryVerticalEnd size={17} />
              {isBusy === "sealed-image-repair" ? "Running" : "Repair sealed images"}
            </button>
            <button className="button" disabled={Boolean(isBusy)} onClick={() => void runJob("variant-metadata-repair")}>
              <Layers3 size={17} />
              {isBusy === "variant-metadata-repair" ? "Running" : "Repair variants"}
            </button>
            <button className="button" disabled={Boolean(isBusy)} onClick={() => void runJob("alerts")}>
              <Mail size={17} />
              {isBusy === "alerts" ? "Running" : "Alert dry run"}
            </button>
            <button className="button" disabled={Boolean(isBusy)} onClick={() => void loadJobRuns()}>
              <History size={17} />
              {isBusy === "runs" ? "Loading" : "Load runs"}
            </button>
          </div>
        </section>

        <section className="tool-panel">
          <div className="panel-title-row">
            <h2>Catalogue status</h2>
            <Database size={18} />
          </div>
          <p className="muted">Catalogue-wide import coverage. Your owned collection value gaps are tracked separately on Dashboard and Collection.</p>
          {catalogueStatus?.coveragePercent !== null && catalogueStatus?.coveragePercent !== undefined ? (
            <ProgressBar value={catalogueStatus.coveragePercent} />
          ) : null}
          <MetricList
            rows={[
              ["Cards", catalogueStatus ? `${formatCount(catalogueStatus.cardCount)} / ${formatCount(catalogueStatus.providerTotalCount)}` : "-"],
              ["Coverage", formatPercent(catalogueStatus?.coveragePercent)],
              ["Sets", formatCount(catalogueStatus?.setCount)],
              ["Prices", formatCount(catalogueStatus?.priceSnapshotCount)],
              ["Priced cards", catalogueStatus ? `${formatCount(catalogueStatus.pricedCardCount)} (${formatPercent(catalogueStatus.pricingCoveragePercent)})` : "-"],
              ["Card images", catalogueStatus ? `${formatCount(catalogueStatus.cardImageCount)} (${formatPercent(catalogueStatus.cardImageCoveragePercent)})` : "-"],
              ["Variant metadata", catalogueStatus ? `${formatCount(catalogueStatus.cardVariantMetadataCount)} (${formatPercent(catalogueStatus.cardVariantMetadataCoveragePercent)})` : "-"],
              ["Sealed products", formatCount(catalogueStatus?.sealedProductCount)],
              ["Priced sealed", catalogueStatus ? `${formatCount(catalogueStatus.pricedSealedProductCount)} (${formatPercent(catalogueStatus.sealedPricingCoveragePercent)})` : "-"],
              ["Sealed images", catalogueStatus ? `${formatCount(catalogueStatus.sealedImageCount)} (${formatPercent(catalogueStatus.sealedImageCoveragePercent)})` : "-"],
              ["Duplicate IDs", formatCount(catalogueStatus?.duplicateProviderIdCount)],
            ]}
          />
          <button className="button" disabled={Boolean(isBusy)} onClick={() => void loadCatalogueStatus()}>
            <RefreshCw size={17} />
            {isBusy === "status" ? "Loading" : "Load status"}
          </button>
          <button className="button" disabled={Boolean(isBusy)} onClick={() => void exportCatalogueGaps()}>
            <Download size={17} />
            {isBusy === "gap-export" ? "Exporting" : "Export gaps"}
          </button>
          <button className="button" disabled={Boolean(isBusy)} onClick={() => void loadDuplicateProviderReview()}>
            <Search size={17} />
            {isBusy === "duplicate-review" ? "Loading" : "Review duplicates"}
          </button>
        </section>

        <section className="tool-panel">
          <div className="panel-title-row">
            <h2>Merge duplicate</h2>
            <ArrowDownUp size={18} />
          </div>
          <div className="field-grid">
            <Field label="Primary card ID">
              <input
                value={mergePrimaryCardId}
                onChange={(event) => setMergePrimaryCardId(event.currentTarget.value)}
                placeholder="Keep this card"
              />
            </Field>
            <Field label="Duplicate card ID">
              <input
                value={mergeDuplicateCardId}
                onChange={(event) => setMergeDuplicateCardId(event.currentTarget.value)}
                placeholder="Merge and delete this card"
              />
            </Field>
          </div>
          <div className="actions">
            <button className="button" disabled={Boolean(isBusy)} onClick={() => void runDuplicateCardMerge(false)}>
              <Search size={17} />
              {isBusy === "duplicate-merge-dry-run" ? "Checking" : "Dry run"}
            </button>
            <button className="button danger" disabled={Boolean(isBusy)} onClick={() => void runDuplicateCardMerge(true)}>
              <Check size={17} />
              {isBusy === "duplicate-merge" ? "Merging" : "Execute merge"}
            </button>
          </div>
        </section>

        <section className="tool-panel">
          <div className="panel-title-row">
            <h2>Latest result</h2>
            <span className="tag blue">JSON</span>
          </div>
          {latestJobResult ? (
            <div className="job-result-summary">
              <div className="set-stat-row">
                {latestJobResult.report === "duplicate_provider_review" ? (
                  <>
                    <span>{latestJobResult.duplicateGroupCount ?? 0} groups</span>
                    <span>{latestJobResult.duplicateCardCount ?? 0} cards</span>
                    <span>{latestJobResult.highRiskGroupCount ?? 0} high risk</span>
                  </>
                ) : latestJobResult.report === "duplicate_card_merge" ? (
                  <>
                    <span>{latestJobResult.canMerge ? "Mergeable" : "Blocked"}</span>
                    <span>{latestJobResult.collectionItemsToMove ?? latestJobResult.collectionItemsMoved ?? 0} collection</span>
                    <span>{latestJobResult.priceSnapshotsToMove ?? latestJobResult.priceSnapshotsMoved ?? 0} prices</span>
                  </>
                ) : latestJobResult.job === "card_image_repair" ? (
                  <>
                    <span>{latestJobResult.candidatesChecked ?? 0} checked</span>
                    <span>{latestJobResult.cardsUpdated ?? 0} cards</span>
                    <span>{latestJobResult.imageFieldsUpdated ?? 0} fields</span>
                  </>
                ) : latestJobResult.job === "sealed_image_repair" ? (
                  <>
                    <span>{latestJobResult.candidatesChecked ?? 0} checked</span>
                    <span>{latestJobResult.sealedProductsUpdated ?? 0} sealed</span>
                    <span>{latestJobResult.groupsFetched ?? 0} groups</span>
                  </>
                ) : latestJobResult.job === "variant_metadata_repair" ? (
                  <>
                    <span>{latestJobResult.candidatesChecked ?? 0} checked</span>
                    <span>{latestJobResult.cardsUpdated ?? 0} cards</span>
                    <span>{latestJobResult.pokemonTcgCardsFetched ?? 0} fetched</span>
                  </>
                ) : latestJobResult.groupsProcessed !== undefined ? (
                  <>
                    <span>{latestJobResult.groupsProcessed} groups</span>
                    <span>{latestJobResult.sealedProductsUpserted ?? 0} sealed</span>
                    <span>{latestJobResult.cardImagesUpdated ?? 0} images</span>
                    <span>{latestJobResult.productsFetched ?? 0} products</span>
                  </>
                ) : (
                  <>
                    <span>{latestJobResult.pagesProcessed ?? 1} page{(latestJobResult.pagesProcessed ?? 1) === 1 ? "" : "s"}</span>
                    <span>{latestJobResult.cardsUpserted ?? 0} cards</span>
                  </>
                )}
                {latestJobResult.report === "duplicate_provider_review" ? (
                  <span>{latestJobResult.mediumRiskGroupCount ?? 0} medium</span>
                ) : latestJobResult.report === "duplicate_card_merge" ? (
                  <>
                    <span>{latestJobResult.wishlistItemsToMove ?? latestJobResult.wishlistItemsMoved ?? 0} wishlist</span>
                    <span>{latestJobResult.wishlistConflictsToMerge ?? latestJobResult.wishlistConflictsMerged ?? 0} conflicts</span>
                    <span>{latestJobResult.mode ?? "dry_run"}</span>
                  </>
                ) : latestJobResult.job === "card_image_repair" ? (
                  <>
                    <span>{latestJobResult.repairableCards ?? 0} repairable</span>
                    <span>{latestJobResult.tcgcsvImageProductsFetched ?? 0} TCGCSV images</span>
                  </>
                ) : latestJobResult.job === "sealed_image_repair" ? (
                  <span>{latestJobResult.repairableProducts ?? 0} repairable</span>
                ) : latestJobResult.job === "variant_metadata_repair" ? (
                  <span>{latestJobResult.repairableCards ?? 0} repairable</span>
                ) : (
                  <span>{latestJobResult.pricingSnapshotsCreated ?? 0} prices</span>
                )}
                {latestJobResult.complete !== undefined ? (
                  <span>{latestJobResult.complete ? "Complete" : `Next page ${latestJobResult.nextPage ?? "-"}`}</span>
                ) : null}
              </div>
              {resumableJob ? (
                <button className="button primary" disabled={Boolean(isBusy)} onClick={() => void resumeLatestJob()}>
                  <RefreshCw size={17} />
                  Resume page {resumableJob.nextPage}
                </button>
              ) : null}
            </div>
          ) : null}
          <pre className="json-preview">{formatJsonPreview(lastResult ?? { status: "No job run yet." })}</pre>
        </section>
      </div>

      {duplicateProviderReview ? (
        <DuplicateProviderReviewPanel
          report={duplicateProviderReview}
          onPrepareMerge={prepareDuplicateMerge}
        />
      ) : null}

      <div className="operations-breakdowns">
        <CataloguePricingExplainer />
        <GapRecommendationsPanel
          disabled={Boolean(isBusy)}
          recommendations={gapRecommendations}
          onRun={(recommendation) => void runGapRecommendation(recommendation)}
        />
        <InternationalPricingGapPanel rows={catalogueStatus?.pricingByLanguage ?? []} />
        <PricingSeriesGapPanel rows={catalogueStatus?.pricingBySeries ?? []} />
        <SealedPricingGapPanel rows={catalogueStatus?.sealedPricingByProductType ?? []} />
        <CatalogueMediaGapPanel status={catalogueStatus} />
        <PricingSourcePanel rows={catalogueStatus?.pricingBySource ?? []} />
      </div>

      <section className="tool-panel">
        <div className="panel-title-row">
          <h2>Job runs</h2>
          <History size={18} />
        </div>
        {jobRuns.length ? (
          <div className="job-run-list">
            {jobRuns.map((run) => (
              <article className="job-run-row" key={run.id}>
                <div>
                  <div className="tag-row">
                    <span className={`tag ${jobStatusClass(run.status)}`}>{run.status}</span>
                    <span className="tag">{jobTypeLabel(run.jobType)}</span>
                  </div>
                  <strong>{formatEventDate(run.startedAt)}</strong>
                  <p className="muted">
                    {run.durationMs === undefined ? "In progress" : `${run.durationMs}ms`}
                    {run.errorMessage ? ` | ${run.errorMessage}` : ""}
                  </p>
                </div>
                <code>{run.id.slice(0, 8)}</code>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">No job runs loaded.</p>
        )}
      </section>
    </section>
  );
}

function CataloguePricingExplainer() {
  return (
    <section className="tool-panel pricing-explainer-panel">
      <div className="panel-title-row">
        <h2>Pricing gaps explained</h2>
        <Info size={18} />
      </div>
      <div className="pricing-explainer-grid">
        <article>
          <strong>Catalogue, not collection</strong>
          <span>These gaps are for every card printing Mint Binder knows about. They are separate from your owned cards, manual values, and Dashboard value gaps.</span>
        </article>
        <article>
          <strong>One imported snapshot counts</strong>
          <span>A card is priced when it has at least one imported market snapshot. Variant metadata, images, and manual owned values do not count as imported pricing.</span>
        </article>
        <article>
          <strong>Distinct printings only</strong>
          <span>Historical price snapshots do not multiply the totals. The percentage is distinct priced printings divided by distinct catalogue printings in that series.</span>
        </article>
      </div>
    </section>
  );
}

function GapRecommendationsPanel({
  disabled,
  onRun,
  recommendations,
}: {
  disabled: boolean;
  onRun: (recommendation: CatalogueGapRecommendation) => void;
  recommendations: CatalogueGapRecommendation[];
}) {
  return (
    <section className="tool-panel">
      <div className="panel-title-row">
        <h2>Recommended next</h2>
        <Sparkles size={18} />
      </div>
      {recommendations.length ? (
        <div className="gap-list">
          {recommendations.map((recommendation) => (
            <article className="gap-row recommendation-row" key={recommendation.id}>
              <div className="gap-copy">
                <div className="tag-row">
                  <span className={`tag ${recommendationPriorityClass(recommendation.priority)}`}>
                    {recommendation.priority}
                  </span>
                  <span className="tag">{recommendationTypeLabel(recommendation.type)}</span>
                </div>
                <strong>{recommendation.title}</strong>
                <span>{recommendation.detail}</span>
              </div>
              {recommendationActionLabel(recommendation) ? (
                <button className="button small" disabled={disabled} onClick={() => onRun(recommendation)}>
                  <RefreshCw size={15} />
                  {recommendationActionLabel(recommendation)}
                </button>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <p className="muted">Load catalogue status to see recommended next actions.</p>
      )}
    </section>
  );
}

function DuplicateProviderReviewPanel({
  onPrepareMerge,
  report,
}: {
  onPrepareMerge: (primaryCardId: string, duplicateCardId: string) => void;
  report: DuplicateProviderReview;
}) {
  return (
    <section className="tool-panel duplicate-review-panel">
      <div className="panel-title-row">
        <h2>Duplicate groups</h2>
        <span className="status-pill">{report.duplicateGroupCount} groups</span>
      </div>
      {report.groups.length ? (
        <div className="duplicate-group-list">
          {report.groups.slice(0, 12).map((group) => (
            <DuplicateProviderGroupReview
              group={group}
              key={group.providerId}
              onPrepareMerge={onPrepareMerge}
            />
          ))}
        </div>
      ) : (
        <p className="muted">No duplicate provider IDs in the latest report.</p>
      )}
    </section>
  );
}

function DuplicateProviderGroupReview({
  group,
  onPrepareMerge,
}: {
  group: DuplicateProviderReviewGroup;
  onPrepareMerge: (primaryCardId: string, duplicateCardId: string) => void;
}) {
  const primaryCardId = group.suggestedPrimaryCardId || group.cards[0]?.id || "";

  return (
    <article className="duplicate-group-row">
      <div className="duplicate-group-header">
        <div className="gap-copy">
          <div className="tag-row">
            <span className={`tag ${duplicateRiskClass(group.riskLevel)}`}>{group.riskLevel}</span>
            <span className="tag">{group.providerId}</span>
          </div>
          <strong>{group.cardCount} matching card rows</strong>
          <span>{group.collectionCount} collection | {group.wishlistCount} wishlist | {group.priceSnapshotCount} prices</span>
        </div>
      </div>
      <div className="duplicate-card-list">
        {group.cards.map((card) => (
          <DuplicateProviderCardReview
            card={card}
            isPrimary={card.id === primaryCardId}
            key={card.id}
            onPrepareMerge={onPrepareMerge}
            primaryCardId={primaryCardId}
          />
        ))}
      </div>
    </article>
  );
}

function DuplicateProviderCardReview({
  card,
  isPrimary,
  onPrepareMerge,
  primaryCardId,
}: {
  card: DuplicateProviderReviewCard;
  isPrimary: boolean;
  onPrepareMerge: (primaryCardId: string, duplicateCardId: string) => void;
  primaryCardId: string;
}) {
  const cardName = catalogueDisplayCardForText(card.name, { number: card.number }) ?? card.name;
  const setName = catalogueDisplaySetForText(card.setName) ?? card.setName;
  const imageUrl = card.imageSmallUrl ?? card.imageLargeUrl ?? null;
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const visibleImageUrl = imageUrl && imageUrl !== failedImageUrl ? imageUrl : null;

  return (
    <article className="duplicate-card-row">
      <div className="duplicate-card-thumb">
        {visibleImageUrl ? (
          <Image
            src={visibleImageUrl}
            alt={cardName}
            fill
            sizes="52px"
            unoptimized={!isOptimizableCatalogueImageUrl(visibleImageUrl)}
            onError={() => setFailedImageUrl(visibleImageUrl)}
          />
        ) : (
          <span>{cardName.slice(0, 1)}</span>
        )}
      </div>
      <div className="duplicate-card-copy">
        <div className="tag-row">
          {isPrimary ? <span className="tag green">primary</span> : <span className="tag">duplicate</span>}
          <span className="tag">{card.number}</span>
          {card.rarity ? <span className="tag blue">{card.rarity}</span> : null}
        </div>
        <strong>{cardName}</strong>
        <span>{setName}{card.series ? ` | ${card.series}` : ""}</span>
        <code>{card.id}</code>
      </div>
      <div className="duplicate-card-metrics">
        <span>{card.collectionCount} collection</span>
        <span>{card.wishlistCount} wishlist</span>
        <span>{card.priceSnapshotCount} prices</span>
      </div>
      {isPrimary ? (
        <span className="status-pill">Keep</span>
      ) : (
        <button
          className="button small"
          disabled={!primaryCardId}
          onClick={() => onPrepareMerge(primaryCardId, card.id)}
        >
          <ArrowDownUp size={15} />
          Prepare
        </button>
      )}
    </article>
  );
}

function InternationalPricingGapPanel({ rows }: { rows: PricingByLanguageGap[] }) {
  const visibleRows = rows
    .filter((row) => row.language !== "en" && row.cardCount > 0)
    .slice(0, 8);

  return (
    <section className="tool-panel">
      <div className="panel-title-row">
        <h2>International cards</h2>
        <Languages size={18} />
      </div>
      {visibleRows.length ? (
        <div className="gap-list">
          {visibleRows.map((row) => (
            <CoverageGapRow
              key={`${row.language}-${row.region}`}
              coverage={row.pricingCoveragePercent}
              gapLabel="unpriced printings"
              label={`${row.languageLabel} (${row.setCount} sets, ${formatPercent(row.cardImageCoveragePercent)} images)`}
              priced={row.pricedCardCount}
              total={row.cardCount}
              unpriced={row.unpricedCardCount}
            />
          ))}
        </div>
      ) : (
        <p className="muted">No international card rows loaded.</p>
      )}
    </section>
  );
}

function PricingSeriesGapPanel({ rows }: { rows: PricingBySeriesGap[] }) {
  const visibleRows = rows.filter((row) => row.unpricedCardCount > 0).slice(0, 8);

  return (
    <section className="tool-panel">
      <div className="panel-title-row">
        <h2>Card pricing gaps</h2>
        <BarChart3 size={18} />
      </div>
      <p className="muted">Distinct catalogue card printings without an imported price snapshot yet.</p>
      {visibleRows.length ? (
        <div className="gap-list">
          {visibleRows.map((row) => (
            <CoverageGapRow
              key={row.series}
              coverage={row.pricingCoveragePercent}
              gapLabel="unpriced printings"
              label={row.series}
              priced={row.pricedCardCount}
              total={row.cardCount}
              unpriced={row.unpricedCardCount}
            />
          ))}
        </div>
      ) : (
        <p className="muted">No card pricing gaps loaded.</p>
      )}
    </section>
  );
}

function SealedPricingGapPanel({ rows }: { rows: SealedPricingByProductTypeGap[] }) {
  const visibleRows = rows.filter((row) => row.unpricedSealedProductCount > 0).slice(0, 8);

  return (
    <section className="tool-panel">
      <div className="panel-title-row">
        <h2>Sealed gaps</h2>
        <PackagePlus size={18} />
      </div>
      {visibleRows.length ? (
        <div className="gap-list">
          {visibleRows.map((row) => (
            <CoverageGapRow
              key={row.productType}
              coverage={row.sealedPricingCoveragePercent}
              label={productTypeLabel(row.productType)}
              priced={row.pricedSealedProductCount}
              total={row.sealedProductCount}
              unpriced={row.unpricedSealedProductCount}
            />
          ))}
        </div>
      ) : (
        <p className="muted">No sealed pricing gaps loaded.</p>
      )}
    </section>
  );
}

function CatalogueMediaGapPanel({ status }: { status?: CatalogueStatusRecord | null }) {
  return (
    <section className="tool-panel">
      <div className="panel-title-row">
        <h2>Media & variants</h2>
        <GalleryVerticalEnd size={18} />
      </div>
      {status ? (
        <div className="gap-list">
          <CoverageGapRow
            coverage={status.cardImageCoveragePercent}
            gapLabel="missing images"
            label="Card images"
            priced={status.cardImageCount}
            total={status.cardCount}
            unpriced={status.cardMissingImageCount}
          />
          <CoverageGapRow
            coverage={status.sealedImageCoveragePercent}
            gapLabel="missing images"
            label="Sealed images"
            priced={status.sealedImageCount}
            total={status.sealedProductCount}
            unpriced={status.sealedMissingImageCount}
          />
          <CoverageGapRow
            coverage={status.cardVariantMetadataCoveragePercent}
            gapLabel="without metadata"
            label="Variant metadata"
            priced={status.cardVariantMetadataCount}
            total={status.cardCount}
            unpriced={status.cardMissingVariantMetadataCount}
          />
        </div>
      ) : (
        <p className="muted">No media coverage rows loaded.</p>
      )}
    </section>
  );
}

function PricingSourcePanel({ rows }: { rows: PricingBySourceSummary[] }) {
  return (
    <section className="tool-panel">
      <div className="panel-title-row">
        <h2>Price sources</h2>
        <Database size={18} />
      </div>
      {rows.length ? (
        <div className="gap-list">
          {rows.slice(0, 8).map((row) => (
            <article className="gap-row" key={`${row.source}-${row.itemType}`}>
              <div className="gap-copy">
                <strong>{priceSourceLabel(row.source)}</strong>
                <span>{itemTypeLabel(row.itemType)}</span>
              </div>
              <div className="gap-metrics">
                <span>{formatCount(row.priceSnapshotCount)} snapshots</span>
                <span>{formatCount(row.pricedItemCount)} items</span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="muted">No price source rows loaded.</p>
      )}
    </section>
  );
}

function CoverageGapRow({
  coverage,
  gapLabel = "unpriced",
  label,
  priced,
  total,
  unpriced,
}: {
  coverage: number | null;
  gapLabel?: string;
  label: string;
  priced: number;
  total: number;
  unpriced: number;
}) {
  return (
    <article className="gap-row">
      <div className="gap-copy">
        <strong>{label}</strong>
        <span>{formatCount(unpriced)} {gapLabel}</span>
      </div>
      <div className="gap-meter">
        <ProgressBar value={coverage ?? 0} />
        <span>
          {formatPercent(coverage)} | {formatCount(priced)} / {formatCount(total)}
        </span>
      </div>
    </article>
  );
}

function jobHeaders(secret: string): Record<string, string> {
  const token = secret.trim();

  return token ? { authorization: `Bearer ${token}` } : {};
}

function jobStatusClass(status: JobStatus) {
  if (status === "succeeded") {
    return "green";
  }

  if (status === "failed") {
    return "red";
  }

  return "blue";
}

function jobTypeLabel(type: JobType) {
  if (type === "billing_checkout_retirement") {
    return "Billing checkout retirement";
  }

  if (type === "password_reset_delivery") {
    return "Password reset delivery";
  }

  if (type === "catalogue_refresh") {
    return "Catalogue";
  }

  if (type === "card_image_repair") {
    return "Card images";
  }

  if (type === "pricing_refresh") {
    return "Pricing";
  }

  if (type === "sealed_image_repair") {
    return "Sealed images";
  }

  if (type === "sealed_pricing_refresh") {
    return "Sealed pricing";
  }

  if (type === "variant_metadata_repair") {
    return "Variants";
  }

  return "Price alerts";
}

function betaCheckTagClass(level: BetaLaunchCheck["level"]) {
  if (level === "good") {
    return "green";
  }

  if (level === "action") {
    return "red";
  }

  return "amber";
}

function recommendationActionLabel(recommendation: CatalogueGapRecommendation) {
  if (recommendation.type === "duplicate_review") {
    return "Review";
  }

  if (recommendation.type === "catalogue_resume") {
    return "Resume";
  }

  if (recommendation.type === "card_pricing") {
    return "Run pricing";
  }

  if (recommendation.type === "sealed_pricing") {
    return "Run sealed";
  }

  if (recommendation.type === "card_image_refresh") {
    return "Repair cards";
  }

  if (recommendation.type === "sealed_image_refresh") {
    return "Repair sealed";
  }

  if (recommendation.type === "variant_metadata_refresh") {
    return "Repair variants";
  }

  return "";
}

function recommendationPriorityClass(priority: CatalogueGapRecommendation["priority"]) {
  if (priority === "high") {
    return "red";
  }

  if (priority === "medium") {
    return "amber";
  }

  return "green";
}

function duplicateRiskClass(risk: DuplicateProviderReviewGroup["riskLevel"]) {
  if (risk === "high") {
    return "red";
  }

  if (risk === "medium") {
    return "amber";
  }

  return "green";
}

function recommendationTypeLabel(type: CatalogueGapRecommendation["type"]) {
  if (type === "card_image_refresh" || type === "sealed_image_refresh") {
    return "Images";
  }

  if (type === "card_pricing") {
    return "Cards";
  }

  if (type === "catalogue_resume") {
    return "Catalogue";
  }

  if (type === "sealed_pricing") {
    return "Sealed";
  }

  if (type === "variant_metadata_refresh") {
    return "Variants";
  }

  if (type === "duplicate_review") {
    return "Review";
  }

  return "Health";
}

function itemTypeLabel(type: string) {
  if (type === "sealed_product") {
    return "Sealed";
  }

  if (type === "card") {
    return "Cards";
  }

  return startCase(type);
}

function productTypeLabel(type: string) {
  return startCase(type);
}

function startCase(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function formatJsonPreview(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function formatCount(value?: number | null) {
  return typeof value === "number" ? new Intl.NumberFormat("en-GB").format(value) : "-";
}

function formatPercent(value?: number | null) {
  if (typeof value !== "number") {
    return "Unknown";
  }

  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`;
}

function parseJobApiResult(value: unknown): JobApiResult | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  return value as JobApiResult;
}

function parseDuplicateProviderReview(value: unknown): DuplicateProviderReview | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const result = value as Partial<DuplicateProviderReview>;

  if (result.report !== "duplicate_provider_review" || !Array.isArray(result.groups)) {
    return null;
  }

  return result as DuplicateProviderReview;
}

function getResumeJob(result: JobApiResult | null): ResumeJob | null {
  if (!result?.jobRun || result.complete || !result.nextPage || !result.pageSize) {
    return null;
  }

  if (result.jobRun.jobType === "catalogue_refresh") {
    return {
      kind: "catalogue",
      nextPage: result.nextPage,
      pageSize: result.pageSize,
      query: result.query,
    };
  }

  if (result.jobRun.jobType === "pricing_refresh") {
    return {
      kind: "pricing",
      nextPage: result.nextPage,
      pageSize: result.pageSize,
      query: result.query,
    };
  }

  return null;
}

function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="page-header">
      <h1>{title}</h1>
      {action ? <div className="actions">{action}</div> : null}
    </div>
  );
}


function StatCard({
  label,
  value,
  note,
  positive,
}: {
  label: string;
  value: string;
  note: string;
  positive?: boolean;
}) {
  return (
    <article className="stat-card">
      <span>{label}</span>
      <strong className={positive ? "positive" : ""}>{value}</strong>
      <p>{note}</p>
    </article>
  );
}


function MetricList({ rows }: { rows: Array<[string, ReactNode, string?]> }) {
  return (
    <div className="metric-list">
      {rows.map(([label, value, className]) => (
        <div className="metric-row" key={label}>
          <span>{label}</span>
          <strong className={className}>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}


function ProgressBar({ value }: { value: number }) {
  const boundedValue = Math.max(0, Math.min(100, value));

  return (
    <div
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={Math.round(boundedValue)}
      className="progress"
      role="progressbar"
    >
      <span style={{ width: `${boundedValue}%` }} />
    </div>
  );
}


function formatEventDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}


function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function dateStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}
