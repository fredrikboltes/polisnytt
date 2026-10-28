export const NIGHT_SUMMARY_TYPE: string;
export const MAX_POLICE_FEED_ATTEMPTS: number;

export function isNightSummaryOnlyFeed(events: unknown): boolean;

export function fetchPoliceFeed(
  locationName?: string,
  options?: {
    fetchImpl?: typeof fetch;
    attempts?: number;
  },
): Promise<unknown[]>;
