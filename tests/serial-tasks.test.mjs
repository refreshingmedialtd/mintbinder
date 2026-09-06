import assert from "node:assert/strict";
import test from "node:test";
import { runSerialTasks } from "../scripts/serial-tasks.mjs";

test("database diagnostic tasks never overlap on a constrained connection pool", async () => {
  let active = 0;
  let maximumActive = 0;
  const order = [];
  const tasks = [1, 2, 3].map((value) => async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    order.push(`start-${value}`);
    await new Promise((resolve) => setTimeout(resolve, 2));
    order.push(`finish-${value}`);
    active -= 1;
    return value;
  });

  assert.deepEqual(await runSerialTasks(tasks), [1, 2, 3]);
  assert.equal(maximumActive, 1);
  assert.deepEqual(order, [
    "start-1",
    "finish-1",
    "start-2",
    "finish-2",
    "start-3",
    "finish-3",
  ]);
});
