import assert from "node:assert/strict";
import test from "node:test";

import { squarePublicCheckoutIsEnabled } from "../src/lib/billing/square-public-checkout.ts";

test("public Square checkout requires both correlation evidence and production credentials", () => {
  assert.equal(squarePublicCheckoutIsEnabled({
    SQUARE_ENVIRONMENT: "production",
    SQUARE_PAYMENT_CORRELATION_VERIFIED: "true",
  }), true);

  for (const env of [
    {
      SQUARE_ENVIRONMENT: "sandbox",
      SQUARE_PAYMENT_CORRELATION_VERIFIED: "true",
    },
    {
      SQUARE_ENVIRONMENT: "production",
      SQUARE_PAYMENT_CORRELATION_VERIFIED: "false",
    },
    {
      SQUARE_ENVIRONMENT: "sandbox",
      SQUARE_PAYMENT_CORRELATION_VERIFIED: "false",
    },
    {
      SQUARE_ENVIRONMENT: "production",
    },
    {
      SQUARE_PAYMENT_CORRELATION_VERIFIED: "true",
    },
  ]) {
    assert.equal(squarePublicCheckoutIsEnabled(env), false);
  }
});

test("the public Square checkout gate normalizes operator whitespace and casing", () => {
  assert.equal(squarePublicCheckoutIsEnabled({
    SQUARE_ENVIRONMENT: " Production ",
    SQUARE_PAYMENT_CORRELATION_VERIFIED: " TRUE ",
  }), true);
});
