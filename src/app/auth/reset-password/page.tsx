import { ResetPasswordForm } from "./reset-password-form";
import { accountTokenPageMetadata } from "@/lib/auth/token-links";

export const dynamic = "force-dynamic";
export const metadata = accountTokenPageMetadata;

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
