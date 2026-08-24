import assert from "node:assert/strict";
import test from "node:test";
import { boundedInsuranceHistory } from "../src/lib/reports/history.ts";

test("insurance history keeps older material events beyond the dashboard dozen", () => {
  const events = Array.from({ length: 14 }, (_, index) => ({
    id: `event-${index}`,
    type: index === 13 ? "Sold" : "Graded",
  }));
  const history = boundedInsuranceHistory(events, 500);

  assert.equal(history.events.length, 14);
  assert.equal(history.events.at(-1).type, "Sold");
  assert.equal(history.notice, undefined);
});

test("insurance history discloses an explicit safety cap", () => {
  const events = Array.from({ length: 4 }, (_, index) => ({ id: `event-${index}` }));
  const history = boundedInsuranceHistory(events, 3);

  assert.equal(history.events.length, 3);
  assert.match(history.notice, /3 most recent/i);
});
