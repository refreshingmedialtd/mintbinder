import Link from "next/link";
import type { ReactNode } from "react";

type LegalSection = {
  title: string;
  body: ReactNode;
};

export const legalLastUpdated = "10 June 2026";
export const legalProductName = "Mint Binder";
export const legalBusinessName = "Refreshing Media";
export const legalContact = "support@mintbinder.co.uk";

export function LegalPage({
  children,
  intro,
  sections,
  title,
}: {
  children?: ReactNode;
  intro: ReactNode;
  sections: LegalSection[];
  title: string;
}) {
  return (
    <main className="legal-shell">
      <article className="legal-page">
        <nav className="legal-nav" aria-label="Legal pages">
          <Link href="/">Back to app</Link>
          <span />
          <Link href="/legal/privacy">Privacy</Link>
          <Link href="/legal/terms">Terms</Link>
          <Link href="/legal/non-affiliation">Non-affiliation</Link>
        </nav>
        <header className="legal-header">
          <span className="tag amber">Beta draft</span>
          <h1>{title}</h1>
          <p>{intro}</p>
          <p className="muted">Last updated: {legalLastUpdated}. This page must be reviewed and updated before public launch.</p>
        </header>
        {children}
        <div className="legal-section-list">
          {sections.map((section) => (
            <section className="tool-panel legal-section" key={section.title}>
              <h2>{section.title}</h2>
              {section.body}
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}
