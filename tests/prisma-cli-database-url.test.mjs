import assert from "node:assert/strict";
import test from "node:test";
import { prismaCliDatabaseUrl } from "../scripts/prisma-cli-database-url.mjs";

const pooled = "postgresql://owner:pass%40word@ep-test-abc-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require&pgbouncer=true&schema=public";
test("Neon CLI connections are direct while runtime credentials and database stay unchanged", () => {
  const env = { DATABASE_URL: pooled };
  const url = new URL(prismaCliDatabaseUrl(env));
  assert.equal(url.hostname, "ep-test-abc.eu-west-2.aws.neon.tech");
  assert.equal(url.password, "pass%40word");
  assert.equal(url.pathname, "/neondb");
  assert.equal(url.searchParams.get("sslmode"), "require");
  assert.equal(url.searchParams.get("schema"), "public");
  assert.equal(url.searchParams.get("connection_limit"), "1");
  assert.equal(url.searchParams.has("pgbouncer"), false);
  assert.equal(env.DATABASE_URL, pooled);
});
test("generic and already-direct databases are never assigned invented hostnames", () => {
  assert.equal(prismaCliDatabaseUrl({}), undefined);
  for (const DATABASE_URL of ["postgresql://u:p@localhost/db", "postgresql://u:p@some-pooler.example.com/db",
    "postgresql://u:p@ep-test-abc.eu-west-2.aws.neon.tech/db"]) {
    assert.equal(prismaCliDatabaseUrl({ DATABASE_URL }), DATABASE_URL);
  }
});
test("an explicit direct URL is accepted only for the same database and schema", () => {
  const direct = pooled.replace("-pooler.", ".");
  assert.equal(new URL(prismaCliDatabaseUrl({ DATABASE_URL: pooled, DIRECT_URL: direct })).hostname,
    "ep-test-abc.eu-west-2.aws.neon.tech");
  assert.equal(new URL(prismaCliDatabaseUrl({ DATABASE_URL: pooled,
    DIRECT_URL: direct.replace(".tech/", ".tech:5432/") })).port, "5432");
  for (const DIRECT_URL of [pooled, direct.replace("/neondb", "/wrong"), direct.replace("schema=public", "schema=other"),
    direct.replace("ep-test-abc.", "ep-other-project.")]) {
    assert.throws(() => prismaCliDatabaseUrl({ DATABASE_URL: pooled, DIRECT_URL }), /DIRECT_URL/);
  }
});
