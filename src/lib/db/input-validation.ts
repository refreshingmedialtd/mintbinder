export const PERSISTED_INPUT_LIMITS = Object.freeze({
  catalogueId: 100,
  name: 160,
  notes: 2_000,
  saleNotes: 1_000,
  storageName: 80,
  storageNotes: 1_000,
  valuationNote: 1_000,
  variant: 80,
  wishlistNotes: 1_000,
});

const POSTGRES_INT_MAX = 2_147_483_647;

export class PersistedInputError extends Error {
  status = 400;

  constructor(message: string) {
    super(message);
    this.name = "PersistedInputError";
  }
}

export function boundedOptionalText(
  value: unknown,
  label: string,
  maxLength: number,
) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new PersistedInputError(`${label} must be text.`);

  const text = value.trim();
  if (!text) return undefined;
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)) {
    throw new PersistedInputError(`${label} contains unsupported control characters.`);
  }
  if (text.length > maxLength) {
    throw new PersistedInputError(`${label} must be ${maxLength.toLocaleString("en-GB")} characters or fewer.`);
  }
  return text;
}

export function boundedRequiredText(
  value: unknown,
  label: string,
  maxLength: number,
) {
  const text = boundedOptionalText(value, label, maxLength);
  if (!text) throw new PersistedInputError(`${label} is required.`);
  return text;
}

export function moneyInputToMinor(value: unknown, label = "Amount") {
  if (value === undefined || value === null || value === "") return undefined;

  let amount: number;
  if (typeof value === "number") {
    amount = value;
    if (!Number.isFinite(amount) || amount < 0) {
      throw new PersistedInputError(`${label} must be a non-negative amount with at most two decimal places.`);
    }
  } else if (typeof value === "string") {
    const text = value.trim();
    if (!text) return undefined;
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text)) {
      throw new PersistedInputError(`${label} must be a non-negative amount with at most two decimal places.`);
    }
    amount = Number(text);
  } else {
    throw new PersistedInputError(`${label} must be a non-negative amount with at most two decimal places.`);
  }

  const exactMinor = amount * 100;
  const minor = Math.round(exactMinor);
  if (!Number.isSafeInteger(minor) || Math.abs(exactMinor - minor) > 1e-7 || minor > POSTGRES_INT_MAX) {
    throw new PersistedInputError(`${label} is outside the supported range or has more than two decimal places.`);
  }
  return minor;
}
