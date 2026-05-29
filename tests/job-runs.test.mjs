import assert from "node:assert/strict";
import test from "node:test";
import { isJobRunType } from "../src/lib/jobs/types.ts";

test("recognizes supported job run types", () => {
  assert.equal(isJobRunType("price_alerts"), true);
  assert.equal(isJobRunType("catalogue_refresh"), true);
  assert.equal(isJobRunType("pricing_refresh"), true);
  assert.equal(isJobRunType("unknown"), false);
  assert.equal(isJobRunType(null), false);
});
