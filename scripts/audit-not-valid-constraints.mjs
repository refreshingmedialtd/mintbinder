import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";

export function buildConstraintAuditReport({ constraints = [], generatedAt = new Date(), violations = [] }) {
  const violationsByName = new Map(
    violations.map((row) => [String(row.constraintName), numberValue(row.violationCount)]),
  );
  const rows = constraints.map((row) => {
    const constraintName = String(row.constraintName);
    const auditAvailable = violationsByName.has(constraintName);
    const violationCount = auditAvailable ? violationsByName.get(constraintName) : null;

    return {
      auditAvailable,
      constraintName,
      definition: String(row.definition ?? ""),
      readyForValidation: auditAvailable && violationCount === 0,
      schemaName: String(row.schemaName),
      tableName: String(row.tableName),
      violationCount,
    };
  });
  const problems = rows.flatMap((row) => {
    if (!row.auditAvailable) {
      return [`${row.schemaName}.${row.tableName}.${row.constraintName} has no read-only violation audit.`];
    }

    return row.violationCount > 0
      ? [`${row.schemaName}.${row.tableName}.${row.constraintName} has ${row.violationCount} violating row(s).`]
      : [];
  });

  return {
    constraints: rows,
    generatedAt: generatedAt.toISOString(),
    nonValidatedCount: rows.length,
    ok: problems.length === 0,
    problems,
    readyForValidationCount: rows.filter((row) => row.readyForValidation).length,
    scope: "read_only",
  };
}

export async function auditNotValidConstraints({ now = new Date(), prisma = new PrismaClient() } = {}) {
  try {
    const [constraints, violations] = await Promise.all([
      prisma.$queryRaw`
        SELECT
          namespace.nspname AS "schemaName",
          relation.relname AS "tableName",
          constraint_record.conname AS "constraintName",
          pg_get_constraintdef(constraint_record.oid) AS definition
        FROM pg_constraint constraint_record
        JOIN pg_class relation ON relation.oid = constraint_record.conrelid
        JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND constraint_record.convalidated = false
        ORDER BY relation.relname, constraint_record.conname
      `,
      prisma.$queryRaw`
        SELECT 'collection_items_item_reference_check' AS "constraintName", COUNT(*)::bigint AS "violationCount"
        FROM collection_items
        WHERE NOT (
          (item_type = 'card'::item_type AND card_printing_id IS NOT NULL AND sealed_product_id IS NULL)
          OR
          (item_type = 'sealed_product'::item_type AND sealed_product_id IS NOT NULL AND card_printing_id IS NULL)
        )
        UNION ALL
        SELECT 'collection_items_quantity_check', COUNT(*)::bigint
        FROM collection_items
        WHERE NOT (quantity > 0)
        UNION ALL
        SELECT 'collection_items_money_check', COUNT(*)::bigint
        FROM collection_items
        WHERE NOT (
          (purchase_price_minor IS NULL OR purchase_price_minor >= 0)
          AND (current_value_override_minor IS NULL OR current_value_override_minor >= 0)
        )
        UNION ALL
        SELECT 'wishlist_items_item_reference_check', COUNT(*)::bigint
        FROM wishlist_items
        WHERE NOT (
          (item_type = 'card'::item_type AND card_printing_id IS NOT NULL AND sealed_product_id IS NULL)
          OR
          (item_type = 'sealed_product'::item_type AND sealed_product_id IS NOT NULL AND card_printing_id IS NULL)
        )
        UNION ALL
        SELECT 'price_snapshots_item_reference_check', COUNT(*)::bigint
        FROM price_snapshots
        WHERE NOT (
          (item_type = 'card'::item_type AND card_printing_id IS NOT NULL AND sealed_product_id IS NULL)
          OR
          (item_type = 'sealed_product'::item_type AND sealed_product_id IS NOT NULL AND card_printing_id IS NULL)
        )
        UNION ALL
        SELECT 'price_snapshots_numeric_check', COUNT(*)::bigint
        FROM price_snapshots
        WHERE NOT (
          price_minor >= 0
          AND confidence_score BETWEEN 0 AND 100
          AND (sample_size IS NULL OR sample_size >= 0)
        )
        UNION ALL
        SELECT 'collection_events_numeric_check', COUNT(*)::bigint
        FROM collection_events
        WHERE NOT (
          (quantity IS NULL OR quantity > 0)
          AND (amount_minor IS NULL OR amount_minor >= 0)
        )
      `,
    ]);

    return buildConstraintAuditReport({ constraints, generatedAt: now, violations });
  } finally {
    await prisma.$disconnect();
  }
}

function numberValue(value) {
  const number = Number(value);

  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await auditNotValidConstraints();

  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}
