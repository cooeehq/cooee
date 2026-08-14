const defaultApiOriginHost = "cooee-api-production.up.railway.app";
const defaultAdminOriginHost = "cooee-admin-production.up.railway.app";
const defaultWebsiteOriginHost = "cooee.up.railway.app";

export default {
  async fetch(request, env) {
    return proxyToCooeeOrigin(request, env);
  },
};

export function proxyToCooeeOrigin(request, env = {}) {
  const incomingUrl = new URL(request.url);
  const originUrl = new URL(request.url);
  const originHost = resolveOriginHost(incomingUrl.hostname, env);
  originUrl.protocol = "https:";
  originUrl.hostname = originHost;
  originUrl.port = "";

  const headers = new Headers(request.headers);
  headers.set("x-forwarded-host", incomingUrl.host);
  headers.set("x-forwarded-proto", incomingUrl.protocol.replace(":", ""));
  headers.set("x-cooee-custom-host", incomingUrl.host);
  headers.delete("host");

  return fetch(
    new Request(originUrl.toString(), {
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : request.body,
      headers,
      method: request.method,
      redirect: "manual",
    }),
  );
}

export function resolveOriginHost(hostname, env = {}) {
  switch (hostname.toLowerCase()) {
    case "cooee.sh":
    case "www.cooee.sh":
      return env.COOEE_WEBSITE_ORIGIN_HOST || defaultWebsiteOriginHost;
    case "app.cooee.sh":
      return env.COOEE_ADMIN_ORIGIN_HOST || defaultAdminOriginHost;
    default:
      return env.COOEE_ORIGIN_HOST || defaultApiOriginHost;
  }
}
