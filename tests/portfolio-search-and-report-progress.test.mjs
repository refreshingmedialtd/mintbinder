import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pageSource = readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
const styleSource = readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");

test("Portfolio search carries a trimmed card query into the catalogue screen", async () => {
  const page = await pageSource;
  const dashboard = page.slice(
    page.indexOf("function DashboardScreen("),
    page.indexOf("function PortfolioHero(", page.indexOf("function DashboardScreen(")),
  );

  assert.match(dashboard, /function searchCardCatalogue\(event: FormEvent<HTMLFormElement>\)/);
  assert.match(dashboard, /const query = portfolioCardSearch\.trim\(\)/);
  assert.match(dashboard, /setAddSearch\(query\)/);
  assert.match(dashboard, /addType: "card"/);
  assert.match(dashboard, /screen: "add"/);
  assert.match(dashboard, /role="search"/);
  assert.match(dashboard, /aria-label="Search the card catalogue"/);

  const styles = await styleSource;
  const tabletRules = styles.slice(styles.indexOf("@media (min-width: 760px) {"), styles.indexOf("@media (min-width: 1080px) {"));
  const desktopRules = styles.slice(styles.indexOf("@media (min-width: 1080px) {"), styles.indexOf("@media (max-width: 759px) {"));
  assert.doesNotMatch(tabletRules, /\.portfolio-card-search\s*\{[\s\S]*?grid-template-columns/);
  assert.match(desktopRules, /\.portfolio-card-search\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,/);
});

test("Insurance export visibly stays busy and cannot be started twice", async () => {
  const page = await pageSource;
  const panel = page.slice(
    page.indexOf("function DataPanel("),
    page.indexOf("function ImportPreview", page.indexOf("function DataPanel(")),
  );

  assert.match(panel, /const \[isExportingInsurance, setIsExportingInsurance\] = useState\(false\)/);
  assert.match(panel, /if \(isExportingInsurance\)/);
  assert.match(panel, /await onExportInsuranceReport\(\)/);
  assert.match(panel, /finally \{\s*setIsExportingInsurance\(false\)/);
  assert.match(panel, /aria-busy=\{isExportingInsurance\}/);
  assert.match(panel, /disabled=\{isExportingInsurance\}/);
  assert.match(panel, /Building report…/);
  assert.match(panel, /role="status"/);
});
