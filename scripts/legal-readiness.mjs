import { readFileSync } from "node:fs";

const unresolvedPatterns = [
  /beta draft/i,
  /draft (?:explains|terms|notice)/i,
  /before (?:a )?public launch/i,
  /still need(?:s)? (?:to be )?(?:confirmed|reviewed)/i,
  /still to be confirmed/i,
  /final legal review/i,
  /must be reviewed/i,
];

export function unresolvedLegalSourceFiles(files) {
  return files
    .filter((file) => unresolvedPatterns.some((pattern) => pattern.test(file.source)))
    .map((file) => file.name);
}

export function legalSourceReadiness() {
  const files = [
    ["LegalPage.tsx", new URL("../src/app/legal/LegalPage.tsx", import.meta.url)],
    ["privacy/page.tsx", new URL("../src/app/legal/privacy/page.tsx", import.meta.url)],
    ["terms/page.tsx", new URL("../src/app/legal/terms/page.tsx", import.meta.url)],
    ["non-affiliation/page.tsx", new URL("../src/app/legal/non-affiliation/page.tsx", import.meta.url)],
  ].map(([name, url]) => ({ name, source: readFileSync(url, "utf8") }));
  const unresolvedFiles = unresolvedLegalSourceFiles(files);

  return {
    ok: unresolvedFiles.length === 0,
    unresolvedFiles,
  };
}
