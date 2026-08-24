import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertInsuranceReportLotLimit,
  InsuranceReportTooLargeError,
  MAX_INSURANCE_REPORT_LOTS,
} from "../src/lib/reports/insurance-limit.ts";

test("insurance report permits the cap and rejects the next lot with 413", () => {
  assert.doesNotThrow(() => assertInsuranceReportLotLimit(MAX_INSURANCE_REPORT_LOTS));
  assert.throws(
    () => assertInsuranceReportLotLimit(MAX_INSURANCE_REPORT_LOTS + 1),
    (error) => error instanceof InsuranceReportTooLargeError && error.status === 413,
  );
});

test("route checks the cheap lot count before loading or rendering report data", async () => {
  const source = await readFile(
    new URL("../src/app/api/reports/insurance/route.ts", import.meta.url),
    "utf8",
  );
  const countAt = source.indexOf("prisma.collectionItem.count");
  const loadAt = source.indexOf("getAppData(session.user.id");
  const renderAt = source.indexOf("buildInsuranceReportPdf(input)");

  assert.ok(countAt > 0 && countAt < loadAt && loadAt < renderAt);
  assert.match(source, /assertInsuranceReportLotLimit\(data\.collection\.length\)/);
});
