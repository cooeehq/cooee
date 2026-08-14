import { isAbsolute, resolve } from "node:path";

export function resolveStaticRoot(
  configuredRoot: string | undefined,
  sourceDirectory: string,
): string | undefined {
  const candidate = configuredRoot?.trim();
  if (!candidate) {
    return undefined;
  }

  return isAbsolute(candidate)
    ? resolve(candidate)
    : resolve(sourceDirectory, "../../..", candidate);
}
