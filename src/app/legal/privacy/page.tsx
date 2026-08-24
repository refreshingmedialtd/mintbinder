import type { Metadata } from "next";
import { LegalPage, legalBusinessName, legalContact, legalProductName } from "../LegalPage";

export const metadata: Metadata = {
  title: "Privacy Notice",
  description: `${legalProductName} beta privacy notice.`,
  alternates: { canonical: "/legal/privacy" },
};

export default function PrivacyNoticePage() {
  return (
    <LegalPage
      title="Privacy Notice"
      intro={`${legalProductName} is a collection tracker for Pokemon cards and sealed products. This draft explains how ${legalBusinessName} expects to handle personal data during the beta.`}
      sections={[
        {
          title: "Who controls your data",
          body: (
            <>
              <p>
                The intended controller is {legalBusinessName}. The final legal entity, registered address, and any
                required data-protection registration details still need to be confirmed before public launch.
              </p>
              <p className="muted">Contact for beta privacy requests: {legalContact}.</p>
            </>
          ),
        },
        {
          title: "Data we expect to collect",
          body: (
            <>
              <p>During beta, the service may collect and store:</p>
              <ul>
                <li>Account details such as name, email address, password hash, role, and subscription state.</li>
                <li>Collection, wishlist, storage, sale, grading, valuation-note, and import/export data you add.</li>
                <li>Notification preferences and price-alert delivery status.</li>
                <li>Payment and subscription identifiers from Square. Full card details are handled by Square, not by this app.</li>
                <li>Operational records such as job runs, error logs, timestamps, basic security/audit events, and password-reset outbox status. Unknown reset addresses are represented by a keyed pseudonymous value; their raw address is not retained in the outbox.</li>
              </ul>
            </>
          ),
        },
        {
          title: "How we use the data",
          body: (
            <>
              <p>We use the data to provide and improve the collection tracker, including account access, collection storage, valuation features, wishlist alerts, Plus subscription management, support, fraud prevention, and operational reliability.</p>
              <p>Pricing and catalogue data is used to estimate values. It should not be treated as financial advice or a guaranteed sale price.</p>
            </>
          ),
        },
        {
          title: "Legal bases",
          body: (
            <>
              <p>The expected UK GDPR bases are contract for providing the service, legitimate interests for product safety and improvement, consent where optional emails or marketing require it, and legal obligation where records must be kept for accounting or compliance.</p>
              <p>This section needs final review once hosting, email, analytics, and production payment providers are confirmed.</p>
            </>
          ),
        },
        {
          title: "Sharing and processors",
          body: (
            <>
              <p>We expect to share limited data with service providers that help run the product, such as hosting/database providers, Square for payments, an email provider for notifications, and error-monitoring tools if configured.</p>
              <p>Pokemon catalogue and pricing providers may be used to retrieve card, sealed-product, image, and market data. These providers do not need your personal collection data to perform those lookups.</p>
            </>
          ),
        },
        {
          title: "Retention and deletion",
          body: (
            <>
              <p>Signed-in users can download a structured copy of their account, collection, wishlist, storage, subscription, preference, and binder data from the account tools.</p>
              <p>Account deletion is also available from the account tools and requires the account email, password, and an explicit confirmation phrase. Mint Binder cancels the exact Square subscription identifiers recorded for the account. A Square customer profile is deleted only when Mint Binder created that profile; a pre-existing profile matched by Square hosted checkout is retained so unrelated customer history is not removed. Square may retain transaction, invoice, dispute, or compliance records under its own legal obligations and privacy terms. Deleting the local account removes the user record together with linked collection, wishlist, storage, preference, subscription, binder, event, and account-token records. Private and pending-review user-created sealed products are deleted. Global catalogue contributions are retained for other users without the creator link or free-form notes; non-personal product and provider metadata is preserved.</p>
              <p>Separate operational records use configurable retention windows. Current cleanup defaults make account-link tokens eligible 30 days after expiry, inactive authentication throttles 30 days after their last update, terminal checkout-attempt records 730 days after their last update, completed job records 365 days after finishing, completed billing-webhook records 730 days after processing, successfully sent notification-delivery claims 365 days after their last update, and sent or discarded password-reset outbox rows 365 days after their last update. Checkout-attempt retention has a configurable 90-day floor and is never shorter than billing-webhook retention. Live or ambiguous checkout attempts, claimed or ambiguous notification deliveries, queued, claimed, or unresolved password-reset rows, active blocks, processing webhooks, and running jobs are excluded from routine cleanup so they can be reconciled safely. These settings may be extended where payment, accounting, dispute, fraud-prevention, or legal requirements call for longer retention.</p>
              <p>The retention schedule and this draft notice still need review before public launch.</p>
            </>
          ),
        },
        {
          title: "Your rights",
          body: (
            <>
              <p>Depending on your location, you may have rights to access, correct, erase, restrict, object to, or receive a copy of your personal data. UK users can also raise concerns with the ICO.</p>
              <p>Beta requests should be sent to {legalContact} until the final support address is chosen.</p>
            </>
          ),
        },
        {
          title: "Cookies and local storage",
          body: (
            <>
              <p>The app uses essential authentication/session storage and may use local storage for interface preferences such as theme selection. Non-essential analytics or marketing cookies should not be enabled until consent handling is implemented.</p>
            </>
          ),
        },
      ]}
    />
  );
}
