import assert from "node:assert/strict";
import test from "node:test";
import { unresolvedLegalSourceFiles } from "../scripts/legal-readiness.mjs";

test("detects unresolved draft and pre-launch legal copy", () => {
  assert.deepEqual(unresolvedLegalSourceFiles([
    { name: "ready", source: "These terms apply from 1 September 2026." },
    { name: "draft", source: "Beta draft" },
    { name: "privacy", source: "The address still needs to be confirmed before public launch." },
  ]), ["draft", "privacy"]);
});

test("accepts legal source without unresolved launch markers", () => {
  assert.deepEqual(unresolvedLegalSourceFiles([
    { name: "terms", source: "Registered operator: Example Limited." },
  ]), []);
});
