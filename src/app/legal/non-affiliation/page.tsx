import type { Metadata } from "next";
import { LegalPage, legalBusinessName, legalProductName } from "../LegalPage";

export const metadata: Metadata = {
  title: `Non-Affiliation Notice | ${legalProductName}`,
  description: `${legalProductName} Pokemon brand and intellectual-property notice.`,
};

export default function NonAffiliationPage() {
  return (
    <LegalPage
      title="Non-Affiliation Notice"
      intro={`${legalProductName} is an independent collection tracker. Its brand treatment and legal wording should be reviewed before public launch.`}
      sections={[
        {
          title: "Independent product",
          body: (
            <p>
              {legalProductName} is not affiliated with, endorsed by, sponsored by, approved by, or connected to The
              Pokemon Company, Nintendo, Creatures Inc., GAME FREAK inc., or any of their subsidiaries or affiliates.
            </p>
          ),
        },
        {
          title: "Trademarks and copyrights",
          body: (
            <>
              <p>Pokemon, Pokemon TCG, card names, set names, character names, product names, logos, artwork, and other related marks or assets are the property of their respective owners.</p>
              <p>Use of Pokemon-related references in the app is intended only to identify collection items, organise personal inventories, and display catalogue information for collectors.</p>
            </>
          ),
        },
        {
          title: "Images and catalogue data",
          body: (
            <>
              <p>Card and sealed-product images may be loaded from third-party catalogue or pricing providers where permitted by their terms. Missing images, placeholder art, and provider attribution rules must be reviewed before launch.</p>
              <p>The app should not imply ownership of official Pokemon artwork or product photography.</p>
            </>
          ),
        },
        {
          title: "No official marketplace",
          body: (
            <p>
              {legalProductName} does not sell official Pokemon products, issue official prices, authenticate cards, or
              operate as an official Pokemon marketplace. Values and alerts are collector tools only.
            </p>
          ),
        },
        {
          title: "Brand review",
          body: (
            <p>
              Before public launch, the app needs a brand review, trademark search, final non-affiliation wording, and
              replacement of any visual treatment that creates unnecessary confusion with official Pokemon products or
              services.
            </p>
          ),
        },
        {
          title: "Operator",
          body: (
            <p>
              The planned operator is {legalBusinessName}. Final company, address, support, and legal-contact details
              must be added before launch.
            </p>
          ),
        },
      ]}
    />
  );
}
