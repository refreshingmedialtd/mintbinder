export function smtpSecurityOptions(portValue, secureValue) {
  const port = Number(portValue);
  const normalized = String(secureValue ?? "").trim().toLowerCase();
  if (!Number.isInteger(port) || (port !== 465 && port !== 587)) {
    throw new Error("SMTP_PORT must be 465 for implicit TLS or 587 for STARTTLS.");
  }
  if (normalized !== "true" && normalized !== "false") {
    throw new Error("SMTP_SECURE must be exactly true or false.");
  }
  const secure = normalized === "true";
  if ((port === 465) !== secure) {
    throw new Error("SMTP_SECURE must be true on port 465 and false on port 587.");
  }

  return {
    requireTLS: !secure,
    secure,
    tls: { minVersion: "TLSv1.2" },
  };
}
