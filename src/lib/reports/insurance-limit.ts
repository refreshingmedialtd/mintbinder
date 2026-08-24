export const MAX_INSURANCE_REPORT_LOTS = 2_000;

export class InsuranceReportTooLargeError extends Error {
  status = 413;

  constructor(count: number, maximum = MAX_INSURANCE_REPORT_LOTS) {
    super(
      `This collection has ${count.toLocaleString("en-GB")} active lots; the synchronous insurance report limit is ` +
      `${maximum.toLocaleString("en-GB")}. Export the collection CSV or account JSON instead.`,
    );
    this.name = "InsuranceReportTooLargeError";
  }
}

export function assertInsuranceReportLotLimit(
  count: number,
  maximum = MAX_INSURANCE_REPORT_LOTS,
) {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("Insurance report lot count is invalid.");
  }
  if (count > maximum) throw new InsuranceReportTooLargeError(count, maximum);
}
