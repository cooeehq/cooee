export type ProvisionedCustomHostname = {
  id: string | null;
  hostname: string;
  status: string | null;
  sslStatus: string | null;
};

export type CustomHostnameProvisioner = {
  createCustomHostname(input: {
    hostname: string;
  }): Promise<ProvisionedCustomHostname>;
  getCustomHostname?(id: string): Promise<ProvisionedCustomHostname>;
  deleteCustomHostname?(id: string): Promise<void>;
};

export function createCloudflareCustomHostnameProvisioner(
  env: Record<string, string | undefined>,
): CustomHostnameProvisioner | null {
  const token = env.CLOUDFLARE_API_TOKEN;
  const zoneId = env.CLOUDFLARE_ZONE_ID;

  if (!token || !zoneId) {
    return null;
  }

  return {
    async createCustomHostname({ hostname }) {
      const body = await cloudflareRequest<CloudflareCustomHostnameResponse>({
        method: "POST",
        path: `/zones/${zoneId}/custom_hostnames`,
        token,
        body: {
          custom_metadata: {
            provider: "cooee",
          },
          hostname,
          ssl: {
            method: "http",
            type: "dv",
          },
        },
      });

      const result = body?.result;
      if (!result?.hostname) {
        throw new Error("Cloudflare did not return a custom hostname.");
      }

      return {
        id: result.id ?? null,
        hostname: result.hostname,
        status: result.status ?? null,
        sslStatus: result.ssl?.status ?? null,
      };
    },
    async getCustomHostname(id) {
      const body = await cloudflareRequest<CloudflareCustomHostnameResponse>({
        method: "GET",
        path: `/zones/${zoneId}/custom_hostnames/${id}`,
        token,
      });

      const result = body?.result;
      if (!result?.hostname) {
        throw new Error("Cloudflare did not return a custom hostname.");
      }

      return {
        id: result.id ?? id,
        hostname: result.hostname,
        status: result.status ?? null,
        sslStatus: result.ssl?.status ?? null,
      };
    },
    async deleteCustomHostname(id) {
      await cloudflareRequest({
        method: "DELETE",
        path: `/zones/${zoneId}/custom_hostnames/${id}`,
        token,
      });
    },
  };
}

async function cloudflareRequest<TBody = CloudflareApiResponse>(input: {
  body?: unknown;
  method: string;
  path: string;
  token: string;
}): Promise<TBody> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4${input.path}`,
    {
      method: input.method,
      headers: {
        authorization: `Bearer ${input.token}`,
        ...(input.body ? { "content-type": "application/json" } : {}),
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
    },
  );
  const body = (await response
    .json()
    .catch(() => null)) as CloudflareApiResponse | null;

  if (!response.ok || body?.success === false) {
    throw new Error(readCloudflareError(body, response.status));
  }

  if (!body) {
    throw new Error("Cloudflare did not return a JSON response.");
  }

  return body as TBody;
}

function readCloudflareError(
  body: CloudflareCustomHostnameResponse | null,
  status: number,
): string {
  const message = body?.errors?.find((error) => error.message)?.message;
  return message
    ? `Cloudflare custom hostname failed: ${message}`
    : `Cloudflare custom hostname failed with HTTP ${status}.`;
}

type CloudflareCustomHostnameResponse = {
  success?: boolean;
  errors?: Array<{ message?: string }>;
  result?: {
    id?: string;
    hostname?: string;
    status?: string;
    ssl?: {
      status?: string;
    };
  };
};

type CloudflareApiResponse = {
  success?: boolean;
  errors?: Array<{ message?: string }>;
};
