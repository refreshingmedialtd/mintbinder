import type { Metadata } from "next";
import { LegalPage, legalBusinessName, legalContact, legalProductName } from "../LegalPage";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: `${legalProductName} beta terms of use.`,
  alternates: { canonical: "/legal/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Use"
      intro={`These draft terms describe how ${legalProductName} should be used during beta. They need final legal review before a public launch or paid production rollout.`}
      sections={[
        {
          title: "About the service",
          body: (
            <>
              <p>
                {legalProductName} is a working-title collection tracking app operated by {legalBusinessName}. It helps
                users record Pokemon cards and sealed products, wishlist targets, storage details, market estimates,
                alerts, reports, and subscription status.
              </p>
              <p>The product name, domain, support address, legal entity details, and final launch policies are still to be confirmed.</p>
            </>
          ),
        },
        {
          title: "Beta status",
          body: (
            <>
              <p>This beta may contain incomplete data, catalogue gaps, pricing gaps, test integrations, and interface changes. Features may change or be removed while we improve the product.</p>
              <p>Do not rely on beta data as a complete inventory, insurance valuation, financial record, or tax record unless you have independently checked it.</p>
            </>
          ),
        },
        {
          title: "Accounts and acceptable use",
          body: (
            <>
              <p>You are responsible for keeping your login details secure and for the information you add to your account. You must not misuse the service, attempt to access data belonging to another user, overload import jobs, bypass subscription controls, or upload unlawful or harmful content.</p>
              <p>We may suspend access if an account creates security, operational, legal, or payment risk.</p>
            </>
          ),
        },
        {
          title: "Collection and pricing data",
          body: (
            <>
              <p>Catalogue, image, variant, and market-price data can come from third-party providers and may be incomplete, delayed, inaccurate, or unavailable. Values are estimates only.</p>
              <p>You should verify prices, variants, card condition, sale proceeds, and insurance values before making buying, selling, grading, tax, or insurance decisions.</p>
            </>
          ),
        },
        {
          title: "Subscriptions and payments",
          body: (
            <>
              <p>The intended paid plan is a low-price Plus subscription with monthly and yearly options. Square is the active payment provider for sandbox and planned launch preparation.</p>
              <p>Subscriptions should be cancellable from the app where supported. Cancellation should stop renewal while keeping paid access until the end of the current paid period. Final refund, VAT/tax, and invoice wording must be confirmed before launch.</p>
            </>
          ),
        },
        {
          title: "Exports, reports, and alerts",
          body: (
            <>
              <p>Exports, insurance reports, price alerts, and wishlist notifications are convenience tools. They may fail, be delayed, or include missing provider data.</p>
              <p>You remain responsible for checking exported information before sharing it with insurers, buyers, accountants, or other third parties.</p>
              <p>Signed-in users can download a structured account-data export and request permanent account deletion through the account tools. Deletion requires password reauthentication and explicit confirmation, and an active paid subscription must be cancelled as part of, or before, the request.</p>
            </>
          ),
        },
        {
          title: "Intellectual property",
          body: (
            <>
              <p>{legalBusinessName} owns or licenses the app interface, code, reports, and original product content. Pokemon-related names, images, card text, set names, and trademarks belong to their respective owners.</p>
              <p>See the non-affiliation page for the current brand-safety wording.</p>
            </>
          ),
        },
        {
          title: "Liability and availability",
          body: (
            <>
              <p>The service is provided on a beta basis and may be interrupted for maintenance, imports, provider outages, or fixes. We will take reasonable care with the service but cannot promise uninterrupted access or perfect data.</p>
              <p>The final limitation-of-liability wording must be reviewed before paid public launch.</p>
            </>
          ),
        },
        {
          title: "Contact",
          body: (
            <p>
              Beta support and legal contact details are still to be confirmed. Temporary contact: {legalContact}.
            </p>
          ),
        },
      ]}
    />
  );
}
