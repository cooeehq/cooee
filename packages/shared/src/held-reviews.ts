const dayInMilliseconds = 24 * 60 * 60 * 1000;

export const heldReviewRetentionDays = 30;
export const heldReviewRetentionMilliseconds =
  heldReviewRetentionDays * dayInMilliseconds;

export function getHeldReviewExpiry(
  processedAt: string | null | undefined,
): Date | null {
  if (!processedAt) {
    return null;
  }

  const processedAtTimestamp = Date.parse(processedAt);
  if (!Number.isFinite(processedAtTimestamp)) {
    return null;
  }

  return new Date(processedAtTimestamp + heldReviewRetentionMilliseconds);
}

export function getHeldReviewDaysRemaining(
  processedAt: string | null | undefined,
  now: Date = new Date(),
): number | null {
  const expiresAt = getHeldReviewExpiry(processedAt);
  if (!expiresAt) {
    return null;
  }

  return Math.max(
    0,
    Math.ceil((expiresAt.getTime() - now.getTime()) / dayInMilliseconds),
  );
}

export function getHeldReviewExpiryCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - heldReviewRetentionMilliseconds);
}
