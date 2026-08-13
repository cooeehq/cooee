import type { PullRequestMetadata, SanitizedPullRequest } from "./types";

export type PullRequestFilterOptions = {
  skipLabels: string[];
  sensitiveLabels: string[];
};

export type HeldPullRequest = {
  pr: PullRequestMetadata;
  reason: "skip-label" | "sensitive-label" | "sensitive-content";
  matchedLabel?: string;
};

const DEFAULT_SECRET_PATTERNS = [
  /\b(?:authorization:\s*bearer)\s+[a-z0-9._~+/=-]+/i,
  /\b((?:[a-z0-9_]*)(?:token|secret|password|api_key|apikey|private_key|database_url)(?:[a-z0-9_]*))\s*[:=]\s*([^\s'"]+)/i,
  /\bgh[pousr]_[a-z0-9_]{20,}\b/i,
  /\bgithub_pat_[a-z0-9_]{40,}\b/i,
  /\bsk-[a-z0-9_-]{16,}\b/i,
  /\b(?:sk|rk)_(?:live|test)_[a-z0-9]{16,}\b/i,
  /\bwhsec_[a-z0-9]{16,}\b/i,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bglpat-[a-z0-9_-]{20,}\b/i,
  /\bxox[baprs]-[a-z0-9-]{10,}\b/i,
  /\bnpm_[a-z0-9]{20,}\b/i,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i,
];

const PROMPT_INJECTION_PATTERNS = [
  /\b(?:ignore|disregard|override|forget)\b.{0,80}\b(?:previous|prior|above|system|developer)\b.{0,40}\b(?:instruction|prompt|message|rule)s?\b/i,
  /\b(?:system|developer)\s+(?:prompt|message|instruction)s?\b/i,
  /\b(?:reveal|print|repeat|expose|publish)\b.{0,80}\b(?:system prompt|private detail|secret|credential|other pull request)s?\b/i,
  /\b(?:jailbreak|prompt injection)\b/i,
];

const SENSITIVE_CONTENT_PATTERNS = [
  /\btrade secret\b/i,
  /\bprivate key\b/i,
  /\bcredential\b/i,
  /\bsecurity vulnerability\b/i,
  /\bexploit\b/i,
  /\bCVE-\d{4}-\d{4,}\b/i,
  /\bpassword\b/i,
  /\bapi[_ -]?key\b/i,
];

const STREET_SUFFIX_PATTERN =
  "road|rd|street|st|avenue|ave|drive|dr|lane|ln|court|ct|place|pl|terrace|tce|boulevard|blvd|crescent|cres|highway|hwy|parade|pde|close|cl|circuit|cct|way|circle|cir|square|sq|route|rte|parkway|pkwy|alley|allee|trail|trl|rue|calle|strasse|straße|str|via|viale|chemin|quai|impasse|chaussee|chausee";

const PII_CONTENT_PATTERNS = [
  // Email addresses and common personal contact details.
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b/,

  // Payment, government, and tax identifiers that should never appear in a
  // customer-facing changelog.
  /\b(?:\d[ -]*?){13,19}\b/,
  /\b(?:ssn|social security number|tax file number|national insurance number|passport number|driver'?s licence|driver'?s license)\s*[:#-]?\s*[A-Z0-9 -]{4,}\b/i,
  /\b\d{3}-\d{2}-\d{4}\b/,

  // Physical mailing addresses across common formats. This is intentionally
  // conservative: a street number plus a recognizable address token, or a PO box.
  new RegExp(
    String.raw`\b\d{1,6}[a-z]?(?:\s*[-/]\s*\d{1,6}[a-z]?)?\s+[\p{L}0-9][\p{L}0-9.'’ -]{1,80}\s+(?:${STREET_SUFFIX_PATTERN})\b(?:[,\s]+[\p{L}.'’ -]{2,80}){0,3}(?:[,\s]+[A-Z]{2,3})?(?:[,\s]+[A-Z0-9][A-Z0-9 -]{2,10})?`,
    "iu",
  ),
  /\bP\.?\s*O\.?\s*Box\s+\d+[A-Z0-9 -]*(?:,\s*[\p{L}.'’ -]{2,80})?(?:\s+[A-Z0-9][A-Z0-9 -]{2,10})?\b/iu,

  // Latitude/longitude pairs can disclose a user's home or movement history.
  /\b-?(?:[1-8]?\d\.\d{3,}|90\.0{3,}),\s*-?(?:1[0-7]\d\.\d{3,}|[1-9]?\d\.\d{3,}|180\.0{3,})\b/,
];

export function filterPublishablePullRequests(
  pullRequests: PullRequestMetadata[],
  options: PullRequestFilterOptions,
): { publishable: PullRequestMetadata[]; held: HeldPullRequest[] } {
  const skipLabels = new Set(options.skipLabels.map(normalizeLabel));
  const sensitiveLabels = new Set(options.sensitiveLabels.map(normalizeLabel));
  const publishable: PullRequestMetadata[] = [];
  const held: HeldPullRequest[] = [];

  for (const pr of pullRequests) {
    const labels = pr.labels.map(normalizeLabel);

    const skipLabel = labels.find((label) => skipLabels.has(label));
    if (skipLabel) {
      held.push({ pr, reason: "skip-label", matchedLabel: skipLabel });
      continue;
    }

    const sensitiveLabel = labels.find((label) => sensitiveLabels.has(label));
    if (sensitiveLabel) {
      held.push({
        pr,
        reason: "sensitive-label",
        matchedLabel: sensitiveLabel,
      });
      continue;
    }

    if (
      containsSensitiveContent(
        `${pr.title}\n${pr.body}\n${pr.labels.join("\n")}`,
      )
    ) {
      held.push({ pr, reason: "sensitive-content" });
      continue;
    }

    publishable.push(pr);
  }

  return { publishable, held };
}

export function sanitizePullRequest(
  pr: PullRequestMetadata,
): SanitizedPullRequest {
  return {
    id: pr.id,
    number: pr.number,
    title: sanitizeText(pr.title),
    body: sanitizeBody(pr.body),
    labels: pr.labels.map(sanitizeText),
    mergedAt: pr.mergedAt,
    url: stripQueryString(pr.url),
    repository: pr.repository,
  };
}

export function sanitizeBody(body: string): string {
  return sanitizeText(body)
    .replace(/```[\s\S]*?```/g, "[code removed]")
    .split("\n")
    .map((line) => {
      if (/^\s*(debug|trace|info|warn|error)\b/i.test(line)) {
        return "[log removed]";
      }

      return line;
    })
    .join("\n")
    .replace(/\[log removed\](?:\n\[log removed\])+/g, "[log removed]")
    .trim();
}

export function sanitizeText(value: string): string {
  let sanitized = value.replace(
    /\b(?:authorization:\s*bearer)\s+[a-z0-9._~+/=-]+/gi,
    "Authorization: Bearer [redacted]",
  );

  sanitized = sanitized.replace(
    /\b((?:[a-z0-9_]*)(?:token|secret|password|api_key|apikey|private_key|database_url)(?:[a-z0-9_]*))\s*[:=]\s*([^\s'"]+)/gi,
    (_match, key: string) => `${key}=[redacted]`,
  );

  sanitized = sanitized.replace(/\bgh[pousr]_[a-z0-9_]{20,}\b/gi, "[redacted]");
  sanitized = sanitized.replace(
    /\bgithub_pat_[a-z0-9_]{40,}\b/gi,
    "[redacted]",
  );
  sanitized = sanitized.replace(/\bsk-[a-z0-9_-]{16,}\b/gi, "[redacted]");
  sanitized = sanitized.replace(
    /\b(?:sk|rk)_(?:live|test)_[a-z0-9]{16,}\b/gi,
    "[redacted]",
  );
  sanitized = sanitized.replace(/\bwhsec_[a-z0-9]{16,}\b/gi, "[redacted]");
  sanitized = sanitized.replace(/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "[redacted]");
  sanitized = sanitized.replace(/\bglpat-[a-z0-9_-]{20,}\b/gi, "[redacted]");
  sanitized = sanitized.replace(
    /\bxox[baprs]-[a-z0-9-]{10,}\b/gi,
    "[redacted]",
  );
  sanitized = sanitized.replace(/\bnpm_[a-z0-9]{20,}\b/gi, "[redacted]");
  sanitized = sanitized.replace(
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/gi,
    "[private key removed]",
  );
  sanitized = sanitized.replace(/https?:\/\/[^\s)]+/g, (url) =>
    stripQueryString(url),
  );

  return sanitized.trim();
}

export function containsSensitiveContent(value: string): boolean {
  return (
    SENSITIVE_CONTENT_PATTERNS.some((pattern) => pattern.test(value)) ||
    containsPersonallyIdentifiableContent(value) ||
    containsSecretContent(value) ||
    PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(value))
  );
}

export function containsSecretContent(value: string): boolean {
  return DEFAULT_SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

export function containsPersonallyIdentifiableContent(value: string): boolean {
  return PII_CONTENT_PATTERNS.some((pattern) => pattern.test(value));
}

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase();
}

function stripQueryString(value: string): string {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.replace(/[?#].*$/, "");
  }
}
