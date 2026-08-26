const COMMON_PASSWORDS = new Set([
  "123456789012",
  "111111111111",
  "aaaaaaaaaaaa",
  "adminadminadmin",
  "changeme1234",
  "iloveyou1234",
  "letmein12345",
  "password1234",
  "password123!",
  "pokemon12345",
  "qwerty123456",
  "qwertyuiop12",
  "letmeinplease",
  "mintbinder2026!",
  "welcome12345",
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

  const normalized = password.normalize("NFKC").trim().toLowerCase();

  if (COMMON_PASSWORDS.has(normalized) || /^(.)\1{11,}$/.test(normalized)) {
    return "Choose a less predictable password.";
  }

  return null;
}
