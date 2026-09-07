import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { writeAtomicJsonCheckpoint } from "../scripts/atomic-json-checkpoint.mjs";

test("atomic JSON checkpoints replace a complete last-known-good document", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mintbinder-square-checkpoint-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const target = path.join(directory, "run.json");

  await writeAtomicJsonCheckpoint(target, { phase: "before" });
  await writeAtomicJsonCheckpoint(target, { phase: "after", providerId: "safe-id" });

  assert.deepEqual(JSON.parse(await readFile(target, "utf8")), {
    phase: "after",
    providerId: "safe-id",
  });
  assert.deepEqual(await readdir(directory), ["run.json"]);
});

test("a failed replacement preserves the previous checkpoint and removes its temp file", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mintbinder-square-checkpoint-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const target = path.join(directory, "run.json");
  await writeAtomicJsonCheckpoint(target, { phase: "last-known-good" });

  await assert.rejects(
    writeAtomicJsonCheckpoint(target, { phase: "uncommitted" }, {
      renameFile: async () => {
        throw new Error("simulated crash boundary");
      },
    }),
    /simulated crash boundary/,
  );

  assert.deepEqual(JSON.parse(await readFile(target, "utf8")), {
    phase: "last-known-good",
  });
  assert.deepEqual(await readdir(directory), ["run.json"]);
});

test("the containing directory is synced after the atomic rename", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mintbinder-square-checkpoint-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const target = path.join(directory, "run.json");
  const calls = [];

  await writeAtomicJsonCheckpoint(target, { phase: "durable" }, {
    openDirectory: async (openedPath, flags) => {
      calls.push(["open-directory", openedPath, flags]);
      return {
        close: async () => calls.push(["close-directory"]),
        sync: async () => calls.push(["sync-directory"]),
      };
    },
    platform: "linux",
    renameFile: async (from, to) => {
      calls.push(["rename", path.dirname(from), to]);
      await rename(from, to);
    },
  });

  assert.deepEqual(calls, [
    ["rename", directory, target],
    ["open-directory", directory, "r"],
    ["sync-directory"],
    ["close-directory"],
  ]);
});

test("unsupported Windows directory syncing remains best effort", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mintbinder-square-checkpoint-"));
  context.after(() => rm(directory, { force: true, recursive: true }));
  const target = path.join(directory, "run.json");

  await writeAtomicJsonCheckpoint(target, { phase: "windows" }, {
    openDirectory: async () => {
      throw Object.assign(new Error("directories cannot be opened on this platform"), { code: "EPERM" });
    },
    platform: "win32",
  });

  assert.deepEqual(JSON.parse(await readFile(target, "utf8")), { phase: "windows" });
});
