export function priceAlertScheduleSettings(env?: Record<string, string | undefined>): {
  allowLiveRecipients: boolean;
  dryRun: boolean;
  emailConfigured: boolean;
  mode: "blocked" | "dry_run" | "live_recipients" | "live_test";
  ok: boolean;
  problems: string[];
  testRecipient?: string;
  testRecipientConfigured: boolean;
};
