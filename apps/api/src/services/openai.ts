import {
  buildImplementationDetailInstruction,
  buildPromptPayload,
  normalizeChangelogCategoryDefinitions,
  validateGeneratedEntry,
} from "@cooee/shared";
import type {
  AiWritingOptions,
  ChangelogCategory,
  ChangelogCategoryDefinition,
  GeneratedEntryCandidate,
  PullRequestMetadata,
} from "@cooee/shared";
import type { AiFeedback } from "../store/types";

export type MergeEntryInput = {
  title: string;
  summary: string;
  category: ChangelogCategory;
};

export type AiTokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type AiSummaryResult = {
  candidate: GeneratedEntryCandidate;
  usage?: AiTokenUsage;
};

export type AiSummarizer = {
  disabledReason?: "openai-not-configured";
  summarize(
    pullRequests: PullRequestMetadata[],
    options?: {
      categoryDefinitions?: ChangelogCategoryDefinition[];
      learnings?: AiFeedback[];
      rewriteInstructions?: string;
    } & AiWritingOptions,
  ): Promise<GeneratedEntryCandidate | AiSummaryResult>;
  mergeEntries?(
    entries: MergeEntryInput[],
    options?: {
      categoryDefinitions?: ChangelogCategoryDefinition[];
      learnings?: AiFeedback[];
    } & AiWritingOptions,
  ): Promise<GeneratedEntryCandidate | AiSummaryResult>;
};

export type AiImageGenerator = {
  disabledReason?:
    | "openai-not-configured"
    | "openai-image-model-not-configured";
  generatePostImage(input: {
    category: string;
    summary: string;
    title: string;
  }): Promise<{ imageUrl: string }>;
};

export class OpenAiSummarizer implements AiSummarizer {
  constructor(
    private readonly input: {
      apiKey: string;
      model: string;
    },
  ) {}

  async summarize(
    pullRequests: PullRequestMetadata[],
    options?: {
      categoryDefinitions?: ChangelogCategoryDefinition[];
      learnings?: AiFeedback[];
      rewriteInstructions?: string;
    } & AiWritingOptions,
  ): Promise<GeneratedEntryCandidate | AiSummaryResult> {
    const payload = buildPromptPayload(pullRequests, {
      aiAudience: options?.aiAudience,
      aiPersonality: options?.aiPersonality,
      categoryDefinitions: options?.categoryDefinitions,
      learnings: options?.learnings?.map((learning) => ({
        title: learning.title,
        summary: learning.summary,
        category: learning.category,
        note: learning.note,
      })),
      repositoryVisibility: options?.repositoryVisibility,
      rewriteInstructions: options?.rewriteInstructions,
    });
    const categoryIds = payload.categories.map((category) => category.id);
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: this.input.apiKey });
    const response = await client.responses.create({
      model: this.input.model,
      input: [
        {
          role: "system",
          content:
            "You are Cooee, a privacy-first changelog writer. Return only valid JSON with title, summary, category, items, confidence, and sensitive. Items are the authoritative customer-facing posts: create one item for each unique customer-facing change, each with its own title, markdown summary, category, and sourcePullRequestNumbers array containing the PR numbers that directly caused that item. Create a separate item for each PR by default. Combine PRs only when they directly contribute to the same customer-facing change; then include every related PR number in that item's sourcePullRequestNumbers. Use top-level title, summary, and category only as fallback metadata when exactly one item cannot be produced. Keep titles plain text. Use concise markdown in summary fields only when it improves readability, such as short bullet lists or emphasis. Speak directly to the reader as you/your; do not refer to the reader as users, merchants, customers, store owners, teams, or similar third-person audience labels unless those are a different group from the reader. Respect learnings as user feedback about what to merge, exclude, or avoid in future changelogs. When rewriteInstructions are present, follow them as editing direction without weakening privacy rules or inventing facts.",
        },
        {
          role: "user",
          content: JSON.stringify(payload),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "cooee_changelog_entry",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: [
              "title",
              "summary",
              "category",
              "items",
              "confidence",
              "sensitive",
            ],
            properties: {
              title: { type: "string" },
              summary: { type: "string" },
              category: {
                type: "string",
                enum: categoryIds,
              },
              items: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "title",
                    "summary",
                    "category",
                    "sourcePullRequestNumbers",
                  ],
                  properties: {
                    title: { type: "string" },
                    summary: { type: "string" },
                    category: {
                      type: "string",
                      enum: categoryIds,
                    },
                    sourcePullRequestNumbers: {
                      type: "array",
                      items: { type: "integer", minimum: 1 },
                    },
                  },
                },
              },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              sensitive: { type: "boolean" },
            },
          },
        },
      },
    });
    const text = response.output_text;

    return {
      candidate: JSON.parse(text) as GeneratedEntryCandidate,
      usage: toAiTokenUsage(response.usage),
    };
  }

  async mergeEntries(
    entries: MergeEntryInput[],
    options?: {
      categoryDefinitions?: ChangelogCategoryDefinition[];
      learnings?: AiFeedback[];
    } & AiWritingOptions,
  ): Promise<GeneratedEntryCandidate | AiSummaryResult> {
    const categories = normalizeChangelogCategoryDefinitions(
      options?.categoryDefinitions,
    );
    const categoryIds = categories.map((category) => category.id);
    const marketingCopyCategoryIds = categories
      .filter(
        (category) =>
          category.displayType === "post" && category.marketingCopy === true,
      )
      .map((category) => category.id);
    const marketingInstructions =
      marketingCopyCategoryIds.length > 0
        ? ` Write fuller feature-marketing posts for post display categories mapped to marketing copy: ${marketingCopyCategoryIds.join(", ")}. Lead with user value, describe the feature outcome, and keep the tone benefit-led without inventing claims.`
        : "";
    const audienceLabel =
      options?.aiAudience === "technical-users" ||
      options?.aiPersonality === "technical"
        ? "technical-user"
        : "product-user";
    const implementationDetailInstruction =
      buildImplementationDetailInstruction(options);
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: this.input.apiKey });
    const response = await client.responses.create({
      model: this.input.model,
      input: [
        {
          role: "system",
          content:
            "You are Cooee, a privacy-first changelog editor. Merge the selected changelog posts into one customer-facing post. Return only valid JSON with title, summary, category, items, confidence, and sensitive. Rewrite the title and markdown summary so they read as one coherent update, not a list of pasted posts. Keep titles plain text. Speak directly to the reader as you/your; do not refer to the reader as users, merchants, customers, store owners, teams, or similar third-person audience labels unless those are a different group from the reader. Respect learnings as user feedback about what to merge, exclude, or avoid in future changelogs.",
        },
        {
          role: "user",
          content: JSON.stringify({
            instructions: `Merge these selected changelog posts into one public ${audienceLabel} changelog post. Speak directly to the reader as you/your, not as users, merchants, customers, store owners, or teams unless those are a different group from the reader. Use only the configured category ids.${marketingInstructions} ${implementationDetailInstruction} Avoid private details, authors, trade secrets, code, credentials, and changes that conflict with user feedback learnings.`,
            categories,
            entries,
            ...(options?.learnings?.length
              ? {
                  learnings: options.learnings.map((learning) => ({
                    title: learning.title,
                    summary: learning.summary,
                    category: learning.category,
                    note: learning.note,
                  })),
                }
              : {}),
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "cooee_merged_changelog_entry",
          strict: true,
          schema: createEntryJsonSchema(categoryIds),
        },
      },
    });

    return {
      candidate: JSON.parse(response.output_text) as GeneratedEntryCandidate,
      usage: toAiTokenUsage(response.usage),
    };
  }
}

export class OpenAiImageGenerator implements AiImageGenerator {
  constructor(
    private readonly input: {
      apiKey: string;
      model: string;
    },
  ) {}

  async generatePostImage(input: {
    category: string;
    summary: string;
    title: string;
  }): Promise<{ imageUrl: string }> {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: this.input.apiKey });
    const outputFormat = "webp";
    const response = await client.images.generate({
      model: this.input.model,
      prompt: buildPostImagePrompt(input),
      n: 1,
      output_format: outputFormat,
      quality: "low",
      size: "1536x1024",
    });
    const image = response.data?.[0];

    if (image?.b64_json) {
      return {
        imageUrl: `data:image/${outputFormat};base64,${image.b64_json}`,
      };
    }

    if (image?.url) {
      return { imageUrl: image.url };
    }

    throw new Error("OpenAI did not return an image.");
  }
}

export function createDefaultSummarizer(env: {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
}): AiSummarizer {
  if (!env.OPENAI_API_KEY) {
    return {
      disabledReason: "openai-not-configured",
      summarize: async (pullRequests) => ({
        title: pullRequests[0]?.title ?? "Daily updates",
        summary:
          "A changelog draft is ready for review. Configure OPENAI_API_KEY to generate polished copy.",
        category: "maintenance",
        items: pullRequests.map((pullRequest) => ({
          title: pullRequest.title,
          summary: pullRequest.body || pullRequest.title,
          category: "maintenance",
          sourcePullRequestNumbers: [pullRequest.number],
        })),
        confidence: 0.1,
        sensitive: false,
      }),
      mergeEntries: async (entries) => ({
        title: entries.map((entry) => entry.title).join(" + "),
        summary:
          "A merged changelog draft is ready for review. Configure OPENAI_API_KEY to generate polished copy.",
        category: entries[0]?.category ?? "maintenance",
        items: [],
        confidence: 0.1,
        sensitive: false,
      }),
    };
  }

  return new OpenAiSummarizer({
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL ?? "gpt-5.4-mini",
  });
}

export function createDefaultImageGenerator(env: {
  OPENAI_API_KEY?: string;
  OPENAI_IMAGE_MODEL?: string;
}): AiImageGenerator {
  if (!env.OPENAI_API_KEY) {
    return {
      disabledReason: "openai-not-configured",
      generatePostImage: async () => {
        throw new Error("OPENAI_API_KEY is required to generate post images.");
      },
    };
  }

  if (!env.OPENAI_IMAGE_MODEL) {
    return {
      disabledReason: "openai-image-model-not-configured",
      generatePostImage: async () => {
        throw new Error(
          "OPENAI_IMAGE_MODEL is required to generate post images.",
        );
      },
    };
  }

  return new OpenAiImageGenerator({
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_IMAGE_MODEL,
  });
}

export function validateAiCandidate(candidate: GeneratedEntryCandidate) {
  return validateGeneratedEntry(candidate);
}

function buildPostImagePrompt(input: {
  category: string;
  summary: string;
  title: string;
}): string {
  return [
    "Create a clean editorial hero image for a public product changelog post.",
    "Use an abstract product-focused scene that suggests the customer value of the update.",
    "Do not include text, captions, logos, screenshots, UI mockups, code, people, brand marks, or private implementation details.",
    "Keep it polished, calm, and suitable for a SaaS changelog card.",
    `Category: ${input.category}`,
    `Title: ${input.title}`,
    `Summary: ${input.summary}`,
  ].join("\n");
}

function createEntryJsonSchema(categoryIds: string[]) {
  const allowedCategoryIds =
    categoryIds.length > 0
      ? categoryIds
      : ["feature", "improvement", "fix", "maintenance"];

  return {
    type: "object",
    additionalProperties: false,
    required: [
      "title",
      "summary",
      "category",
      "items",
      "confidence",
      "sensitive",
    ],
    properties: {
      title: { type: "string" },
      summary: { type: "string" },
      category: {
        type: "string",
        enum: allowedCategoryIds,
      },
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "summary", "category"],
          properties: {
            title: { type: "string" },
            summary: { type: "string" },
            category: {
              type: "string",
              enum: allowedCategoryIds,
            },
          },
        },
      },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      sensitive: { type: "boolean" },
    },
  } as const;
}

function toAiTokenUsage(
  usage:
    | {
        input_tokens?: number;
        input_tokens_details?: { cached_tokens?: number };
        output_tokens?: number;
        total_tokens?: number;
      }
    | null
    | undefined,
): AiTokenUsage | undefined {
  if (!usage) return undefined;

  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const totalTokens = usage.total_tokens ?? inputTokens + outputTokens;
  if (totalTokens <= 0) return undefined;

  return {
    inputTokens,
    cachedInputTokens: usage.input_tokens_details?.cached_tokens ?? 0,
    outputTokens,
    totalTokens,
  };
}

export function unwrapAiSummaryResult(
  result: GeneratedEntryCandidate | AiSummaryResult,
): AiSummaryResult {
  return "candidate" in result ? result : { candidate: result };
}
