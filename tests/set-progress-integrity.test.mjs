import assert from "node:assert/strict";
import test from "node:test";
import { reviewedTcgcsvGroup } from "../scripts/reviewed-tcgcsv-card-catalogue.mjs";
import { cardSetIsReadyForProgress } from "../src/lib/db/app-data.ts";

test("ordinary catalogue sets remain visible regardless of imported-card coverage", () => {
  assert.equal(cardSetIsReadyForProgress({ total: 165 }, 1), true);
  assert.equal(cardSetIsReadyForProgress({ metadata: { catalogueScope: "full" }, total: 165 }, 0), true);
});

test("reviewed supplements stay out of set progress until their expected total is present", () => {
  const reviewed = (total) => ({
    metadata: { catalogueScope: "reviewed-supplement" },
    total,
  });

  assert.equal(cardSetIsReadyForProgress(reviewed(102), 3), false);
  assert.equal(cardSetIsReadyForProgress(reviewed(102), 101), false);
  assert.equal(cardSetIsReadyForProgress(reviewed(102), 102), true);
  assert.equal(cardSetIsReadyForProgress(reviewed(102), 103), true);
});

test("reviewed supplements fail closed without a trustworthy expected total or card count", () => {
  const reviewed = (total) => ({
    metadata: { catalogueScope: "reviewed-supplement" },
    total,
  });

  assert.equal(cardSetIsReadyForProgress(reviewed(undefined), 102), false);
  assert.equal(cardSetIsReadyForProgress(reviewed(null), 102), false);
  assert.equal(cardSetIsReadyForProgress(reviewed(0), 102), false);
  assert.equal(cardSetIsReadyForProgress(reviewed(102.5), 103), false);
  assert.equal(cardSetIsReadyForProgress(reviewed(102), Number.NaN), false);
});

test("reviewed set specifications publish their complete expected totals", () => {
  assert.equal(reviewedTcgcsvGroup(3, "24451").set.total, 89);
  assert.equal(reviewedTcgcsvGroup(3, "23323").set.total, 102);
  assert.equal(reviewedTcgcsvGroup(85, "23923").set.total, 91);
});
