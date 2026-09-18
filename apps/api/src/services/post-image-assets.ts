import { createHash } from "node:crypto";

export function postImageAssetKey(
  workspaceId: string,
  entryId: string,
): string {
  return `workspaces/${workspaceId}/changelog-entries/${entryId}/image`;
}

export function publicPostImageUrl(
  workspaceId: string,
  entryId: string,
  body?: Uint8Array,
): string {
  const path = `/api/public/workspaces/${encodeURIComponent(workspaceId)}/changelog-entries/${encodeURIComponent(entryId)}/image`;
  return body ? `${path}?v=${postImageContentVersion(body)}` : path;
}

export function isPublicPostImageUrl(
  value: string | null | undefined,
  workspaceId: string,
  entryId: string,
): boolean {
  if (!value) return false;
  const expectedPath = publicPostImageUrl(workspaceId, entryId);
  return (
    value === expectedPath ||
    new RegExp(`^${escapeRegExp(expectedPath)}\\?v=[a-zA-Z0-9_-]+$`).test(value)
  );
}

export function getPostImageVersion(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const match = /[?&]v=([a-zA-Z0-9_-]+)/.exec(value);
  return match?.[1] ?? null;
}

function postImageContentVersion(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("base64url").slice(0, 12);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
