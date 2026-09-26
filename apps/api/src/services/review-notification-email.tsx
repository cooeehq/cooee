import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { render } from "@react-email/render";

export type PendingReviewEmailGroup = {
  changelogName: string;
  entries: Array<{
    category: string;
    id: string;
    summary: string;
    title: string;
  }>;
};

export async function renderPendingReviewEmail(input: {
  appUrl: string;
  groups: PendingReviewEmailGroup[];
  pendingCount: number;
  workspaceName: string;
}) {
  const reviewUrl = new URL("/changelog/privacy", input.appUrl).toString();
  const postLabel = input.pendingCount === 1 ? "post" : "posts";
  const subject = `${input.pendingCount} changelog ${postLabel} waiting for review`;
  const textLines = input.groups.flatMap((group) => [
    group.changelogName,
    ...group.entries.map(
      (entry) =>
        `- [${formatCategory(entry.category)}] ${entry.title}: ${entry.summary}`,
    ),
  ]);
  const email = (
    <PendingReviewEmail
      groups={input.groups}
      pendingCount={input.pendingCount}
      reviewUrl={reviewUrl}
      workspaceName={input.workspaceName}
    />
  );

  return {
    subject,
    html: await render(email),
    text: `Cooee has ${input.pendingCount} ${postLabel} ready for review in ${input.workspaceName}.\n\n${textLines.join("\n")}\n\nReview and publish: ${reviewUrl}`,
  };
}

function PendingReviewEmail({
  groups,
  pendingCount,
  reviewUrl,
  workspaceName,
}: {
  groups: PendingReviewEmailGroup[];
  pendingCount: number;
  reviewUrl: string;
  workspaceName: string;
}) {
  const postLabel = pendingCount === 1 ? "post" : "posts";

  return (
    <Html lang="en">
      <Head />
      <Preview>{`${pendingCount} changelog ${postLabel} ready for your review`}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.brandSection}>
            <Text style={styles.brand}>COOEE</Text>
          </Section>

          <Section style={styles.introSection}>
            <Text style={styles.eyebrow}>READY FOR REVIEW</Text>
            <Heading as="h1" style={styles.heading}>
              {pendingCount} changelog {postLabel} waiting for you
            </Heading>
            <Text style={styles.lede}>
              These posts passed Cooee&apos;s publishing checks and are waiting
              because automatic publishing is off for {workspaceName}.
            </Text>
          </Section>

          {groups.map((group) => (
            <Section key={group.changelogName} style={styles.groupSection}>
              <Text style={styles.groupName}>{group.changelogName}</Text>
              {group.entries.map((entry) => (
                <Section key={entry.id} style={styles.postCard}>
                  <Text style={styles.category}>
                    {formatCategory(entry.category)}
                  </Text>
                  <Heading as="h2" style={styles.postTitle}>
                    {entry.title}
                  </Heading>
                  <Text style={styles.summary}>{entry.summary}</Text>
                </Section>
              ))}
            </Section>
          ))}

          <Section style={styles.actionSection}>
            <Button href={reviewUrl} style={styles.button}>
              Review and publish posts
            </Button>
            <Text style={styles.actionHint}>
              You can edit every post before anything is published.
            </Text>
          </Section>

          <Hr style={styles.divider} />
          <Text style={styles.footer}>
            Sent by Cooee because you own this workspace. Guardrail-held drafts
            stay in their separate review queue and are not included here.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

function formatCategory(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const styles = {
  body: {
    backgroundColor: "#f4f3ef",
    color: "#252422",
    fontFamily:
      "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    margin: "0",
    padding: "32px 12px",
  },
  container: {
    backgroundColor: "#ffffff",
    border: "1px solid #e5e2db",
    borderRadius: "20px",
    margin: "0 auto",
    maxWidth: "600px",
    overflow: "hidden",
  },
  brandSection: {
    backgroundColor: "#252422",
    padding: "20px 32px",
  },
  brand: {
    color: "#f9f7f2",
    fontSize: "16px",
    fontWeight: "700",
    letterSpacing: "0.16em",
    margin: "0",
  },
  introSection: {
    padding: "36px 32px 24px",
  },
  eyebrow: {
    color: "#bb4b2f",
    fontSize: "12px",
    fontWeight: "700",
    letterSpacing: "0.12em",
    margin: "0 0 12px",
  },
  heading: {
    color: "#252422",
    fontSize: "30px",
    fontWeight: "650",
    letterSpacing: "-0.03em",
    lineHeight: "1.2",
    margin: "0 0 14px",
  },
  lede: {
    color: "#67635c",
    fontSize: "16px",
    lineHeight: "1.6",
    margin: "0",
  },
  groupSection: {
    padding: "0 32px 12px",
  },
  groupName: {
    color: "#67635c",
    fontSize: "13px",
    fontWeight: "700",
    letterSpacing: "0.06em",
    margin: "12px 0 10px",
    textTransform: "uppercase" as const,
  },
  postCard: {
    backgroundColor: "#faf9f6",
    border: "1px solid #ece9e2",
    borderRadius: "14px",
    margin: "0 0 12px",
    padding: "20px",
  },
  category: {
    color: "#bb4b2f",
    fontSize: "11px",
    fontWeight: "700",
    letterSpacing: "0.08em",
    margin: "0 0 8px",
    textTransform: "uppercase" as const,
  },
  postTitle: {
    color: "#252422",
    fontSize: "18px",
    fontWeight: "650",
    lineHeight: "1.35",
    margin: "0 0 8px",
  },
  summary: {
    color: "#67635c",
    fontSize: "14px",
    lineHeight: "1.6",
    margin: "0",
  },
  actionSection: {
    padding: "12px 32px 32px",
    textAlign: "center" as const,
  },
  button: {
    backgroundColor: "#d95e3f",
    borderRadius: "10px",
    color: "#ffffff",
    fontSize: "15px",
    fontWeight: "700",
    padding: "13px 22px",
    textDecoration: "none",
  },
  actionHint: {
    color: "#89847b",
    fontSize: "12px",
    lineHeight: "1.5",
    margin: "14px 0 0",
  },
  divider: {
    borderColor: "#ece9e2",
    margin: "0 32px",
  },
  footer: {
    color: "#89847b",
    fontSize: "12px",
    lineHeight: "1.55",
    margin: "0",
    padding: "22px 32px 28px",
  },
} satisfies Record<string, React.CSSProperties>;
