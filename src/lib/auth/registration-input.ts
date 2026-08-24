export const ACCOUNT_EMAIL_MAX_LENGTH = 254;
export const ACCOUNT_EMAIL_LOCAL_PART_MAX_LENGTH = 64;
export const ACCOUNT_DISPLAY_NAME_MAX_LENGTH = 80;

const EMAIL_LOCAL_PART_PATTERN = /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/i;
const EMAIL_DOMAIN_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export type NormalizedDisplayName = {
  valid: boolean;
  value: string | null;
};

export function normalizeAccountEmail(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > ACCOUNT_EMAIL_MAX_LENGTH) {
    return null;
  }

  if (value !== value.trim() || /\s/.test(value)) {
    return null;
  }

  const email = value.toLowerCase();
  const separator = email.indexOf("@");

  if (separator <= 0 || separator !== email.lastIndexOf("@")) {
    return null;
  }

  const localPart = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  const labels = domain.split(".");

  if (
    localPart.length > ACCOUNT_EMAIL_LOCAL_PART_MAX_LENGTH ||
    localPart.startsWith(".") ||
    localPart.endsWith(".") ||
    localPart.includes("..") ||
    !EMAIL_LOCAL_PART_PATTERN.test(localPart) ||
    labels.length < 2 ||
    labels.some((label) => !EMAIL_DOMAIN_LABEL_PATTERN.test(label))
  ) {
    return null;
  }

  return email;
}

export function normalizeAccountDisplayName(value: unknown): NormalizedDisplayName {
  if (value === undefined || value === null || value === "") {
    return { valid: true, value: null };
  }

  if (typeof value !== "string") {
    return { valid: false, value: null };
  }

  if (/[\u0000-\u001f\u007f]/.test(value)) {
    return { valid: false, value: null };
  }

  const name = value.trim();

  if (!name) {
    return { valid: true, value: null };
  }

  if (name.length > ACCOUNT_DISPLAY_NAME_MAX_LENGTH) {
    return { valid: false, value: null };
  }

  return { valid: true, value: name };
}
