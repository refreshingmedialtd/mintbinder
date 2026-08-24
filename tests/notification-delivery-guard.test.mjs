import assert from "node:assert/strict";
import test from "node:test";
import { deliverNotificationOnce } from "../src/lib/notifications/delivery-guard.ts";
import {
  NotificationDeliveryUnresolvedError,
  notificationRecipientToken,
} from "../src/lib/notifications/delivery-store.ts";

test("opaque delivery identity distinguishes test and live recipients", () => {
  const shared = {
    periodKey: "2026-08-24",
    secret: "test-secret",
    userId: "11111111-1111-4111-8111-111111111111",
  };
  const testToken = notificationRecipientToken({ ...shared, recipient: "test@example.com" });
  const liveToken = notificationRecipientToken({ ...shared, recipient: "collector@example.com" });

  assert.notEqual(testToken, liveToken);
  assert.equal(
    notificationRecipientToken({ ...shared, recipient: " TEST@example.com " }),
    testToken,
  );
  assert.equal(testToken.includes("@"), false);
});

test("two invocations can deliver a recipient-period at most once", async () => {
  let claimed = false;
  let sends = 0;
  const attempts = () => deliverNotificationOnce({
    async claim() {
      if (claimed) return false;
      claimed = true;
      return true;
    },
    async markAmbiguous() {},
    async markSent() {},
    async send() {
      sends += 1;
      return { id: "message-1" };
    },
  });

  const [first, second] = await Promise.all([attempts(), attempts()]);
  assert.deepEqual([first.status, second.status].sort(), ["duplicate", "sent"]);
  assert.equal(sends, 1);
});

test("accepted-then-timeout is not retried and remains an explicit unresolved failure", async () => {
  let claimed = false;
  let sends = 0;
  let ambiguous = 0;
  const attempt = () => deliverNotificationOnce({
    async claim() {
      if (claimed) {
        throw new NotificationDeliveryUnresolvedError(
          "AMBIGUOUS",
          new Date("2026-08-24T11:00:00.000Z"),
          new Date("2026-08-24T12:00:00.000Z"),
        );
      }
      claimed = true;
      return true;
    },
    async markAmbiguous() {
      ambiguous += 1;
    },
    async markSent() {},
    async send() {
      sends += 1;
      throw new Error("provider accepted the request but the response timed out");
    },
  });

  assert.equal((await attempt()).status, "ambiguous");
  await assert.rejects(
    attempt(),
    (error) => error instanceof NotificationDeliveryUnresolvedError &&
      error.deliveryStatus === "AMBIGUOUS" && error.ageSeconds === 3_600,
  );
  assert.equal(sends, 1);
  assert.equal(ambiguous, 1);
});

test("stale claimed deliveries are unresolved rather than healthy duplicates", () => {
  const error = new NotificationDeliveryUnresolvedError(
    "CLAIMED",
    new Date("2026-08-24T11:59:00.000Z"),
    new Date("2026-08-24T12:00:00.000Z"),
  );

  assert.equal(error.deliveryStatus, "CLAIMED");
  assert.equal(error.ageSeconds, 60);
  assert.match(error.message, /requires reconciliation/);
});
