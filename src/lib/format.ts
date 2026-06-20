export function formatMoney(valueMinor?: number | null) {
  if (valueMinor === null || valueMinor === undefined) {
    return "Unknown";
  }

  return `\u00a3${(valueMinor / 100).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function completionPercent(owned: number, total: number) {
  if (total === 0) {
    return 0;
  }

  return Math.round((owned / total) * 100);
}
