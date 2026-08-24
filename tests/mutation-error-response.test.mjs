import assert from "node:assert/strict";
import test from "node:test";
import { AppMutationError } from "../src/lib/db/app-data.ts";
import { PersistedInputError } from "../src/lib/db/input-validation.ts";
import { classifyMutationError } from "../src/lib/http/mutation-error-classification.ts";

test("mutation responses expose typed client errors but never infrastructure details", async () => {
  const validation = classifyMutationError(new PersistedInputError("Notes are too long."));
  assert.deepEqual(validation, { message: "Notes are too long.", status: 400 });

  const missing = classifyMutationError(new AppMutationError("Collection item not found.", 404));
  assert.deepEqual(missing, { message: "Collection item not found.", status: 404 });
  assert.equal(
    classifyMutationError(new Error("Invalid Prisma invocation at C:\\secret\\schema.prisma")),
    null,
  );
});
