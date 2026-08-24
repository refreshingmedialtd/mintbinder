import { handleSquareBillingWebhook } from "@/lib/billing/webhook-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = handleSquareBillingWebhook;
