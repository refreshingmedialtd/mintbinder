export function smtpSecurityOptions(port: number, secureValue: string | undefined) {
  const normalized = secureValue?.trim().toLowerCase();
  if (normalized !== "true" && normalized !== "false") {
    throw new Error("SMTP_SECURE must be exactly true or false.");
  }
  if (port !== 465 && port !== 587) {
    throw new Error("SMTP_PORT must be 465 for implicit TLS or 587 for STARTTLS.");
  }

  const secure = normalized === "true";
  if ((port === 465) !== secure) {
    throw new Error("SMTP_SECURE must be true on port 465 and false on port 587.");
  }

  return {
    requireTLS: !secure,
    secure,
    tls: { minVersion: "TLSv1.2" as const },
  };
}
