import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";
import {
  isPermanentSealedImageFailureStatus,
  sealedImageMetadataWithQuarantine,
  upgradedTcgcsvSealedImageUrl,
} from "../src/lib/catalogue/sealed-image-quarantine.mjs";
import { probeImageUrl } from "./report-image-health.mjs";

const defaultConcurrency = 2;
const defaultLimit = 100;
const defaultMaxApply = 25;
const defaultTimeoutMs = 5_000;
const maxBroadPermanentFailureRatio = 0.25;
const maxConcurrency = 10;
const maxLimit = 2_000;
const maxMaxApply = 100;
const maxTimeoutMs = 15_000;
const broadApplyStatuses = new Set([404, 410]);
const booleanArguments = new Set(["--broad", "--confirm"]);
const valueArguments = new Set(["--concurrency", "--ids", "--limit", "--max-apply", "--timeout-ms"]);
const numericArguments = new Set(["--concurrency", "--limit", "--max-apply", "--timeout-ms"]);

export function brokenSealedImageQuarantineOptions({
  args = process.argv.slice(2),
  env = process.env,
} = {}) {
  const parsed = parseArguments(args);
  const ids = parsed.values.has("--ids") ? uuidValues(parsed.values.get("--ids")) : [];
  const apply = parsed.flags.has("--confirm");
  const broad = parsed.flags.has("--broad");

  if (ids.length && broad) {
    throw new Error("Use either explicit --ids or --broad, not both.");
  }

  if (apply && !ids.length && !broad) {
    throw new Error("Confirmation without explicit --ids requires the deliberate --broad flag.");
  }

  return {
    apply,
    broad,
    concurrency: boundedPositiveInteger(
      parsed.values.get("--concurrency") ?? env.SEALED_IMAGE_QUARANTINE_CONCURRENCY,
      defaultConcurrency,
      maxConcurrency,
    ),
    ids,
    limit: boundedPositiveInteger(parsed.values.get("--limit"), defaultLimit, maxLimit),
    maxApply: boundedPositiveInteger(parsed.values.get("--max-apply"), defaultMaxApply, maxMaxApply),
    timeoutMs: boundedPositiveInteger(
      parsed.values.get("--timeout-ms") ?? env.SEALED_IMAGE_QUARANTINE_TIMEOUT_MS,
      defaultTimeoutMs,
      maxTimeoutMs,
    ),
  };
}

export function sealedImageQuarantineDisposition(status, targeted = false) {
  if (!isPermanentSealedImageFailureStatus(status)) {
    return "not_permanent";
  }

  if (targeted || broadApplyStatuses.has(Number(status))) {
    return "eligible";
  }

  return "review_required";
}

export async function runBrokenSealedImageQuarantine({
  fetchImpl = fetch,
  now = new Date(),
  options = brokenSealedImageQuarantineOptions(),
  prisma = new PrismaClient(),
} = {}) {
  const checkedAt = validDate(now);
  const targeted = options.ids.length > 0;

  if (options.apply && !targeted && options.broad !== true) {
    throw new Error("Confirmation without explicit IDs requires broad=true.");
  }

  if (targeted && options.broad === true) {
    throw new Error("Explicit IDs and broad confirmation are mutually exclusive.");
  }

  try {
    const candidates = await prisma.sealedProduct.findMany({
      orderBy: { id: "asc" },
      select: {
        id: true,
        imageUrl: true,
        metadata: true,
        name: true,
        updatedAt: true,
      },
      take: options.limit,
      where: {
        createdByUserId: null,
        imageUrl: { not: null },
        visibility: "GLOBAL",
        ...(targeted ? { id: { in: options.ids } } : {}),
      },
    });
    const usableCandidates = candidates
      .map(normalizedProbeCandidate)
      .filter(Boolean);
    const probes = await mapConcurrent(usableCandidates, options.concurrency, (candidate) =>
      probeImageUrl({
        fetchImpl,
        id: candidate.id,
        kind: "sealed",
        timeoutMs: options.timeoutMs,
        url: candidate.imageUrl,
      }));
    const candidateById = new Map(usableCandidates.map((candidate) => [candidate.id, candidate]));
    const assessed = probes.map((probe) => ({
      ...probe,
      disposition: sealedImageQuarantineDisposition(probe.status, targeted),
      name: candidateById.get(probe.id)?.name,
    }));
    const initialEligible = assessed.filter((probe) => probe.disposition === "eligible");
    const report = {
      applyBlockedReasons: [],
      broadApproved: options.broad === true,
      candidatesChecked: usableCandidates.length,
      dryRun: !options.apply,
      explicitIds: options.ids,
      missingExplicitIds: targeted
        ? options.ids.filter((id) => !candidateById.has(id))
        : [],
      pageLimit: options.limit,
      permanentFailures: assessed.filter((probe) =>
        isPermanentSealedImageFailureStatus(probe.status)).length,
      reviewRequired: assessed.filter((probe) => probe.disposition === "review_required").length,
      sampleFailures: assessed
        .filter((probe) => !probe.imageResponse)
        .slice(0, 25)
        .map(({ disposition, id, name, reason, status, url }) => ({
          disposition,
          id,
          name,
          reason,
          status,
          url,
        })),
      targeted,
      transientOrOtherFailures: assessed.filter((probe) =>
        !probe.imageResponse && !isPermanentSealedImageFailureStatus(probe.status)).length,
      wouldQuarantine: initialEligible.length,
    };

    if (!options.apply || initialEligible.length === 0) {
      return {
        ...report,
        hostControls: [],
        quarantineRaceSkipped: 0,
        sealedImagesQuarantined: 0,
      };
    }

    if (initialEligible.length > options.maxApply) {
      report.applyBlockedReasons.push(
        `The ${initialEligible.length} eligible rows exceed the independent --max-apply cap of ${options.maxApply}.`,
      );
    }

    const rechecks = await mapConcurrent(initialEligible, options.concurrency, (probe) =>
      probeImageUrl({
        fetchImpl,
        id: probe.id,
        kind: "sealed",
        timeoutMs: options.timeoutMs,
        url: probe.url,
      }));
    const confirmed = rechecks.filter((probe) =>
      sealedImageQuarantineDisposition(probe.status, targeted) === "eligible");

    if (confirmed.length !== initialEligible.length) {
      report.applyBlockedReasons.push(
        "At least one candidate did not repeat the eligible permanent HTTP failure during the confirmation probe.",
      );
    }

    if (!targeted && confirmed.length / Math.max(usableCandidates.length, 1) > maxBroadPermanentFailureRatio) {
      report.applyBlockedReasons.push(
        `The broad-scan permanent-failure ratio exceeded ${maxBroadPermanentFailureRatio * 100}%; use an explicit reviewed --ids target instead.`,
      );
    }

    const hostControls = await verifyAffectedHostControls({
      candidates: usableCandidates,
      concurrency: options.concurrency,
      fetchImpl,
      failures: confirmed,
      prisma,
      timeoutMs: options.timeoutMs,
    });
    const failedControlHosts = hostControls
      .filter((control) => !control.success)
      .map((control) => control.host);

    if (failedControlHosts.length) {
      report.applyBlockedReasons.push(
        `No successful same-host control image was found for: ${failedControlHosts.join(", ")}.`,
      );
    }

    if (report.applyBlockedReasons.length) {
      return {
        ...report,
        hostControls,
        quarantineRaceSkipped: 0,
        sealedImagesQuarantined: 0,
      };
    }

    let quarantineRaceSkipped = 0;
    let sealedImagesQuarantined = 0;

    for (const probe of confirmed.slice(0, options.maxApply)) {
      const candidate = candidateById.get(probe.id);

      if (!candidate?.imageUrl) {
        quarantineRaceSkipped += 1;
        continue;
      }

      const result = await prisma.sealedProduct.updateMany({
        data: {
          imageUrl: null,
          metadata: sealedImageMetadataWithQuarantine({
            checkedAt,
            metadata: candidate.metadata,
            status: probe.status,
            url: candidate.imageUrl,
          }),
        },
        where: {
          id: candidate.id,
          imageUrl: candidate.storedImageUrl,
          updatedAt: candidate.updatedAt,
        },
      });

      sealedImagesQuarantined += result.count;
      quarantineRaceSkipped += result.count === 0 ? 1 : 0;
    }

    return {
      ...report,
      hostControls,
      quarantineRaceSkipped,
      sealedImagesQuarantined,
    };
  } finally {
    await prisma.$disconnect();
  }
}

async function verifyAffectedHostControls({
  candidates,
  concurrency,
  failures,
  fetchImpl,
  prisma,
  timeoutMs,
}) {
  const affectedHosts = [...new Set(failures.map((failure) => hostname(failure.url)).filter(Boolean))];
  const failedIds = new Set(failures.map((failure) => failure.id));
  const controls = [];

  for (const host of affectedHosts) {
    const scannedPeers = candidates.filter((candidate) =>
      !failedIds.has(candidate.id) && hostname(candidate.imageUrl) === host);
    const databasePeers = scannedPeers.length
      ? []
      : await prisma.sealedProduct.findMany({
        orderBy: { id: "asc" },
        select: { id: true, imageUrl: true },
        take: 10,
        where: {
          createdByUserId: null,
          id: { notIn: [...failedIds] },
          imageUrl: { contains: host, not: null },
          visibility: "GLOBAL",
        },
      });
    const peers = [...scannedPeers, ...databasePeers.map(normalizedProbeCandidate).filter(Boolean)]
      .filter((candidate) => hostname(candidate.imageUrl) === host)
      .slice(0, 10);
    const probes = await mapConcurrent(peers, concurrency, (candidate) =>
      probeImageUrl({
        fetchImpl,
        id: candidate.id,
        kind: "sealed",
        timeoutMs,
        url: candidate.imageUrl,
      }));
    const successful = probes.find((probe) => probe.imageResponse);

    controls.push({
      checked: probes.length,
      host,
      success: Boolean(successful),
      successfulControlId: successful?.id ?? null,
    });
  }

  return controls;
}

async function mapConcurrent(items, concurrency, mapper) {
  const output = new Array(items.length);
  let next = 0;

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;

      output[index] = await mapper(items[index]);
    }
  }));

  return output;
}

function parseArguments(args) {
  const flags = new Set();
  const values = new Map();

  for (let index = 0; index < args.length; index += 1) {
    const argument = String(args[index]);
    const equalsAt = argument.indexOf("=");
    const name = equalsAt >= 0 ? argument.slice(0, equalsAt) : argument;

    if (booleanArguments.has(name)) {
      if (equalsAt >= 0 || flags.has(name)) {
        throw new Error(`Malformed or duplicate ${name} option.`);
      }
      flags.add(name);
      continue;
    }

    if (!valueArguments.has(name) || values.has(name)) {
      throw new Error(`Unknown or duplicate sealed-image quarantine option: ${argument}`);
    }

    const value = equalsAt >= 0 ? argument.slice(equalsAt + 1) : String(args[++index] ?? "");

    if (!value.trim() || (equalsAt < 0 && value.startsWith("--"))) {
      throw new Error(`${name} requires a non-empty value.`);
    }

    if (numericArguments.has(name) && (!/^\d+$/.test(value) || Number(value) <= 0)) {
      throw new Error(`${name} requires a positive integer.`);
    }

    values.set(name, value);
  }

  return { flags, values };
}

function boundedPositiveInteger(value, fallback, maximum) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0
    ? Math.min(maximum, Math.floor(number))
    : fallback;
}

function uuidValues(value) {
  const values = [...new Set(String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean))];

  if (!values.length || values.some((entry) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry))) {
    throw new Error("--ids requires one or more comma-separated UUIDs.");
  }

  return values.map((entry) => entry.toLowerCase());
}

function normalizedProbeCandidate(candidate) {
  const storedImageUrl = typeof candidate?.imageUrl === "string" ? candidate.imageUrl : "";
  const imageUrl = upgradedTcgcsvSealedImageUrl(storedImageUrl.trim());

  return storedImageUrl.trim() && imageUrl
    ? { ...candidate, imageUrl, storedImageUrl }
    : null;
}

function hostname(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Sealed image quarantine requires a valid current time.");
  }

  return date;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = brokenSealedImageQuarantineOptions();
  const report = await runBrokenSealedImageQuarantine({ options });

  console.log(JSON.stringify(report, null, 2));

  if (options.apply && report.applyBlockedReasons.length) {
    process.exitCode = 1;
  }
}
