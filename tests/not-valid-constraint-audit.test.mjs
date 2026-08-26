import assert from "node:assert/strict";
import test from "node:test";
import { buildConstraintAuditReport } from "../scripts/audit-not-valid-constraints.mjs";

const constraint = {
  constraintName: "collection_items_quantity_check",
  definition: "CHECK ((quantity > 0)) NOT VALID",
  schemaName: "public",
  tableName: "collection_items",
};

test("reports audited zero-violation constraints as ready without validating them", () => {
  const report = buildConstraintAuditReport({
    constraints: [constraint],
    generatedAt: new Date("2026-08-26T12:00:00Z"),
    violations: [{ constraintName: constraint.constraintName, violationCount: 0n }],
  });

  assert.equal(report.ok, true);
  assert.equal(report.scope, "read_only");
  assert.equal(report.readyForValidationCount, 1);
  assert.equal(report.constraints[0].readyForValidation, true);
});

test("fails the audit on violating rows or unknown constraints", () => {
  const report = buildConstraintAuditReport({
    constraints: [
      constraint,
      { ...constraint, constraintName: "future_check" },
    ],
    violations: [{ constraintName: constraint.constraintName, violationCount: 2n }],
  });

  assert.equal(report.ok, false);
  assert.match(report.problems.join(" "), /2 violating row/);
  assert.match(report.problems.join(" "), /has no read-only violation audit/);
});
