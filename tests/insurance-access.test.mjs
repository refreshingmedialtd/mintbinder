import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { hasInsuranceReportTesterAccess } from "../src/lib/reports/insurance-access.ts";

test("only an administrator can bypass paid insurance entitlement for release testing", () => {
  assert.equal(hasInsuranceReportTesterAccess("ADMIN"), true);
  assert.equal(hasInsuranceReportTesterAccess("USER"), false);
  assert.equal(hasInsuranceReportTesterAccess(undefined), false);
});

test("free insurance clicks explain the gate without navigating away", async () => {
  const [page, route] = await Promise.all([
    readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/reports/insurance/route.ts", import.meta.url), "utf8"),
  ]);
  const handler = page.slice(
    page.indexOf("async function exportInsuranceReport()"),
    page.indexOf("async function startPlusCheckout", page.indexOf("async function exportInsuranceReport()")),
  );

  assert.doesNotMatch(handler, /screen:\s*"analytics"/);
  assert.match(handler, /if \(!effectivePlus\)/);
  assert.doesNotMatch(handler, /if \(!appState\.plus\)/);
  assert.match(handler, /Switch the tester plan to Plus/);
  assert.match(route, /hasInsuranceReportTesterAccess\(session\.user\.role\)/);
  assert.match(route, /requireEntitlement\(session\.user\.id, "exports\.insurance_report"\)/);
});
