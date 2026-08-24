import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import nextConfig from "../next.config.ts";
import {
  accountTokenPageMetadata,
  accountTokenUrl,
  consumeAccountTokenFragment,
} from "../src/lib/auth/token-links.ts";

test("account email bearer tokens are encoded only in the URL fragment", async () => {
  const token = "secret_reset_token_abcdefghijklmnopqrstuvwxyz123456";
  const reset = accountTokenUrl("/auth/reset-password", token, "https://mintbinder.co.uk");
  const verify = accountTokenUrl("/auth/verify-email", token, "https://mintbinder.co.uk");

  for (const url of [reset, verify]) {
    assert.equal(url.searchParams.has("token"), false);
    assert.equal(new URLSearchParams(url.hash.slice(1)).get("token"), token);
    assert.equal(url.toString().includes("?token="), false);
  }

  const emailSource = await readFile(
    new URL("../src/lib/auth/account-tokens.ts", import.meta.url),
    "utf8",
  );
  assert.match(emailSource, /accountTokenUrl\("\/auth\/reset-password"/);
  assert.match(emailSource, /accountTokenUrl\("\/auth\/verify-email"/);
  assert.doesNotMatch(emailSource, /searchParams\.set\("token"/);
});

test("hydration consumes the fragment and replaces history with a token-free URL", () => {
  const replacements = [];
  const token = consumeAccountTokenFragment({
    hash: "#token=bearer_secret&ignored=value",
    pathname: "/auth/reset-password",
    search: "?campaign=recovery&token=legacy_leak",
  }, (url) => replacements.push(url));

  assert.equal(token, "bearer_secret");
  assert.deepEqual(replacements, ["/auth/reset-password?campaign=recovery"]);
  assert.equal(replacements[0].includes("bearer_secret"), false);
  assert.equal(replacements[0].includes("legacy_leak"), false);
});

test("legacy query tokens are consumed for one release and stripped immediately", () => {
  const replacements = [];
  const token = consumeAccountTokenFragment({
    hash: "",
    pathname: "/auth/verify-email",
    search: "?campaign=verification&token=legacy_bearer",
  }, (url) => replacements.push(url));

  assert.equal(token, "legacy_bearer");
  assert.deepEqual(replacements, ["/auth/verify-email?campaign=verification"]);
  assert.equal(replacements[0].includes("legacy_bearer"), false);
});

test("fragment tokens win when both fragment and legacy query forms are present", () => {
  const replacements = [];
  const token = consumeAccountTokenFragment({
    hash: "#token=current_fragment",
    pathname: "/auth/reset-password",
    search: "?token=legacy_query&campaign=recovery",
  }, (url) => replacements.push(url));

  assert.equal(token, "current_fragment");
  assert.deepEqual(replacements, ["/auth/reset-password?campaign=recovery"]);
});

test("both client routes strip fragments in a layout effect immediately after hydration", async () => {
  const sources = await Promise.all([
    readFile(new URL("../src/app/auth/reset-password/reset-password-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/auth/verify-email/verify-email-confirmation.tsx", import.meta.url), "utf8"),
  ]);

  for (const source of sources) {
    assert.match(source, /useLayoutEffect/);
    assert.match(source, /consumeAccountTokenFragment\(window\.location/);
    assert.match(source, /window\.history\.replaceState/);
  }
});

test("token pages are noindex and emit no-referrer response policy", async () => {
  assert.equal(accountTokenPageMetadata.robots.index, false);
  assert.equal(accountTokenPageMetadata.robots.follow, false);
  assert.equal(accountTokenPageMetadata.robots.googleBot.index, false);
  assert.equal(accountTokenPageMetadata.robots.googleBot.follow, false);

  const routes = await nextConfig.headers?.();
  for (const source of ["/auth/reset-password", "/auth/verify-email"]) {
    const route = routes?.find((entry) => entry.source === source);
    const headers = Object.fromEntries((route?.headers ?? []).map((header) => [header.key, header.value]));
    assert.equal(headers["Referrer-Policy"], "no-referrer");
    assert.match(headers["X-Robots-Tag"], /noindex/);
    assert.match(headers["Cache-Control"], /no-store/);
  }
});
