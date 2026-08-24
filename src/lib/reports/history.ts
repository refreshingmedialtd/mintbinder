import type { CollectionEvent } from "../types.ts";

export function boundedInsuranceHistory(events: CollectionEvent[], limit = 500) {
  if (events.length <= limit) {
    return { events, notice: undefined };
  }

  return {
    events: events.slice(0, limit),
    notice: `Showing the ${limit} most recent sales, removals and grading events. Older history is available in the account export.`,
  };
}
