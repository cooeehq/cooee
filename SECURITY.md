# Security policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use the repository's **Security** tab to submit a private vulnerability report through GitHub Security Advisories.

Include the affected endpoint or component, reproduction steps, expected impact, and any suggested mitigation. Do not access data that does not belong to you, modify another user's workspace, or perform denial-of-service testing.

We will acknowledge a complete report within three business days, provide updates while it is being investigated, and coordinate disclosure after a fix is available.

## Supported versions

The hosted service and the latest commit on the default branch receive security fixes. Self-hosted operators should update to the latest release before reporting an issue that may already have been corrected.

## Deployment responsibility

Self-hosted operators are responsible for protecting secrets, restricting database and object-storage access, applying migrations, maintaining backups, and installing security updates. Production deployments must configure signed GitHub webhooks and a strong Better Auth secret.
