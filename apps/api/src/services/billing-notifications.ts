import type { RuntimeConfig } from "../config";
import type { BillingNotificationType, Store } from "../store/types";

export type BillingEmail = {
  to: string;
  subject: string;
  headline: string;
  message: string;
  actionLabel?: string;
  actionUrl?: string;
  detail?: string | null;
};

export type BillingEmailSender = {
  send(email: BillingEmail, idempotencyKey: string): Promise<string | null>;
};

const billingEmailLogoDarkUrl =
  "https://cooee.sh/logos/cooee-logo-dark.png?v=960de9ad";
const billingEmailLogoLightUrl =
  "https://cooee.sh/logos/cooee-logo-light.png?v=9c613c05";

export function createResendBillingEmailSender(
  config: RuntimeConfig,
): BillingEmailSender | null {
  const apiKey = config.resendApiKey?.trim();
  const from = config.resendFromEmail?.trim();
  if (!apiKey || !from) return null;

  return {
    async send(email, idempotencyKey) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey.slice(0, 256),
        },
        body: JSON.stringify({
          from,
          to: [email.to],
          subject: email.subject,
          html: renderBillingEmail(email),
          text: renderBillingEmailText(email),
          ...(config.resendReplyTo?.trim()
            ? { reply_to: config.resendReplyTo.trim() }
            : {}),
          tags: [{ name: "category", value: "billing_lifecycle" }],
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        id?: string;
        message?: string;
        error?: { message?: string };
      } | null;
      if (!response.ok) {
        throw new Error(
          body?.error?.message ??
            body?.message ??
            `Resend request failed with ${response.status}.`,
        );
      }
      return body?.id ?? null;
    },
  };
}

export async function sendBillingNotification(input: {
  store: Store;
  sender: BillingEmailSender | null;
  workspaceId: string;
  dedupeKey: string;
  type: BillingNotificationType;
  email: BillingEmail;
}): Promise<void> {
  if (!input.sender || !isDeliverableEmail(input.email.to)) return;
  const claim = await input.store.claimBillingNotification({
    workspaceId: input.workspaceId,
    dedupeKey: input.dedupeKey,
    type: input.type,
    recipient: input.email.to,
  });
  if (claim === "completed") return;
  if (claim === "busy") {
    throw new Error("This billing notification is already being processed.");
  }

  try {
    const providerMessageId = await input.sender.send(
      input.email,
      `cooee/${input.type}/${input.dedupeKey}`,
    );
    await input.store.completeBillingNotification({
      dedupeKey: input.dedupeKey,
      type: input.type,
      recipient: input.email.to,
      providerMessageId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await input.store.failBillingNotification({
      dedupeKey: input.dedupeKey,
      type: input.type,
      recipient: input.email.to,
      error: message,
    });
    throw error;
  }
}

function isDeliverableEmail(value: string): boolean {
  return (
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) &&
    !value.endsWith("@auth.cooee.invalid")
  );
}

export function renderBillingEmail(email: BillingEmail): string {
  const action =
    email.actionLabel && email.actionUrl
      ? `<p style="margin:28px 0"><a href="${escapeHtml(email.actionUrl)}" style="display:inline-block;border-radius:999px;background:#3f4600;color:#fff;padding:12px 20px;text-decoration:none;font-weight:700">${escapeHtml(email.actionLabel)}</a></p>`
      : "";
  const detail = email.detail
    ? `<p style="margin:20px 0 0;color:#66664f;font-size:14px">${escapeHtml(email.detail)}</p>`
    : "";
  const logo = `<div style="height:27px"><img class="cooee-logo-dark" src="${billingEmailLogoDarkUrl}" width="136" alt="Cooee" style="display:block;width:136px;height:auto;border:0"><div class="cooee-logo-light" style="display:none;max-height:0;overflow:hidden;mso-hide:all"><img src="${billingEmailLogoLightUrl}" width="136" alt="Cooee" style="display:block;width:136px;height:auto;border:0"></div></div>`;

  return `<!doctype html><html><head><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><style>@media (prefers-color-scheme:dark){.cooee-logo-dark{display:none!important}.cooee-logo-light{display:block!important;max-height:27px!important;overflow:visible!important}}</style></head><body style="margin:0;background:#f7f7e9;color:#181900;font-family:Arial,sans-serif"><div style="max-width:560px;margin:0 auto;padding:40px 24px">${logo}<div style="margin-top:28px;border:1px solid #d9d8b8;border-radius:20px;background:#fff;padding:28px"><h1 style="margin:0 0 16px;font-size:24px;line-height:1.2">${escapeHtml(email.headline)}</h1><p style="margin:0;font-size:16px;line-height:1.6">${escapeHtml(email.message)}</p>${detail}${action}</div><p style="margin:20px 4px 0;color:#73735d;font-size:12px;line-height:1.5">This is an account and billing notification from Cooee.</p></div></body></html>`;
}

function renderBillingEmailText(email: BillingEmail): string {
  return [
    email.headline,
    "",
    email.message,
    email.detail ? `\n${email.detail}` : "",
    email.actionLabel && email.actionUrl
      ? `\n${email.actionLabel}: ${email.actionUrl}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const replacements: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return replacements[character] ?? character;
  });
}
