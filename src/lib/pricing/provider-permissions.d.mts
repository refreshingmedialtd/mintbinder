export function priceChartingLicenceConfirmed(env?: NodeJS.ProcessEnv): boolean;
export function customerVisiblePriceSource(source: unknown, env?: NodeJS.ProcessEnv): boolean;
export function assertPriceChartingWriteAllowed(options: {
  licenceConfirmed?: boolean;
  writePrices?: boolean;
}): void;
