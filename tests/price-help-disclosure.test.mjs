import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { closeOtherPriceHelp, PRICE_HELP_GROUP } from "../src/lib/pricing/price-help-disclosure.ts";

test("opening one price help closes every other price help", () => {
  const boxes = [{ open: true }, { open: true }, { open: true }];
  closeOtherPriceHelp({ querySelectorAll: (selector) => {
    assert.equal(selector, `details[name="${PRICE_HELP_GROUP}"][open]`);
    return boxes;
  } }, boxes[1]);
  assert.deepEqual(boxes.map((box) => box.open), [false, true, false]);
  closeOtherPriceHelp({ querySelectorAll: () => boxes });
  assert.deepEqual(boxes.map((box) => box.open), [false, false, false]);
});

test("collection help uses native exclusive disclosure plus outside-click and keyboard dismissal", async () => {
  const page = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /name=\{PRICE_HELP_GROUP\}/);
  assert.match(page, /if \(event.currentTarget.open\) closeOtherPriceHelp\(document, event.currentTarget\)/);
  assert.match(page, /document.addEventListener\("pointerdown", dismissOutside\)/);
  assert.match(page, /document.removeEventListener\("pointerdown", dismissOutside\)/);
  assert.match(page, /if \(event.key === "Escape"\) event.currentTarget.open = false/);
  assert.match(page, /UK-market confidence/);
  assert.match(page, /priceConfidenceExplanation\(marketPoint\)/);
});
