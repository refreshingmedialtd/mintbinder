/**
 * Builds punctuation-independent collector-number search terms. Providers do
 * not agree on zero padding, so index both sides at their widest known width:
 * `1` in a 142-card set becomes `001/142`, while `061` in a 78-card set also
 * exposes the provider-style `061/078` reference.
 */
export function catalogueCollectorNumberSearchTerms(
  number?: string,
  ...denominators: Array<number | null | undefined>
) {
  const rawNumber = number?.trim();

  if (!rawNumber) {
    return [];
  }

  const numerator = rawNumber.split("/")[0];
  const terms = new Set([rawNumber, numerator]);

  for (const denominator of denominators) {
    if (!Number.isInteger(denominator) || Number(denominator) <= 0) {
      continue;
    }

    const denominatorText = String(denominator);
    const numericReference = /^\d+$/u.test(numerator);
    const referenceWidth = Math.max(numerator.length, denominatorText.length);
    const paddedNumerator = numericReference
      ? numerator.padStart(referenceWidth, "0")
      : numerator;
    const paddedDenominator = numericReference
      ? denominatorText.padStart(referenceWidth, "0")
      : denominatorText;

    terms.add(denominatorText);
    terms.add(paddedNumerator);
    terms.add(paddedDenominator);
    terms.add(`${numerator}/${denominatorText}`);
    terms.add(`${paddedNumerator}/${paddedDenominator}`);
  }

  return [...terms];
}
