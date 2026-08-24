import { VerifyEmailConfirmation } from "./verify-email-confirmation";
import { accountTokenPageMetadata } from "@/lib/auth/token-links";

export const dynamic = "force-dynamic";
export const metadata = accountTokenPageMetadata;

export default function VerifyEmailPage() {
  return <VerifyEmailConfirmation />;
}
