const COMMON_PASSWORDS = new Set([
  "password1234",
  "password123!",
  "qwertyuiop12",
  "letmeinplease",
  "mintbinder2026!",
]);

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export function passwordPolicyError(password: string) {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must contain at least ${PASSWORD_MIN_LENGTH} characters.`;
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must contain no more than ${PASSWORD_MAX_LENGTH} characters.`;
  }

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return "Choose a less predictable password.";
  }

  return null;
}
