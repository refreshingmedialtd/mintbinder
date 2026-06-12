import { NextResponse } from "next/server";
import { jobErrorStatus, requireJobSecret } from "@/lib/jobs/auth";
import { sendEmail } from "@/lib/notifications/email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    requireJobSecret(request);

    const to = process.env.EMAIL_SMOKE_TO?.trim();
    if (!to) {
      throw new Error("EMAIL_SMOKE_TO is not configured.");
    }

    const body = (await request.json().catch(() => ({}))) as {
      note?: string;
      subject?: string;
    };
    const sentAt = new Date().toISOString();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() ?? new URL(request.url).origin;
    const subject = body.subject?.trim() || `Mint Binder production email smoke - ${sentAt}`;
    const note = body.note?.trim();
    const sent = await sendEmail({
      idempotencyKey: `mintbinder-production-email-smoke-${sentAt}`,
      subject,
      to,
      text: [
        "Mint Binder production email delivery is configured.",
        "",
        `App URL: ${appUrl}`,
        `Sent at: ${sentAt}`,
        note ? `Note: ${note}` : undefined,
      ].filter(Boolean).join("\n"),
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;">
          <h1 style="font-size:20px;margin:0 0 12px;">Mint Binder production email delivery is configured.</h1>
          <p>The deployed app can send transactional email.</p>
          <p><strong>App URL:</strong> ${escapeHtml(appUrl)}</p>
          <p><strong>Sent at:</strong> ${escapeHtml(sentAt)}</p>
          ${note ? `<p><strong>Note:</strong> ${escapeHtml(note)}</p>` : ""}
        </div>
      `,
    });

    return NextResponse.json({
      ok: true,
      emailId: sent.id,
      provider: process.env.EMAIL_PROVIDER?.trim() || "auto",
      sentAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to run email smoke test.";

    return NextResponse.json({ error: message }, { status: jobErrorStatus(error) });
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (match) => {
    switch (match) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
