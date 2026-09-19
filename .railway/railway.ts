import {
  defineRailway,
  fn,
  github,
  postgres,
  project,
  service,
  type VariableConfig,
} from "railway/iac";

const repository = github("cooeehq/cooee", { branch: "main" });

const requiredInput = (description: string): VariableConfig => ({
  description,
  isOptional: false,
});

const requiredSecret = (description: string): VariableConfig => ({
  ...requiredInput(description),
  isSealed: true,
});

const applicationBuild =
  "bun install --frozen-lockfile && bun run --filter @cooee/shared build && bun run --filter @cooee/admin build && bun run --filter @cooee/api build";
const workspaceBuild = "bun install --frozen-lockfile && bun run build";

export default defineRailway((context) => {
  const database = postgres("Postgres");

  const app = service("Cooee", {
    source: repository,
    build: applicationBuild,
    preDeploy: "bun run migrate",
    start: "COOEE_STATIC_ROOT=apps/admin/dist bun --filter @cooee/api start",
    healthcheck: "/api/ready",
    healthcheckTimeout: 120,
    deploy: {
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 3,
    },
    env: {
      APP_URL: "https://${{RAILWAY_PUBLIC_DOMAIN}}",
      BETTER_AUTH_SECRET: context.randomString("better-auth-secret", 64),
      BETTER_AUTH_URL: "https://${{RAILWAY_PUBLIC_DOMAIN}}",
      DATABASE_URL: database.env.DATABASE_URL,
      GITHUB_APP_ID: requiredInput("Numeric ID of the GitHub App."),
      GITHUB_APP_PRIVATE_KEY: requiredSecret(
        "Complete PEM private key for the GitHub App.",
      ),
      GITHUB_APP_SLUG: requiredInput("Slug of the GitHub App."),
      GITHUB_CLIENT_ID: requiredInput("GitHub OAuth app client ID."),
      GITHUB_CLIENT_SECRET: requiredSecret("GitHub OAuth app client secret."),
      GITHUB_WEBHOOK_SECRET: context.randomString("github-webhook-secret", 64),
      HOST: "0.0.0.0",
      NODE_ENV: "production",
      OPENAI_API_KEY: requiredSecret(
        "OpenAI API key used to draft changelog entries.",
      ),
      OPENAI_MODEL: "gpt-5.6-luna",
    },
  });

  const cron = fn("Cron", {
    source: repository,
    build: workspaceBuild,
    preDeploy: "bun run migrate",
    start: "bun run railway:cron",
    deploy: {
      cronSchedule: "*/15 * * * *",
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 3,
    },
    env: {
      APP_URL: app.env.APP_URL,
      BETTER_AUTH_SECRET: app.env.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: app.env.BETTER_AUTH_URL,
      DATABASE_URL: database.env.DATABASE_URL,
      GITHUB_APP_ID: app.env.GITHUB_APP_ID,
      GITHUB_APP_PRIVATE_KEY: app.env.GITHUB_APP_PRIVATE_KEY,
      GITHUB_APP_SLUG: app.env.GITHUB_APP_SLUG,
      GITHUB_CLIENT_ID: app.env.GITHUB_CLIENT_ID,
      GITHUB_CLIENT_SECRET: app.env.GITHUB_CLIENT_SECRET,
      GITHUB_WEBHOOK_SECRET: app.env.GITHUB_WEBHOOK_SECRET,
      NODE_ENV: "production",
      OPENAI_API_KEY: app.env.OPENAI_API_KEY,
      OPENAI_MODEL: app.env.OPENAI_MODEL,
    },
  });

  const mcp = service("MCP", {
    source: repository,
    build: "bun install --frozen-lockfile && bun run --cwd apps/mcp build",
    start: "bun run --cwd apps/mcp start",
    healthcheck: "/health",
    healthcheckTimeout: 120,
    deploy: {
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 3,
    },
    env: {
      COOEE_API_BASE_URL: app.env.APP_URL,
      HOST: "0.0.0.0",
      MCP_URL: "https://${{RAILWAY_PUBLIC_DOMAIN}}",
      NODE_ENV: "production",
    },
  });

  return project("cooee", { resources: [database, app, cron, mcp] });
});
