type SquareCheckoutEnvironment = Record<string, string | undefined>;

export function squarePublicCheckoutIsEnabled(
  env: SquareCheckoutEnvironment = process.env,
) {
  return env.SQUARE_PAYMENT_CORRELATION_VERIFIED?.trim().toLowerCase() === "true"
    && env.SQUARE_ENVIRONMENT?.trim().toLowerCase() === "production";
}
