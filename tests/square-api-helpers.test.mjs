import assert from "node:assert/strict";
import test from "node:test";
import {
  cancelSquareSubscription,
  createSquareCustomer,
  createSquareSubscriptionCheckout,
  deleteSquareCustomer,
  deleteSquarePaymentLink,
  refundSquarePayment,
  retrieveSquareCustomer,
  retrieveSquareOrder,
  retrieveSquarePayment,
  retrieveSquarePaymentLink,
  retrieveSquareSubscription,
  retrieveSquareRefund,
  searchSquarePaymentsByOrder,
} from "../src/lib/billing/square.ts";

test("Square hosted QA checkout prepopulates the run-scoped buyer phone and email", async () => {
  await withSquareFetch(async (requests) => {
    const checkout = await createSquareSubscriptionCheckout({
      email: "square-buyer-run@example.com",
      expectation: {
        amountMinor: 249,
        currency: "GBP",
        planVariationId: "monthly-plan",
      },
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      origin: "https://mintbinder.co.uk",
      phoneNumber: "+14255550111",
      plan: "monthly",
    });

    assert.equal(checkout.orderId, "order-1");
    const body = JSON.parse(requests[0].init.body);
    assert.deepEqual(body.pre_populated_data, {
      buyer_email: "square-buyer-run@example.com",
      buyer_phone_number: "+14255550111",
    });
    assert.equal(body.checkout_options.subscription_plan_id, "monthly-plan");
    assert.match(body.payment_note, /^mintbinder_checkout_v1:/);
  }, ({ pathname }) => pathname === "/v2/online-checkout/payment-links"
    ? {
        payment_link: {
          id: "link-1",
          order_id: "order-1",
          url: "https://sandbox.square.link/u/test",
        },
      }
    : {});
});

test("Square QA customer creation carries the exact run marker and sandbox buyer phone", async () => {
  await withSquareFetch(async (requests) => {
    const customer = await createSquareCustomer({
      email: "square-buyer-run@example.com",
      idempotencyKey: "customer-idempotency-key",
      name: "Square QA Buyer run",
      note: "Mint Binder hosted-correlation QA buyer run",
      phoneNumber: "+14255550111",
      userId: "mintbinder-square-buyer-run",
    });

    assert.equal(customer.id, "customer-1");
    assert.equal(customer.referenceId, "mintbinder-square-buyer-run");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://connect.squareupsandbox.com/v2/customers");
    assert.equal(requests[0].init.method, "POST");
    assert.deepEqual(JSON.parse(requests[0].init.body), {
      email_address: "square-buyer-run@example.com",
      given_name: "Square QA Buyer run",
      idempotency_key: "customer-idempotency-key",
      note: "Mint Binder hosted-correlation QA buyer run",
      phone_number: "+14255550111",
      reference_id: "mintbinder-square-buyer-run",
    });
  }, ({ pathname }) => pathname === "/v2/customers"
    ? { customer: { id: "customer-1", reference_id: "mintbinder-square-buyer-run" } }
    : {});
});

test("Square sandbox refund helpers bind the exact payment, amount, currency, and idempotency key", async () => {
  await withSquareFetch(async (requests) => {
    const created = await refundSquarePayment({
      amountMinor: 249,
      currency: "GBP",
      idempotencyKey: "refund-idempotency-key",
      paymentId: "payment-1",
    });
    const retrieved = await retrieveSquareRefund(created.id);

    assert.equal(retrieved?.payment_id, "payment-1");
    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, "https://connect.squareupsandbox.com/v2/refunds");
    assert.equal(requests[0].init.method, "POST");
    assert.deepEqual(JSON.parse(requests[0].init.body), {
      amount_money: { amount: 249, currency: "GBP" },
      idempotency_key: "refund-idempotency-key",
      payment_id: "payment-1",
      reason: "Mint Binder hosted-correlation sandbox QA cleanup",
    });
    assert.equal(requests[1].url, "https://connect.squareupsandbox.com/v2/refunds/refund-1");
    assert.equal(requests[1].init.method, "GET");
  }, ({ pathname }) => ({
    refund: {
      amount_money: { amount: 249, currency: "GBP" },
      id: "refund-1",
      payment_id: "payment-1",
      status: "COMPLETED",
      ...(pathname === "/v2/refunds" ? {} : { retrieved: true }),
    },
  }));
});

test("Square refund reads and customer deletion normalize one exact resource ID", async () => {
  await withSquareFetch(async (requests) => {
    assert.equal((await retrieveSquareRefund(" refund-exact "))?.id, "refund-exact");
    await deleteSquareCustomer(" customer-exact ");
    assert.equal(requests[0].url, "https://connect.squareupsandbox.com/v2/refunds/refund-exact");
    assert.equal(requests[1].url, "https://connect.squareupsandbox.com/v2/customers/customer-exact");
    assert.equal(requests[1].init.method, "DELETE");
  }, ({ pathname }) => pathname.includes("/refunds/")
    ? { refund: { id: "refund-exact", payment_id: "payment-exact", status: "COMPLETED" } }
    : {});

  for (const response of [
    { refund: { id: "refund-other" } },
    { refund: { status: "COMPLETED" } },
    {},
  ]) {
    await withSquareFetch(async () => {
      await assert.rejects(retrieveSquareRefund("refund-exact"), /exact requested refund/i);
    }, () => response);
  }

  await assert.rejects(retrieveSquareRefund("   "), /exact refund ID/i);
  await assert.rejects(deleteSquareCustomer("   "), /exact customer ID/i);
});

test("Square payment discovery scans bounded pages and returns only the exact checkout order", async () => {
  await withSquareFetch(async (requests) => {
    const payments = await searchSquarePaymentsByOrder({
      beginTime: new Date("2026-09-07T10:00:00.000Z"),
      orderId: "order-exact",
    });

    assert.deepEqual(payments.map((payment) => payment.id), ["payment-exact"]);
    assert.equal(requests.length, 2);
    const first = new URL(requests[0].url);
    const second = new URL(requests[1].url);
    assert.equal(first.pathname, "/v2/payments");
    assert.equal(first.searchParams.get("begin_time"), "2026-09-07T10:00:00.000Z");
    assert.equal(first.searchParams.get("limit"), "100");
    assert.equal(first.searchParams.get("cursor"), null);
    assert.equal(second.searchParams.get("cursor"), "next-page");
  }, ({ pathname, searchParams }) => {
    if (pathname !== "/v2/payments") return {};
    if (!searchParams.has("cursor")) {
      return {
        cursor: "next-page",
        payments: [{ id: "unrelated", order_id: "another-order", status: "COMPLETED" }],
      };
    }
    return {
      payments: [{ id: "payment-exact", order_id: "order-exact", status: "COMPLETED" }],
    };
  });
});

test("Square payment retrieval requires the exact requested response identity", async () => {
  await withSquareFetch(async (requests) => {
    assert.equal((await retrieveSquarePayment(" payment-exact "))?.id, "payment-exact");
    assert.equal(requests[0].url, "https://connect.squareupsandbox.com/v2/payments/payment-exact");
  }, () => ({ payment: { id: "payment-exact", status: "COMPLETED" } }));

  for (const [label, response] of [
    ["wrong ID", { payment: { id: "payment-other", status: "COMPLETED" } }],
    ["missing ID", { payment: { status: "COMPLETED" } }],
    ["missing payment", {}],
  ]) {
    await withSquareFetch(async () => {
      await assert.rejects(
        retrieveSquarePayment("payment-exact"),
        /exact requested payment/i,
        label,
      );
    }, () => response);
  }

  await assert.rejects(retrieveSquarePayment("   "), /exact payment ID/i);
});

test("Square customer, payment-link, and order reads require exact response identities", async () => {
  await withSquareFetch(async (requests) => {
    assert.equal((await retrieveSquareCustomer(" customer-exact "))?.id, "customer-exact");
    assert.equal((await retrieveSquarePaymentLink(" link-exact "))?.id, "link-exact");
    assert.equal((await retrieveSquareOrder(" order-exact "))?.id, "order-exact");
    assert.deepEqual(requests.map(({ url }) => url), [
      "https://connect.squareupsandbox.com/v2/customers/customer-exact",
      "https://connect.squareupsandbox.com/v2/online-checkout/payment-links/link-exact",
      "https://connect.squareupsandbox.com/v2/orders/order-exact",
    ]);
  }, ({ pathname }) => {
    if (pathname.includes("/customers/")) {
      return { customer: { id: "customer-exact", reference_id: "user-exact" } };
    }
    if (pathname.includes("/payment-links/")) {
      return { payment_link: { id: "link-exact", order_id: "order-exact" } };
    }
    return { order: { id: "order-exact", state: "OPEN", tenders: [] } };
  });

  for (const [label, retrieve, response, message] of [
    ["customer", () => retrieveSquareCustomer("customer-exact"), { customer: { id: "customer-other" } }, /exact requested customer/i],
    ["missing customer", () => retrieveSquareCustomer("customer-exact"), {}, /exact requested customer/i],
    ["payment link", () => retrieveSquarePaymentLink("link-exact"), { payment_link: { id: "link-other" } }, /exact requested payment link/i],
    ["missing payment link", () => retrieveSquarePaymentLink("link-exact"), {}, /exact requested payment link/i],
    ["order", () => retrieveSquareOrder("order-exact"), { order: { id: "order-other" } }, /exact requested order/i],
    ["missing order", () => retrieveSquareOrder("order-exact"), {}, /exact requested order/i],
  ]) {
    await withSquareFetch(async () => {
      await assert.rejects(retrieve(), message, label);
    }, () => response);
  }

  await assert.rejects(retrieveSquareCustomer("   "), /exact customer ID/i);
  await assert.rejects(retrieveSquarePaymentLink("   "), /exact link ID/i);
  await assert.rejects(retrieveSquareOrder("   "), /exact order ID/i);
});

test("Square payment-link deletion validates the link and returns optional canceled-order proof", async () => {
  await withSquareFetch(async (requests) => {
    const deletion = await deleteSquarePaymentLink("link-exact");

    assert.deepEqual(deletion, { cancelledOrderId: "order-exact", id: "link-exact" });
    assert.equal(requests[0].init.method, "DELETE");
    assert.equal(
      requests[0].url,
      "https://connect.squareupsandbox.com/v2/online-checkout/payment-links/link-exact",
    );
  }, () => ({ cancelled_order_id: "order-exact", id: "link-exact" }));

  await withSquareFetch(async () => {
    assert.deepEqual(
      await deleteSquarePaymentLink("link-exact"),
      { cancelledOrderId: null, id: "link-exact" },
    );
  }, () => ({ id: "link-exact" }));

  for (const [label, response] of [
    ["wrong link", { cancelled_order_id: "order-exact", id: "another-link" }],
    ["missing link", { cancelled_order_id: "order-exact" }],
  ]) {
    await withSquareFetch(async () => {
      await assert.rejects(deleteSquarePaymentLink("link-exact"), /exact payment link/i, label);
    }, () => response);
  }

  await assert.rejects(deleteSquarePaymentLink("   "), /exact link ID/i);
});

test("Square subscription retrieval and cancellation require exact response identity", async () => {
  await withSquareFetch(async (requests) => {
    assert.equal((await retrieveSquareSubscription(" subscription-exact "))?.id, "subscription-exact");
    assert.equal((await cancelSquareSubscription(" subscription-exact ")).id, "subscription-exact");
    assert.equal(requests[0].url, "https://connect.squareupsandbox.com/v2/subscriptions/subscription-exact");
    assert.equal(requests[1].url, "https://connect.squareupsandbox.com/v2/subscriptions/subscription-exact/cancel");
  }, () => ({ subscription: { id: "subscription-exact", status: "CANCELED" } }));

  for (const [label, response] of [
    ["wrong ID", { subscription: { id: "subscription-other", status: "CANCELED" } }],
    ["missing ID", { subscription: { status: "CANCELED" } }],
    ["missing subscription", {}],
  ]) {
    await withSquareFetch(async () => {
      await assert.rejects(
        retrieveSquareSubscription("subscription-exact"),
        /exact requested subscription/i,
        label,
      );
      await assert.rejects(
        cancelSquareSubscription("subscription-exact"),
        /exact cancelled subscription/i,
        label,
      );
    }, () => response);
  }

  await assert.rejects(retrieveSquareSubscription("   "), /exact subscription ID/i);
  await assert.rejects(cancelSquareSubscription("   "), /exact subscription ID/i);
});

async function withSquareFetch(run, responseForUrl) {
  const originalFetch = globalThis.fetch;
  const previous = {
    accessToken: process.env.SQUARE_ACCESS_TOKEN,
    correlationSecret: process.env.SQUARE_CHECKOUT_CORRELATION_SECRET,
    correlationVerified: process.env.SQUARE_PAYMENT_CORRELATION_VERIFIED,
    environment: process.env.SQUARE_ENVIRONMENT,
    locationId: process.env.SQUARE_LOCATION_ID,
    requestTimeout: process.env.SQUARE_REQUEST_TIMEOUT_MS,
    retries: process.env.SQUARE_RETRY_ATTEMPTS,
  };
  const requests = [];

  process.env.SQUARE_ACCESS_TOKEN = "sandbox-access-token";
  process.env.SQUARE_CHECKOUT_CORRELATION_SECRET = "square-hosted-qa-correlation-secret-123456789";
  process.env.SQUARE_PAYMENT_CORRELATION_VERIFIED = "false";
  process.env.SQUARE_ENVIRONMENT = "sandbox";
  process.env.SQUARE_LOCATION_ID = "location-1";
  process.env.SQUARE_REQUEST_TIMEOUT_MS = "1000";
  process.env.SQUARE_RETRY_ATTEMPTS = "1";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ init, url });
    return Response.json(responseForUrl(new URL(url)), { status: 200 });
  };

  try {
    await run(requests);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv("SQUARE_ACCESS_TOKEN", previous.accessToken);
    restoreEnv("SQUARE_CHECKOUT_CORRELATION_SECRET", previous.correlationSecret);
    restoreEnv("SQUARE_PAYMENT_CORRELATION_VERIFIED", previous.correlationVerified);
    restoreEnv("SQUARE_ENVIRONMENT", previous.environment);
    restoreEnv("SQUARE_LOCATION_ID", previous.locationId);
    restoreEnv("SQUARE_REQUEST_TIMEOUT_MS", previous.requestTimeout);
    restoreEnv("SQUARE_RETRY_ATTEMPTS", previous.retries);
  }
}

function restoreEnv(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
