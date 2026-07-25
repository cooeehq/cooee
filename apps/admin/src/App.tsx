import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  BookOpenIcon,
  CalendarIcon,
  CalendarClockIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CheckCircle2Icon,
  ClipboardCopyIcon,
  CreditCardIcon,
  ExternalLinkIcon,
  EllipsisIcon,
  GithubIcon,
  ImageIcon,
  ListFilterIcon,
  LoaderCircleIcon,
  LockIcon,
  LogOutIcon,
  type LucideIcon,
  MoonIcon,
  PencilIcon,
  RefreshCwIcon,
  SearchIcon,
  SendIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SparklesIcon,
  SunIcon,
  Trash2Icon,
  UploadIcon,
  UserCircleIcon,
  XIcon,
} from "lucide-react";
import { format, subDays } from "date-fns";
import { play } from "cuelume";
import type { DateRange } from "react-day-picker";
import {
  type ChangeEvent,
  type Dispatch,
  type FormEvent,
  Fragment,
  lazy,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type SetStateAction,
  Suspense,
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  aiCreditRecharge,
  compareChangelogCategories,
  defaultChangelogCategoryDefinitions,
  formatBillingAmount,
  getBillingCurrencyForCountry,
  getChangelogCategoryDefinition,
  getChangelogCategoryDisplayType,
  getChangelogCategoryLabel,
  getNextScheduledRun,
  normalizeChangelogCategoryDefinitions,
  normalizeChangelogCategoryId,
  getCountryCodeFromLocale,
} from "@cooee/shared";
import type {
  BillingCurrency,
  ChangelogCategoryDefinition,
  ChangelogDisplayType,
  PublicFeedPagination,
} from "@cooee/shared";
import { AnimatedCooeeLogo } from "@/components/animated-cooee-logo";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress, ProgressLabel } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Toaster } from "@/components/ui/sonner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { renderMarkdown } from "@/markdown";

const MarkdownEditor = lazy(() =>
  import("@/components/markdown-editor").then((module) => ({
    default: module.MarkdownEditor,
  })),
);

type PublishedEntry = {
  id?: string;
  title: string;
  summary: string;
  category: string;
  time: string;
  status?: "draft" | "held" | "published" | "discarded";
  holdReason?: string | null;
  processedAt?: string | null;
  windowEndedAt?: string | null;
  publishedAt?: string | null;
  imageUrl?: string | null;
  items?: Array<{
    title: string;
    summary: string;
    category: string;
  }>;
  sourcePullRequests?: Array<{
    number: number;
    title?: string;
    url: string;
    author?: string;
    mergedAt?: string;
  }>;
};

type HeldEntry = {
  id: string;
  title: string;
  reason: HeldReasonDetails;
  source: string;
  copy: string;
  category: PublishedEntry["category"];
  processedAt?: string | null;
  windowEndedAt?: string | null;
  sourcePullRequests: Array<{
    number: number;
    title?: string;
    url: string;
    author?: string;
    mergedAt?: string;
  }>;
};

type HeldReasonDetails = {
  title: string;
  detail: string;
  pullRequestReason: string;
};

type LogEvent = {
  title: string;
  detail: string;
  time: string;
};

type ViewId = "dashboard" | "repositories" | "privacy" | "billing" | "settings";
type SurfaceId = "login" | "app" | "publicChangelog" | "notFound";
export type DeploymentMode = "admin";
type ThemeMode = "light" | "dark";
type PublicLogoAlignment = "left" | "center" | "right";
type ManualUpdateState = Pick<PublishedEntry, "title" | "summary" | "category">;
type PublishedEntryDraftState = ManualUpdateState & {
  publishedAt: string | null;
};
type ScheduleFrequency = "daily" | "weekly" | "monthly" | "on-merge";
type AiPersonality = "product-user" | "concise" | "technical";
type BillingMode = "hosted" | "self-hosted";
type CustomDomainActionStatus = "idle" | "saving" | "checking";
type CustomBrandAssetKind = "lightLogo" | "favicon";
type HistoricalBackfillStatus = "idle" | "running" | "success" | "error";
type SettingsScope = "default" | "workspace" | "changelog";
type SettingsUpdateOptions = {
  autosave?: boolean;
};
type SettingsUpdater = (
  action: SetStateAction<SettingsState>,
  options?: SettingsUpdateOptions,
) => void;
type ConfirmationDialogState = {
  title: string;
  description: string;
  actionLabel: string;
  variant?: "default" | "destructive";
  input?: {
    label: string;
    placeholder: string;
    maxLength?: number;
  };
  onConfirm: (inputValue: string) => Promise<void> | void;
};
type SettingsState = {
  appName: string;
  publicChangelog: boolean;
  includePullRequestLinks: boolean;
  publicTheme: ThemeMode;
  publicLogoAlignment: PublicLogoAlignment;
  logoAssetKey: string | null;
  logoDataUrl: string | null;
  logoUrl: string | null;
  lightLogoAssetKey: string | null;
  lightLogoDataUrl: string | null;
  lightLogoUrl: string | null;
  faviconAssetKey: string | null;
  faviconDataUrl: string | null;
  faviconUrl: string | null;
  publicAppUrl: string;
  publicAppLabel: string;
  aiMinimumConfidence: string;
  aiAudience: "product-users" | "technical-users";
  aiPersonality: AiPersonality;
  aiFailClosed: boolean;
  createImagesPerUpdate: boolean;
  scheduleFrequency: ScheduleFrequency;
  scheduleWeekday: number;
  scheduleMonthDay: number;
  historicalBackfillDays: number;
  onboardingCompleted: boolean;
  categoryDefinitions: ChangelogCategoryDefinition[];
  groupEntriesByCategory: boolean;
  publishTime: string;
  timeZone: string;
  publicSlug: string;
  customDomain: string;
  customHostnameStatus: string;
  customHostnameSslStatus: string;
  customHostnameCnameTarget: string;
  privacyLabels: string;
};

type GitHubConnectionRepository = {
  id: string;
  fullName: string;
  owner: string;
  name: string;
  private: boolean;
  installationId: number | null;
  accountLogin: string | null;
  selected: boolean;
  changelogId?: string | null;
  changelogSlug: string | null;
};

type GitHubConnectionState = {
  loading: boolean;
  configured: boolean;
  billingEnabled?: boolean;
  billingMode?: BillingMode;
  installUrl: string | null;
  repositoryLimit?: number | null;
  repositories: GitHubConnectionRepository[];
  error: string | null;
};

type AuthUser = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

type BillingSubscriptionDetails = {
  enabled: boolean;
  billingMode: BillingMode;
  accessSource: "complimentary" | "subscription" | "free" | "self-hosted";
  complimentaryAccess: {
    planId: BillingPlan["id"];
    expiresAt: string | null;
  } | null;
  currency: BillingCurrency;
  managementState: "available" | "recovery_required" | "unavailable";
  planId: "free" | BillingPlan["id"] | null;
  entitlements: {
    aiGeneration: boolean;
    scheduledPublishing: boolean;
    customDomain: boolean;
    customBranding: boolean;
  };
  repositoryLimit: number;
  usage: {
    connectedRepositories: number;
    pullRequestsThisPeriod: number;
    aiCreditsThisPeriod: number;
    includedCredits: number;
    periodStartedAt: string;
    periodEndedAt: string;
  };
  plans: BillingPlan[];
  portalUrl: string | null;
  subscription: {
    status: string;
    accessState: "active" | "grace" | "restricted" | "canceled";
    planId: BillingPlan["id"];
    billingCadence: PricingBillingCadence;
    repositoryLimit: number;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    cancelAt: string | null;
    lastPaymentFailedAt: string | null;
    autoRechargeEnabled: boolean;
  } | null;
};

type BillingUsageDetails = Pick<
  BillingSubscriptionDetails,
  | "billingMode"
  | "enabled"
  | "entitlements"
  | "planId"
  | "repositoryLimit"
  | "usage"
>;

type BillingCheckoutResponse = {
  enabled: boolean;
  url: string | null;
};

type BillingPlan = {
  id: "lobster" | "pineapple" | "watermelon";
  name: string;
  description: string;
  priceLabel: string;
  cadence: string;
  annualPriceLabel: string;
  monthlyAmount: number;
  annualAmount: number;
  annualCadence: string;
  repositoryLimit: number;
  monthlyPullRequestLimit: number;
  monthlyIncludedCredits: number;
  estimatedMonthlyPullRequests: number;
  features: string[];
};

const defaultBillingPlans: BillingPlan[] = [
  {
    id: "lobster",
    name: "Lobster",
    description: "For small teams and independent products getting started.",
    priceLabel: "$20",
    monthlyAmount: 20,
    cadence: "month",
    annualPriceLabel: "$200",
    annualAmount: 200,
    annualCadence: "year",
    repositoryLimit: 1,
    monthlyPullRequestLimit: 25,
    monthlyIncludedCredits: 30,
    estimatedMonthlyPullRequests: 25,
    features: [
      "30 AI credits / month (~25 PRs)",
      "Manual and AI-drafted posts",
      "Scheduled publishing and AI runs",
      "Custom logo, custom domain, and product link",
      "Privacy checks and editorial review",
    ],
  },
  {
    id: "pineapple",
    name: "Pineapple",
    description: "For teams publishing from multiple repositories.",
    priceLabel: "$50",
    monthlyAmount: 50,
    cadence: "month",
    annualPriceLabel: "$500",
    annualAmount: 500,
    annualCadence: "year",
    repositoryLimit: 3,
    monthlyPullRequestLimit: 100,
    monthlyIncludedCredits: 120,
    estimatedMonthlyPullRequests: 100,
    features: [
      "Everything in Lobster",
      "Multiple repositories",
      "120 AI credits / month (~100 PRs)",
      "Better value for regular release volume",
    ],
  },
  {
    id: "watermelon",
    name: "Watermelon",
    description: "For teams managing multiple products or audiences.",
    priceLabel: "$100",
    monthlyAmount: 100,
    cadence: "month",
    annualPriceLabel: "$1,000",
    annualAmount: 1_000,
    annualCadence: "year",
    repositoryLimit: 15,
    monthlyPullRequestLimit: 250,
    monthlyIncludedCredits: 300,
    estimatedMonthlyPullRequests: 250,
    features: [
      "Everything in Pineapple",
      "300 AI credits / month (~250 PRs)",
      "Multiple changelogs for different products or audiences",
    ],
  },
];

type PublicPreviewRepository = {
  fullName: string;
  url: string;
};

type ApiChangelogCategory = string;

type ApiChangelogEntry = {
  id: string;
  title: string;
  summary: string;
  category: ApiChangelogCategory;
  status?: "draft" | "held" | "published" | "discarded";
  holdReason?: string | null;
  imageUrl?: string | null;
  processedAt?: string | null;
  windowEndedAt?: string | null;
  items?: Array<{
    title: string;
    summary: string;
    category: ApiChangelogCategory;
  }>;
  publishedAt?: string | null;
  sourcePullRequests?: Array<{
    number: number;
    title?: string;
    url: string;
    author?: string;
    mergedAt?: string;
  }>;
};

type ApiChangelog = {
  id: string;
  slug: string;
  name: string;
  publicUrl: string;
};

type ApiPublicChangelogFeed = {
  changelog?: {
    slug: string;
    name: string;
    description?: string | null;
    publicUrl: string;
    logoUrl?: string | null;
    lightLogoUrl?: string | null;
    faviconUrl?: string | null;
    publicTheme?: ThemeMode;
    publicLogoAlignment?: PublicLogoAlignment;
    publicAppUrl?: string | null;
    publicAppLabel?: string | null;
    categoryDefinitions?: ChangelogCategoryDefinition[];
    groupEntriesByCategory?: boolean;
  };
  entries?: ApiChangelogEntry[];
  pagination?: PublicFeedPagination;
};

type PublicChangelogPaginationState = Pick<
  PublicFeedPagination,
  "hasMore" | "nextBefore"
>;

type ApiAdminChangelogEntriesResponse = {
  entries?: ApiChangelogEntry[];
  heldEntries?: ApiChangelogEntry[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

type ApiHeldEntryCountResponse = {
  count?: number;
};

type PublicChangelogLoadState =
  | { status: "loading" }
  | {
      status: "ready";
      appName: string;
      description: string | null;
      entries: PublishedEntry[];
      categoryDefinitions: ChangelogCategoryDefinition[];
      groupEntriesByCategory: boolean;
      publicTheme: ThemeMode;
      publicLogoAlignment: PublicLogoAlignment;
      publicUrl: string;
      publicAppUrl: string;
      publicAppLabel: string;
      logoUrl: string | null;
      lightLogoUrl: string | null;
      faviconUrl: string | null;
      pagination: PublicChangelogPaginationState;
      isLoadingMoreEntries: boolean;
      loadMoreError: string | null;
    }
  | { status: "error"; message: string };

type PostImageGenerationAvailability =
  | { status: "checking" }
  | { status: "available" }
  | { status: "unavailable"; reason: string };

const initialPublishedEntries: PublishedEntry[] = [];
const initialHeldEntries: HeldEntry[] = [];
const initialLogEvents: LogEvent[] = [];
const defaultPublishedEntriesPageSize = 10;
const publishedEntriesPageSizeOptions = [10, 25, 50] as const;
const postImageGenerationNotConfiguredMessage =
  "Post image generation is not configured.";
const postImageGenerationUnavailableMessage =
  "Post image generation is temporarily unavailable.";

const getAiCreditOverageLabel = (currency: BillingCurrency) =>
  `Additional AI credits: ${formatBillingAmount(aiCreditRecharge.amount, currency)} recharges add ${aiCreditRecharge.credits} credits`;
type PricingBillingCadence = "monthly" | "annual";
const defaultGitHubConnection: GitHubConnectionState = {
  loading: true,
  configured: false,
  billingEnabled: false,
  billingMode: "self-hosted",
  installUrl: null,
  repositoryLimit: null,
  repositories: [],
  error: null,
};
const activeViewStorageKey = "cooee:active-view";
const activeRepositoryStorageKey = "cooee:active-repository-id";
const activeRepositoryDisplayNameStorageKey =
  "cooee:active-repository-display-name";
const onboardingCompletedStorageKey = "cooee:onboarding-completed";
const publicChangelogThemeStorageKey = "cooee:public-changelog-theme";
const publicChangelogThemeCookieName = "cooee_public_changelog_theme";
const defaultPublicAppLabel = "Open app";
const backfillActivitySteps = [
  {
    title: "Scanning merged PRs",
    detail: "Looking for merged pull requests in the selected window.",
    progress: 18,
  },
  {
    title: "Skipping known changes",
    detail: "Checking PRs that already generated changelog posts.",
    progress: 38,
  },
  {
    title: "Applying privacy controls",
    detail:
      "Holding anything that looks confidential or personally identifying.",
    progress: 58,
  },
  {
    title: "Writing draft posts",
    detail: "Asking AI for customer-facing summaries.",
    progress: 78,
  },
  {
    title: "Refreshing the changelog",
    detail: "Loading the newest generated posts.",
    progress: 92,
  },
] as const;
const defaultSettings: SettingsState = {
  appName: "",
  publicChangelog: true,
  includePullRequestLinks: false,
  publicTheme: "light",
  publicLogoAlignment: "left",
  logoAssetKey: null,
  logoDataUrl: null,
  logoUrl: null,
  lightLogoAssetKey: null,
  lightLogoDataUrl: null,
  lightLogoUrl: null,
  faviconAssetKey: null,
  faviconDataUrl: null,
  faviconUrl: null,
  publicAppUrl: "",
  publicAppLabel: defaultPublicAppLabel,
  aiMinimumConfidence: "0.80",
  aiAudience: "product-users",
  aiPersonality: "product-user",
  aiFailClosed: true,
  createImagesPerUpdate: false,
  scheduleFrequency: "daily",
  scheduleWeekday: 1,
  scheduleMonthDay: 1,
  historicalBackfillDays: 14,
  onboardingCompleted: false,
  categoryDefinitions: defaultChangelogCategoryDefinitions,
  groupEntriesByCategory: true,
  publishTime: "09:00",
  timeZone: "Australia/Brisbane",
  publicSlug: "changelog",
  customDomain: "",
  customHostnameStatus: "",
  customHostnameSslStatus: "",
  customHostnameCnameTarget: "cloud.cooee.sh",
  privacyLabels: "cooee:skip, cooee:internal, security",
};
const settingsAutoSaveDelayMs = 700;
const settingsLoadErrorToastId = "settings-load-error";
const publishedEntriesLoadErrorToastId = "published-entries-load-error";

type SelectOption = {
  label: string;
  value: string;
};

const aiPersonalityOptions: SelectOption[] = [
  { label: "Product-user tone", value: "product-user" },
  { label: "Concise", value: "concise" },
  { label: "Technical", value: "technical" },
];
const aiMinimumConfidenceOptions: SelectOption[] = [
  { label: "0.70", value: "0.70" },
  { label: "0.80", value: "0.80" },
  { label: "0.90", value: "0.90" },
];
const aiAudienceOptions: SelectOption[] = [
  { label: "Product-user tone", value: "product-users" },
  { label: "Technical-user tone", value: "technical-users" },
];
const scheduleFrequencyOptions: SelectOption[] = [
  { label: "Every day", value: "daily" },
  { label: "Every week", value: "weekly" },
  { label: "Every month", value: "monthly" },
  { label: "Every PR merge", value: "on-merge" },
];
const scheduleWeekdayOptions: SelectOption[] = [
  { label: "Sunday", value: "0" },
  { label: "Monday", value: "1" },
  { label: "Tuesday", value: "2" },
  { label: "Wednesday", value: "3" },
  { label: "Thursday", value: "4" },
  { label: "Friday", value: "5" },
  { label: "Saturday", value: "6" },
];
const scheduleMonthDayOptions: SelectOption[] = Array.from(
  { length: 31 },
  (_, index) => {
    const day = index + 1;
    return { label: formatOrdinal(day), value: String(day) };
  },
);
const timeZoneOptions: SelectOption[] = [
  { label: "Australia/Brisbane", value: "Australia/Brisbane" },
  { label: "Australia/Sydney", value: "Australia/Sydney" },
  { label: "America/Los_Angeles", value: "America/Los_Angeles" },
  { label: "Europe/London", value: "Europe/London" },
  { label: "UTC", value: "UTC" },
];
const changelogDisplayTypeOptions: SelectOption[] = [
  { label: "Post", value: "post" },
  { label: "Callout", value: "callout" },
  { label: "Text", value: "text" },
];

function mergeSettings(
  base: SettingsState,
  incoming?: Partial<SettingsState>,
): SettingsState {
  const merged = { ...base, ...incoming };
  return {
    ...merged,
    publicAppLabel: normalizePublicAppLabel(merged.publicAppLabel),
    publicLogoAlignment: normalizePublicLogoAlignment(
      merged.publicLogoAlignment,
    ),
    publicTheme: normalizeThemeMode(merged.publicTheme, base.publicTheme),
    categoryDefinitions: normalizeChangelogCategoryDefinitions(
      merged.categoryDefinitions,
    ),
  };
}

function normalizeThemeMode(
  value: unknown,
  fallback: ThemeMode = "light",
): ThemeMode {
  return value === "dark" || value === "light" ? value : fallback;
}

function normalizePublicAppLabel(
  value: unknown,
  fallback = defaultPublicAppLabel,
): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizePublicLogoAlignment(
  value: unknown,
  fallback: PublicLogoAlignment = "left",
): PublicLogoAlignment {
  return value === "center" || value === "right" || value === "left"
    ? value
    : fallback;
}

function normalizePublicChangelogAppName(appName: string): string {
  return appName.trim();
}

function normalizePublicChangelogSeoText(value: string | null | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function truncatePublicChangelogMetaDescription(description: string): string {
  return description.length <= 160
    ? description
    : `${description.slice(0, 157).trimEnd()}...`;
}

function getPublicChangelogSeoTitle(appName: string): string {
  const normalizedAppName = normalizePublicChangelogAppName(appName);
  return normalizedAppName ? `${normalizedAppName} Changelog` : "Changelog";
}

function getPublicChangelogSeoDescription(
  appName: string,
  description?: string | null,
): string {
  const explicitDescription = normalizePublicChangelogSeoText(description);
  const normalizedAppName = normalizePublicChangelogAppName(appName);
  const fallbackDescription = normalizedAppName
    ? `Latest product updates, improvements, and fixes from ${normalizedAppName}.`
    : "Latest product updates, improvements, and fixes.";
  return truncatePublicChangelogMetaDescription(
    explicitDescription || fallbackDescription,
  );
}

function normalizePublicChangelogSeoUrl(
  publicUrl: string | null | undefined,
): string | null {
  const trimmedUrl = publicUrl?.trim() ?? "";
  return /^https?:\/\//i.test(trimmedUrl) ? trimmedUrl : null;
}

function applyPublicChangelogSeoMetadata({
  appName,
  description,
  faviconUrl,
  publicUrl,
}: {
  appName: string;
  description?: string | null;
  faviconUrl?: string | null;
  publicUrl?: string | null;
}) {
  if (typeof document === "undefined") {
    return;
  }

  const title = getPublicChangelogSeoTitle(appName);
  const metaDescription = getPublicChangelogSeoDescription(
    appName,
    description,
  );
  const canonicalUrl = normalizePublicChangelogSeoUrl(publicUrl);
  const socialImageUrl = getCooeeSocialImageUrl(canonicalUrl);

  document.title = title;
  upsertMetaTag("name", "description", metaDescription);
  upsertMetaTag("property", "og:locale", "en_AU");
  upsertMetaTag("property", "og:site_name", "Cooee");
  upsertMetaTag("property", "og:type", "website");
  upsertMetaTag("property", "og:title", title);
  upsertMetaTag("property", "og:description", metaDescription);
  upsertMetaTag("name", "twitter:card", "summary_large_image");
  upsertMetaTag("name", "twitter:title", title);
  upsertMetaTag("name", "twitter:description", metaDescription);

  if (socialImageUrl) {
    upsertMetaTag("property", "og:image", socialImageUrl);
    upsertMetaTag("property", "og:image:type", "image/png");
    upsertMetaTag("property", "og:image:width", "512");
    upsertMetaTag("property", "og:image:height", "512");
    upsertMetaTag("property", "og:image:alt", "Cooee logo");
    upsertMetaTag("name", "twitter:image", socialImageUrl);
    upsertMetaTag("name", "twitter:image:alt", "Cooee logo");
  }

  if (canonicalUrl) {
    upsertCanonicalLink(canonicalUrl);
    upsertMetaTag("property", "og:url", canonicalUrl);
  }

  if (faviconUrl) {
    upsertFaviconLink(faviconUrl);
  }
}

function getCooeeSocialImageUrl(publicUrl: string | null): string | null {
  if (!publicUrl) {
    return null;
  }

  try {
    return new URL("/cooee-icon.png", publicUrl).toString();
  } catch {
    return null;
  }
}

function upsertMetaTag(
  attributeName: "name" | "property",
  attributeValue: string,
  content: string,
) {
  let meta = document.head.querySelector<HTMLMetaElement>(
    `meta[${attributeName}="${attributeValue}"]`,
  );

  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute(attributeName, attributeValue);
    document.head.append(meta);
  }

  meta.setAttribute("content", content);
}

function upsertCanonicalLink(href: string) {
  let link = document.head.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]',
  );

  if (!link) {
    link = document.createElement("link");
    link.setAttribute("rel", "canonical");
    document.head.append(link);
  }

  link.setAttribute("href", href);
}

function upsertFaviconLink(href: string) {
  const existingLinks = Array.from(
    document.head.querySelectorAll<HTMLLinkElement>(
      'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]',
    ),
  );

  if (existingLinks.length === 0) {
    const link = document.createElement("link");
    link.setAttribute("rel", "icon");
    document.head.append(link);
    existingLinks.push(link);
  }

  for (const link of existingLinks) {
    link.setAttribute("href", href);
  }
}

function getRememberedPublicChangelogTheme(fallback: ThemeMode): ThemeMode {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    return normalizeThemeMode(
      window.localStorage.getItem(publicChangelogThemeStorageKey),
      fallback,
    );
  } catch {
    return fallback;
  }
}

function persistPublicChangelogTheme(theme: ThemeMode) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(publicChangelogThemeStorageKey, theme);
  } catch {
    // Visitors can still toggle for the current page load when storage is blocked.
  }

  try {
    document.cookie = `${publicChangelogThemeCookieName}=${theme}; Max-Age=31536000; Path=/; SameSite=Lax`;
  } catch {
    // Server-side rendering can use the cookie on the next request when cookies are available.
  }
}

function getConfiguredAppName(
  settings: Pick<SettingsState, "appName">,
  defaultAppName: string,
): string {
  return settings.appName.trim() || defaultAppName;
}

export function getDashboardAppName({
  settings,
  defaultAppName,
  hasActiveRepository,
  settingsScope,
}: {
  settings: Pick<SettingsState, "appName">;
  defaultAppName: string;
  hasActiveRepository: boolean;
  settingsScope: SettingsScope;
}): string {
  if (hasActiveRepository && settingsScope !== "changelog") {
    return defaultAppName;
  }

  return getConfiguredAppName(settings, defaultAppName);
}

export function getActiveChangelogSlug(
  repository: { changelogSlug?: string | null } | null | undefined,
  settings: { publicSlug: string },
): string {
  return repository?.changelogSlug ?? settings.publicSlug;
}

function getDefaultAppName(repositories: GitHubConnectionRepository[]): string {
  const repository = repositories.find((item) => item.name) ?? repositories[0];
  if (!repository) {
    return "Cooee";
  }

  return getRepositoryDisplayName(repository);
}

function getRepositoryDisplayName(repository: {
  fullName: string;
  name: string;
}): string {
  return humanizeRepositoryName(
    repository.name || repository.fullName.split("/").at(-1) || "Cooee",
  );
}

function humanizeRepositoryName(name: string): string {
  const words = name.replace(/[_-]+/g, " ").trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return "Cooee";
  }

  return words
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(" ");
}

const navItems: Array<{
  id: ViewId;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "dashboard", label: "Changelog", icon: CheckCircle2Icon },
  { id: "repositories", label: "Repositories", icon: GithubIcon },
  { id: "privacy", label: "Held for review", icon: ShieldCheckIcon },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];
const viewLabels: Record<ViewId, string> = {
  dashboard: "Changelog",
  repositories: "Repositories",
  privacy: "Held for review",
  billing: "Billing",
  settings: "Settings",
};
const availableViewIds = Object.keys(viewLabels) as ViewId[];

export function getAdminDocumentTitle({
  appName,
  view,
}: {
  appName: string;
  view: ViewId;
}): string {
  const section = viewLabels[view];
  const normalizedAppName = appName.trim();

  if (
    view === "dashboard" &&
    normalizedAppName &&
    normalizedAppName !== "Cooee"
  ) {
    return `${section} · ${normalizedAppName} | Cooee`;
  }

  return `${section} | Cooee`;
}

export function shouldShowCloudAccountMenu({
  billingEnabled,
  billingMode,
  cloudAccountEnabled,
}: {
  billingEnabled?: boolean | null;
  billingMode?: BillingMode | null;
  cloudAccountEnabled?: boolean | null;
}): boolean {
  return (
    Boolean(cloudAccountEnabled) ||
    Boolean(billingEnabled) ||
    billingMode === "hosted"
  );
}

function getCloudAccountMenuEnabled(): boolean {
  return import.meta.env?.VITE_BILLING_ENABLED === "true";
}

type AppProps = {
  deploymentMode?: DeploymentMode;
  initialBillingUsage?: BillingUsageDetails | null;
  initialGitHubConnection?: GitHubConnectionState;
  initialEntries?: PublishedEntry[];
  initialRepositorySearch?: string;
  initialSurface?: SurfaceId;
  initialView?: ViewId;
  initialOnboardingStep?: number;
  initialIsSignedIn?: boolean;
  initialAuthUser?: AuthUser | null;
  initialCloudAccountMenuEnabled?: boolean;
  showOnboarding?: boolean;
};

export function App({
  deploymentMode = getDeploymentMode(),
  initialBillingUsage = null,
  initialGitHubConnection = defaultGitHubConnection,
  initialEntries = initialPublishedEntries,
  initialRepositorySearch = "",
  initialSurface,
  initialOnboardingStep = 0,
  initialView,
  initialAuthUser = null,
  initialCloudAccountMenuEnabled,
  initialIsSignedIn = false,
  showOnboarding = true,
}: AppProps = {}) {
  const [surface, setSurface] = useState<SurfaceId>(
    () => initialSurface ?? getInitialSurface(deploymentMode),
  );
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());
  const [activeView, setActiveView] = useState<ViewId>(
    () => initialView ?? getInitialActiveView(),
  );
  const [publishedEntries, setPublishedEntries] =
    useState<PublishedEntry[]>(initialEntries);
  const [publishedEntriesPage, setPublishedEntriesPage] = useState(1);
  const [publishedEntriesPageSize, setPublishedEntriesPageSize] = useState(
    defaultPublishedEntriesPageSize,
  );
  const [publishedEntriesTotal, setPublishedEntriesTotal] = useState(
    initialEntries.length,
  );
  const [publishedEntriesLoading, setPublishedEntriesLoading] = useState(false);
  const [publishedEntrySearch, setPublishedEntrySearch] = useState("");
  const [publishedEntryDateFrom, setPublishedEntryDateFrom] = useState("");
  const [publishedEntryDateTo, setPublishedEntryDateTo] = useState("");
  const [selectedPublishedEntryKeys, setSelectedPublishedEntryKeys] = useState<
    Set<string>
  >(() => new Set());
  const [heldEntries, setHeldEntries] =
    useState<HeldEntry[]>(initialHeldEntries);
  const [heldEntryCount, setHeldEntryCount] = useState<number | null>(null);
  const [regeneratingHeldEntryIds, setRegeneratingHeldEntryIds] = useState<
    Set<string>
  >(() => new Set());
  const [, setLogEvents] = useState<LogEvent[]>(initialLogEvents);
  const [githubConnection, setGitHubConnection] =
    useState<GitHubConnectionState>(initialGitHubConnection);
  const [activeRepositoryId, setActiveRepositoryId] = useState<string | null>(
    () => getInitialActiveRepositoryId(initialGitHubConnection.repositories),
  );
  const [editingSource, setEditingSource] = useState<string | null>(null);
  const [editingPublishedEntry, setEditingPublishedEntry] =
    useState<PublishedEntry | null>(null);
  const [confirmationDialog, setConfirmationDialog] =
    useState<ConfirmationDialogState | null>(null);
  const [confirmationDialogInput, setConfirmationDialogInput] = useState("");
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(() =>
    getInitialOnboardingOpen(showOnboarding),
  );
  const [onboardingStep, setOnboardingStep] = useState(() =>
    clampOnboardingStep(initialOnboardingStep),
  );
  const [repositoryVisibility, setRepositoryVisibility] = useState<
    Record<string, boolean>
  >({});
  const [draftCopy, setDraftCopy] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      initialHeldEntries.map((entry) => [entry.source, entry.copy]),
    ),
  );
  const [manualUpdate, setManualUpdate] = useState<ManualUpdateState>({
    title: "",
    summary: "",
    category: "improvement",
  });
  const [publishedEntryDraft, setPublishedEntryDraft] =
    useState<PublishedEntryDraftState>({
      title: "",
      summary: "",
      category: "improvement",
      publishedAt: null,
    });
  const [
    publishedEntryRewriteInstructions,
    setPublishedEntryRewriteInstructions,
  ] = useState("");
  const [marketingRegenerationStatus, setMarketingRegenerationStatus] =
    useState<"idle" | "running">("idle");
  const [regeneratingPublishedEntryIds, setRegeneratingPublishedEntryIds] =
    useState<Set<string>>(() => new Set());
  const [postImageGenerationStatus, setPostImageGenerationStatus] = useState<
    "idle" | "running"
  >("idle");
  const [postImageGenerationAvailability, setPostImageGenerationAvailability] =
    useState<PostImageGenerationAvailability>({ status: "checking" });
  const [postImageUploadStatus, setPostImageUploadStatus] = useState<
    "idle" | "running"
  >("idle");
  const [settings, setSettings] = useState<SettingsState>(defaultSettings);
  const [billingUsage, setBillingUsage] = useState<BillingUsageDetails | null>(
    initialBillingUsage,
  );
  const [billingUsageStatus, setBillingUsageStatus] = useState<
    "loading" | "ready" | "error"
  >(initialBillingUsage ? "ready" : "loading");
  const [scheduleNow, setScheduleNow] = useState(() => new Date());
  const settingsRef = useRef(settings);
  const settingsAutoSaveTimeoutRef = useRef<number | null>(null);
  const settingsAutoSaveSequenceRef = useRef(0);
  const publishedEntriesRequestSequenceRef = useRef(0);
  const appDataInitializedRef = useRef(false);
  const [settingsScope, setSettingsScope] = useState<SettingsScope>("default");
  const [customDomainActionStatus, setCustomDomainActionStatus] =
    useState<CustomDomainActionStatus>("idle");
  const [workspaceSettingsLoaded, setWorkspaceSettingsLoaded] = useState(false);
  const [isBackfillDialogOpen, setIsBackfillDialogOpen] = useState(false);
  const [backfillDateRange, setBackfillDateRange] = useState<DateRange>(
    getDefaultBackfillDateRange,
  );
  const [historicalBackfillStatus, setHistoricalBackfillStatus] =
    useState<HistoricalBackfillStatus>("idle");
  const [historicalBackfillResult, setHistoricalBackfillResult] = useState<
    string | null
  >(null);
  const [isSignedIn, setIsSignedIn] = useState(initialIsSignedIn);
  const [authSessionStatus, setAuthSessionStatus] = useState<
    "loading" | "ready"
  >(() =>
    typeof window !== "undefined" && !initialIsSignedIn ? "loading" : "ready",
  );
  const [activeRepositoryDisplayName, setActiveRepositoryDisplayName] =
    useState<string | null>(() => getStoredActiveRepositoryDisplayName());
  const [authUser, setAuthUser] = useState<AuthUser | null>(initialAuthUser);
  const [signInStatus, setSignInStatus] = useState<"idle" | "running">("idle");
  const publicSiteUrl = getPublicSiteUrl();
  const cloudAccountMenuEnabled =
    initialCloudAccountMenuEnabled ?? getCloudAccountMenuEnabled();

  const showCloudAccountMenu = shouldShowCloudAccountMenu({
    billingEnabled: githubConnection.billingEnabled,
    billingMode: githubConnection.billingMode,
    cloudAccountEnabled: cloudAccountMenuEnabled,
  });
  const visibleActiveView =
    activeView === "billing" && !showCloudAccountMenu
      ? "dashboard"
      : activeView;
  const nextTheme = theme === "dark" ? "light" : "dark";
  const postImageGenerationUnavailableReason =
    postImageGenerationAvailability.status === "unavailable"
      ? postImageGenerationAvailability.reason
      : null;
  const orderedConnectedRepositories = orderRepositoriesForDisplay(
    githubConnection.repositories.filter(isConnectedChangelogRepository),
  );
  const repositorySelectItems = orderedConnectedRepositories.map(
    (repository) => ({
      label: repository.fullName,
      value: repository.id,
    }),
  );
  const activeRepository =
    orderedConnectedRepositories.find(
      (repository) => repository.id === activeRepositoryId,
    ) ??
    orderedConnectedRepositories.find((repository) => repository.selected) ??
    orderedConnectedRepositories[0];
  const defaultAppName = activeRepository
    ? getRepositoryDisplayName(activeRepository)
    : (activeRepositoryDisplayName ??
      getDefaultAppName(githubConnection.repositories));
  const appName = getDashboardAppName({
    settings,
    defaultAppName,
    hasActiveRepository: Boolean(
      activeRepositoryDisplayName || activeRepository,
    ),
    settingsScope,
  });
  const pageTitle =
    visibleActiveView === "dashboard" ? appName : viewLabels[visibleActiveView];
  const documentTitle = getAdminDocumentTitle({
    appName,
    view: visibleActiveView,
  });
  const themeLabel =
    theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  const connectedRepoCount = githubConnection.repositories.filter(
    (repository) => repository.selected,
  ).length;
  const activePublicChangelogPath = getPublicChangelogPath(
    getActiveChangelogSlug(activeRepository, settings),
  );
  const activePublicChangelogUrl = getPublicChangelogUrl(
    activePublicChangelogPath,
    settings,
    deploymentMode === "admin" ? publicSiteUrl : undefined,
  );
  const aiCreditUsageLabel = billingUsage
    ? formatHeaderAiCreditUsage(billingUsage)
    : null;
  const aiCreditUsagePercent = billingUsage
    ? getUsagePercent(
        billingUsage.usage.aiCreditsThisPeriod,
        billingUsage.usage.includedCredits,
      )
    : null;
  const aiCreditResetLabel = billingUsage
    ? formatBillingPeriodEnd(billingUsage.usage.periodEndedAt)
    : null;
  const nextScheduledRunLabel = workspaceSettingsLoaded
    ? getNextScheduledRunLabel({ now: scheduleNow, settings })
    : null;
  const publishedEntriesTotalPages = Math.max(
    1,
    Math.ceil(publishedEntriesTotal / publishedEntriesPageSize),
  );
  const shouldRenderOnboarding =
    isOnboardingOpen &&
    (workspaceSettingsLoaded || typeof window === "undefined");
  const initializeAppDataEvent = useEffectEvent(initializeAppData);
  const loadBillingUsageEvent = useEffectEvent(loadBillingUsage);
  const loadChangelogSettingsEvent = useEffectEvent(loadChangelogSettings);
  const loadHeldEntryCountEvent = useEffectEvent(loadHeldEntryCount);
  const loadPublishedEntriesEvent = useEffectEvent(loadPublishedEntries);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("cooee:theme", theme);
  }, [theme]);

  useEffect(() => {
    if (surface !== "app" || typeof document === "undefined") {
      return;
    }

    document.title = documentTitle;
  }, [documentTitle, surface]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    return () => {
      if (settingsAutoSaveTimeoutRef.current) {
        window.clearTimeout(settingsAutoSaveTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      authSessionStatus !== "ready" ||
      !isSignedIn ||
      surface !== "login"
    ) {
      return;
    }

    setSurface("app");
    window.history.replaceState({ cooeeView: "dashboard" }, "", "/changelog");
  }, [authSessionStatus, isSignedIn, surface]);

  useEffect(() => {
    setSelectedPublishedEntryKeys((current) => {
      if (current.size === 0) {
        return current;
      }

      const availableKeys = new Set(publishedEntries.map(getPublishedEntryKey));
      const next = new Set(
        [...current].filter((key) => availableKeys.has(key)),
      );
      return next.size === current.size ? current : next;
    });
  }, [publishedEntries]);

  useEffect(() => {
    if (!isSignedIn || surface !== "app") {
      appDataInitializedRef.current = false;
      return;
    }

    if (appDataInitializedRef.current) {
      return;
    }

    appDataInitializedRef.current = true;
    void initializeAppDataEvent();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Effect Events are intentionally non-reactive.
  }, [isSignedIn, surface]);

  useEffect(() => {
    if (surface !== "app" || !isSignedIn || typeof window === "undefined") {
      return;
    }

    const intervalId = window.setInterval(() => {
      setScheduleNow(new Date());
      void loadBillingUsageEvent({ background: true });
    }, 60_000);

    return () => window.clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Effect Events are intentionally non-reactive.
  }, [isSignedIn, surface]);

  useEffect(() => {
    if (
      surface === "app" &&
      activeView === "billing" &&
      !githubConnection.loading &&
      !showCloudAccountMenu
    ) {
      goToView("dashboard");
    }
  }, [activeView, githubConnection.loading, showCloudAccountMenu, surface]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let isCurrent = true;

    async function loadAuthSession() {
      try {
        const response = await fetch("/api/auth/get-session", {
          cache: "no-store",
          credentials: "include",
        });

        if (!response.ok) {
          if (isCurrent) {
            setIsSignedIn(false);
            setAuthUser(null);
          }
          return;
        }

        const session = (await response.json().catch(() => null)) as {
          session?: unknown;
          user?: AuthUser;
        } | null;

        if (isCurrent) {
          setIsSignedIn(Boolean(session?.session && session?.user));
          setAuthUser(session?.user ?? null);
        }
      } catch {
        if (isCurrent) {
          setIsSignedIn(false);
          setAuthUser(null);
        }
      } finally {
        if (isCurrent) {
          setAuthSessionStatus("ready");
        }
      }
    }

    void loadAuthSession();

    return () => {
      isCurrent = false;
    };
  }, []);

  useEffect(() => {
    if (
      surface !== "app" ||
      !workspaceSettingsLoaded ||
      !activeRepository?.changelogId
    ) {
      return;
    }

    void loadChangelogSettingsEvent(activeRepository.changelogId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Effect Events are intentionally non-reactive.
  }, [activeRepository?.changelogId, surface, workspaceSettingsLoaded]);

  useEffect(() => {
    if (
      surface !== "app" ||
      !["dashboard", "privacy"].includes(visibleActiveView) ||
      !activeRepository?.changelogId
    ) {
      return;
    }

    void loadPublishedEntriesEvent(
      githubConnection.repositories,
      activeRepository.id,
    );

    return () => {
      publishedEntriesRequestSequenceRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Effect Events are intentionally non-reactive.
  }, [
    surface,
    visibleActiveView,
    activeRepository?.id,
    activeRepository?.changelogId,
    githubConnection.repositories,
    publishedEntriesPage,
    publishedEntriesPageSize,
    publishedEntrySearch,
    publishedEntryDateFrom,
    publishedEntryDateTo,
  ]);

  useEffect(() => {
    if (surface !== "app") {
      return;
    }

    persistActiveView(activeView);
    replaceAppViewHistory(activeView);
  }, [surface, activeView]);

  useEffect(() => {
    if (surface !== "app" || typeof window === "undefined") {
      return;
    }

    function syncRouteFromHistory(event: PopStateEvent) {
      const nextSurface = getInitialSurface(deploymentMode);
      setSurface(nextSurface);

      if (nextSurface !== "app") {
        return;
      }

      const viewId = getHistoryStateView(event.state) ?? getInitialActiveView();
      setActiveView(viewId);
      persistActiveView(viewId);
    }

    window.addEventListener("popstate", syncRouteFromHistory);
    return () => window.removeEventListener("popstate", syncRouteFromHistory);
  }, [deploymentMode, surface]);

  useEffect(() => {
    if (!isManualModalOpen) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsManualModalOpen(false);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isManualModalOpen]);

  function goToView(viewId: ViewId) {
    setActiveView(viewId);
    persistActiveView(viewId);

    if (typeof window !== "undefined") {
      pushAppViewHistory(viewId);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  async function initializeAppData() {
    await Promise.all([
      loadBillingUsage(),
      loadGitHubConnection(),
      loadHeldEntryCount(),
      loadWorkspaceSettings(),
      loadPostImageGenerationAvailability(),
    ]);
  }

  async function loadHeldEntryCount() {
    try {
      const response = await fetch("/api/admin/held-entry-count", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(
          `Held entry count request failed with ${response.status}`,
        );
      }

      const body = (await response.json()) as ApiHeldEntryCountResponse;
      setHeldEntryCount(
        typeof body.count === "number" && Number.isSafeInteger(body.count)
          ? Math.max(0, body.count)
          : null,
      );
    } catch {
      setHeldEntryCount(null);
    }
  }

  async function loadBillingUsage({
    background = false,
  }: { background?: boolean } = {}) {
    if (!background) {
      setBillingUsageStatus("loading");
    }

    try {
      const response = await fetch("/api/admin/billing/usage", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Billing usage request failed with ${response.status}`);
      }

      setBillingUsage((await response.json()) as BillingUsageDetails);
      setBillingUsageStatus("ready");
    } catch {
      setBillingUsageStatus((current) =>
        background && current === "ready" ? current : "error",
      );
    }
  }

  async function loadPostImageGenerationAvailability() {
    try {
      const response = await fetch(
        "/api/admin/post-image-generation/availability",
      );
      if (!response.ok) {
        throw new Error("Post image generation availability request failed.");
      }

      const body = (await response.json().catch(() => ({}))) as {
        available?: boolean;
      };
      setPostImageGenerationAvailability(
        body.available === true
          ? { status: "available" }
          : {
              status: "unavailable",
              reason: postImageGenerationNotConfiguredMessage,
            },
      );
    } catch {
      setPostImageGenerationAvailability({
        status: "unavailable",
        reason: postImageGenerationNotConfiguredMessage,
      });
    }
  }

  async function loadGitHubConnection() {
    setGitHubConnection((current) => ({
      ...current,
      loading: true,
      error: null,
    }));

    try {
      const response = await fetch("/api/admin/github/app");
      if (!response.ok) {
        throw new Error(
          `GitHub connection request failed with ${response.status}`,
        );
      }

      const body = (await response.json()) as Omit<
        GitHubConnectionState,
        "loading" | "error"
      >;
      const repositories = getAdminRepositoriesFromConnection(body);
      const nextActiveRepositoryId =
        activeRepositoryId &&
        repositories.some(
          (repository) =>
            repository.id === activeRepositoryId &&
            isConnectedChangelogRepository(repository),
        )
          ? activeRepositoryId
          : getInitialActiveRepositoryId(repositories);
      setGitHubConnection({
        loading: false,
        configured: body.configured,
        billingEnabled: body.billingEnabled ?? false,
        billingMode: body.billingMode ?? "self-hosted",
        installUrl: body.installUrl,
        repositoryLimit: body.repositoryLimit,
        repositories,
        error: null,
      });
      setActiveRepositoryId(nextActiveRepositoryId);
      const nextActiveRepository = repositories.find(
        (repository) => repository.id === nextActiveRepositoryId,
      );
      const nextActiveRepositoryDisplayName = nextActiveRepository
        ? getRepositoryDisplayName(nextActiveRepository)
        : null;
      setActiveRepositoryDisplayName(nextActiveRepositoryDisplayName);
      persistActiveRepositoryId(nextActiveRepositoryId);
      persistActiveRepositoryDisplayName(nextActiveRepositoryDisplayName);
    } catch (error) {
      setGitHubConnection({
        loading: false,
        configured: false,
        billingEnabled: false,
        billingMode: "self-hosted",
        installUrl: null,
        repositoryLimit: null,
        repositories: [],
        error:
          error instanceof Error
            ? error.message
            : "Could not load GitHub connection status.",
      });
    }
  }

  async function loadWorkspaceSettings() {
    setWorkspaceSettingsLoaded(false);

    try {
      const response = await fetch("/api/admin/settings");
      if (!response.ok) {
        throw new Error(`Settings request failed with ${response.status}`);
      }

      const body = (await response.json()) as {
        settings?: Partial<SettingsState>;
      };
      const loadedSettings = mergeSettings(defaultSettings, body.settings);
      const localCompleted = getStoredOnboardingCompleted();
      const nextSettings = {
        ...loadedSettings,
        onboardingCompleted:
          loadedSettings.onboardingCompleted || localCompleted,
      };
      settingsRef.current = nextSettings;
      setSettings(nextSettings);
      setSettingsScope("workspace");
      toast.dismiss(settingsLoadErrorToastId);
      setIsOnboardingOpen(
        shouldShowOnboardingAfterSettingsLoaded({
          localCompleted,
          settingsCompleted: nextSettings.onboardingCompleted,
          showOnboarding,
        }),
      );

      if (nextSettings.onboardingCompleted) {
        markOnboardingCompleted();
      } else if (localCompleted) {
        void persistOnboardingCompleted();
      }
    } catch {
      toast.error("Could not load settings.", {
        id: settingsLoadErrorToastId,
        description: "Refresh the page and try again.",
      });
    } finally {
      setWorkspaceSettingsLoaded(true);
    }
  }

  async function loadChangelogSettings(changelogId: string) {
    try {
      const response = await fetch(
        `/api/admin/changelogs/${encodeURIComponent(changelogId)}/settings`,
      );
      if (!response.ok) {
        throw new Error(
          `Changelog settings request failed with ${response.status}`,
        );
      }

      const body = (await response.json()) as {
        changelog?: ApiChangelog;
        settings?: Partial<SettingsState>;
      };
      const nextSettings = mergeSettings(defaultSettings, body.settings);
      settingsRef.current = nextSettings;
      setSettings(nextSettings);
      setSettingsScope("changelog");
      toast.dismiss(settingsLoadErrorToastId);
      reconcileChangelogRepository(body.changelog);
    } catch {
      toast.error("Could not load changelog settings.", {
        id: settingsLoadErrorToastId,
        description: "Refresh the page and try again.",
      });
    }
  }

  function reconcileChangelogRepository(changelog?: ApiChangelog) {
    if (!changelog) {
      return;
    }

    setGitHubConnection((current) => ({
      ...current,
      repositories: current.repositories.map((repository) =>
        repository.changelogId === changelog.id
          ? {
              ...repository,
              selected: true,
              changelogSlug: changelog.slug,
            }
          : repository,
      ),
    }));
  }

  function updateSettings(
    action: SetStateAction<SettingsState>,
    options: SettingsUpdateOptions = {},
  ) {
    const nextSettings =
      typeof action === "function" ? action(settingsRef.current) : action;

    settingsRef.current = nextSettings;
    setSettings(nextSettings);

    if (options.autosave !== false) {
      queueSettingsAutoSave(nextSettings);
    }
  }

  function queueSettingsAutoSave(nextSettings: SettingsState) {
    if (typeof window === "undefined") {
      return;
    }

    const sequence = settingsAutoSaveSequenceRef.current + 1;
    settingsAutoSaveSequenceRef.current = sequence;

    if (settingsAutoSaveTimeoutRef.current) {
      window.clearTimeout(settingsAutoSaveTimeoutRef.current);
    }

    settingsAutoSaveTimeoutRef.current = window.setTimeout(() => {
      settingsAutoSaveTimeoutRef.current = null;
      void saveSettings(nextSettings, sequence);
    }, settingsAutoSaveDelayMs);
  }

  async function saveSettings(
    settingsToSave: SettingsState,
    saveSequence: number,
  ) {
    try {
      const changelogId = activeRepository?.changelogId;
      const settingsUrl = changelogId
        ? `/api/admin/changelogs/${encodeURIComponent(changelogId)}/settings`
        : "/api/admin/settings";
      const response = await fetch(settingsUrl, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ settings: settingsToSave }),
      });

      if (!response.ok) {
        throw new Error(`Settings save failed with ${response.status}`);
      }

      const body = (await response.json()) as {
        changelog?: ApiChangelog;
        settings?: Partial<SettingsState>;
      };

      if (saveSequence !== settingsAutoSaveSequenceRef.current) {
        return;
      }

      setSettingsScope(body.changelog ? "changelog" : "workspace");
      reconcileChangelogRepository(body.changelog);
      toast.success("Settings saved.", {
        description: "Your changes were saved automatically.",
      });
    } catch {
      if (saveSequence !== settingsAutoSaveSequenceRef.current) {
        return;
      }

      toast.error("Could not save settings.", {
        description: "Try again after checking the API connection.",
      });
    }
  }

  async function saveCustomDomain() {
    setCustomDomainActionStatus("saving");

    try {
      const changelogId = activeRepository?.changelogId;
      if (!changelogId) {
        throw new Error("Select a repository before configuring a domain.");
      }

      const response = await fetch(
        `/api/admin/changelogs/${encodeURIComponent(changelogId)}/settings`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            settings: {
              customDomain: settingsRef.current.customDomain,
              publicSlug: settingsRef.current.publicSlug,
            },
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Custom domain save failed with ${response.status}`);
      }

      const body = (await response.json()) as {
        changelog?: ApiChangelog;
        settings?: Partial<SettingsState>;
      };
      const nextSettings = mergeSettings(
        { ...defaultSettings, ...settingsRef.current },
        body.settings,
      );
      settingsRef.current = nextSettings;
      setSettings(nextSettings);
      setSettingsScope("changelog");
      reconcileChangelogRepository(body.changelog);
      toast.success("Custom domain saved.", {
        description: "Cooee will check Cloudflare status after DNS updates.",
      });
    } catch (error) {
      toast.error("Could not save custom domain.", {
        description:
          error instanceof Error
            ? error.message
            : "Try again after checking the API connection.",
      });
    } finally {
      setCustomDomainActionStatus("idle");
    }
  }

  async function refreshCustomDomainStatus() {
    setCustomDomainActionStatus("checking");

    try {
      const changelogId = activeRepository?.changelogId;
      if (!changelogId) {
        throw new Error("Select a repository before checking DNS.");
      }

      const response = await fetch(
        `/api/admin/changelogs/${encodeURIComponent(
          changelogId,
        )}/custom-domain/refresh`,
        {
          method: "POST",
        },
      );

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          body.error ?? `DNS refresh failed with ${response.status}`,
        );
      }

      const body = (await response.json()) as {
        changelog?: ApiChangelog;
        settings?: Partial<SettingsState>;
      };
      const nextSettings = mergeSettings(
        { ...defaultSettings, ...settingsRef.current },
        body.settings,
      );
      settingsRef.current = nextSettings;
      setSettings(nextSettings);
      setSettingsScope("changelog");
      reconcileChangelogRepository(body.changelog);
      toast.success("DNS status refreshed.", {
        description: "Cloudflare custom hostname status was updated.",
      });
    } catch (error) {
      toast.error("Could not refresh DNS status.", {
        description:
          error instanceof Error
            ? error.message
            : "Try again after checking the API connection.",
      });
    } finally {
      setCustomDomainActionStatus("idle");
    }
  }

  function connectRepository() {
    goToView("repositories");

    if (githubConnection.loading) {
      return;
    }

    if (!githubConnection.configured || !githubConnection.installUrl) {
      setGitHubConnection((current) => ({
        ...current,
        error:
          "GitHub App is not configured. Set the GitHub App environment variables, then restart Cooee.",
      }));
      setLogEvents((events) => [
        {
          title: "GitHub App setup needed",
          detail:
            "Set GITHUB_APP_SLUG, GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, and GITHUB_WEBHOOK_SECRET.",
          time: "Now",
        },
        ...events,
      ]);
      return;
    }

    window.location.assign("/api/admin/github/install");
  }

  async function selectRepository(repositoryId: string) {
    try {
      const response = await fetch(
        `/api/admin/github/repositories/${encodeURIComponent(repositoryId)}/select`,
        {
          method: "POST",
        },
      );

      if (!response.ok) {
        throw new Error(`Repository selection failed with ${response.status}`);
      }

      const body = (await response.json()) as {
        changelog?: ApiChangelog;
        repository: GitHubConnectionRepository;
      };

      setGitHubConnection((current) => ({
        ...current,
        repositories: current.repositories.map((repository) =>
          repository.id === body.repository.id ? body.repository : repository,
        ),
        error: null,
      }));
      setLogEvents((events) => [
        {
          title: "Repository selected",
          detail: `${body.repository.fullName} is ready for changelog generation.`,
          time: "Now",
        },
        ...events,
      ]);
      toast.success("Repository selected.", {
        description: `${body.repository.fullName} is ready for changelog generation.`,
      });
      setActiveRepositoryId(body.repository.id);
      const nextDisplayName = getRepositoryDisplayName(body.repository);
      setActiveRepositoryDisplayName(nextDisplayName);
      setPublishedEntriesPage(1);
      persistActiveRepositoryId(body.repository.id);
      persistActiveRepositoryDisplayName(nextDisplayName);
      reconcileChangelogRepository(body.changelog);
      if (body.repository.changelogId) {
        void loadChangelogSettings(body.repository.changelogId);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not select repository.";
      setGitHubConnection((current) => ({
        ...current,
        error: message,
      }));
      toast.error("Could not select repository.", {
        description: message,
      });
    }
  }

  async function loadPublishedEntries(
    repositories: GitHubConnectionRepository[],
    preferredRepositoryId?: string | null,
  ) {
    const repository =
      repositories.find(
        (item) => item.id === preferredRepositoryId && item.changelogId,
      ) ??
      repositories.find((item) => item.selected && item.changelogId) ??
      repositories.find((item) => item.changelogId);

    if (!repository?.changelogId) {
      return;
    }

    const requestSequence = ++publishedEntriesRequestSequenceRef.current;
    setPublishedEntriesLoading(true);

    try {
      const params = new URLSearchParams({
        limit: String(publishedEntriesPageSize),
        page: String(publishedEntriesPage),
      });
      if (publishedEntrySearch.trim()) {
        params.set("query", publishedEntrySearch.trim());
      }
      if (publishedEntryDateFrom) {
        params.set("from", publishedEntryDateFrom);
      }
      if (publishedEntryDateTo) {
        params.set("to", publishedEntryDateTo);
      }

      const response = await fetch(
        `/api/admin/changelogs/${encodeURIComponent(repository.changelogId)}/entries?${params.toString()}`,
      );
      if (!response.ok) {
        throw new Error(`Changelog feed failed with ${response.status}`);
      }

      const body = (await response.json()) as ApiAdminChangelogEntriesResponse;
      if (requestSequence !== publishedEntriesRequestSequenceRef.current) {
        return;
      }
      const pagination = body.pagination ?? {
        limit: publishedEntriesPageSize,
        page: 1,
        total: body.entries?.length ?? 0,
        totalPages: 1,
      };

      setPublishedEntries((body.entries ?? []).map(toPublishedEntry));
      const nextHeldEntries = (body.heldEntries ?? []).map(toHeldEntry);
      setHeldEntries(nextHeldEntries);
      setDraftCopy((copy) => ({
        ...copy,
        ...Object.fromEntries(
          nextHeldEntries.map((entry) => [entry.source, entry.copy]),
        ),
      }));
      setPublishedEntriesTotal(pagination.total);
      if (pagination.page !== publishedEntriesPage) {
        setPublishedEntriesPage(pagination.page);
      }
      toast.dismiss(publishedEntriesLoadErrorToastId);
    } catch {
      if (requestSequence === publishedEntriesRequestSequenceRef.current) {
        toast.error("Could not load changelog posts.", {
          id: publishedEntriesLoadErrorToastId,
          description: "Refresh the page and try again.",
        });
      }
    } finally {
      if (requestSequence === publishedEntriesRequestSequenceRef.current) {
        setPublishedEntriesLoading(false);
      }
    }
  }

  function updatePublishedEntrySearch(value: string) {
    setPublishedEntrySearch(value);
    setPublishedEntriesPage(1);
  }

  function updatePublishedEntriesPageSize(pageSize: number) {
    setPublishedEntriesPageSize(pageSize);
    setPublishedEntriesPage(1);
  }

  function updatePublishedEntryDateRange(range: { from: string; to: string }) {
    setPublishedEntryDateFrom(range.from);
    setPublishedEntryDateTo(range.to);
    setPublishedEntriesPage(1);
  }

  function clearPublishedEntryFilters() {
    setPublishedEntrySearch("");
    setPublishedEntryDateFrom("");
    setPublishedEntryDateTo("");
    setPublishedEntriesPage(1);
  }

  async function runHistoricalBackfill(range: DateRange) {
    if (!activeRepository?.changelogId) {
      toast.error("Select a changelog first.", {
        description: "Choose a connected repository before running a backfill.",
      });
      return;
    }

    if (!range.from || !range.to) {
      toast.error("Choose a start and end date.");
      return;
    }

    const startDate = formatDateFilterValue(range.from);
    const endDate = formatDateFilterValue(range.to);
    setHistoricalBackfillStatus("running");
    setHistoricalBackfillResult(null);

    try {
      const response = await fetch(
        `/api/admin/changelogs/${encodeURIComponent(activeRepository.changelogId)}/generate-historical`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ startDate, endDate }),
        },
      );

      if (!response.ok) {
        throw new Error(`Historical generation failed with ${response.status}`);
      }

      const body = (await response.json()) as {
        windows?: Array<{
          status: string;
          entry?: unknown;
          entries?: unknown[];
        }>;
      };
      const generatedCount = (body.windows ?? []).reduce(
        (count, window) =>
          count +
          (window.entries?.length ??
            (window.status === "empty" || !window.entry ? 0 : 1)),
        0,
      );
      setLogEvents((events) => [
        {
          title: "Historical changelog generated",
          detail: `${formatCount(generatedCount, "post")} generated for ${activeRepository.fullName}.`,
          time: "Now",
        },
        ...events,
      ]);
      setHistoricalBackfillStatus("success");
      setHistoricalBackfillResult(
        `${formatCount(generatedCount, "post")} generated for ${activeRepository.fullName}.`,
      );
      toast.success("Historical changelog generated.", {
        description: `${formatDateRangeLabel(range)} checked for ${activeRepository.fullName}.`,
      });
      void loadPublishedEntries(
        githubConnection.repositories,
        activeRepository.id,
      );
      void loadHeldEntryCountEvent();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not generate historical changelog.";
      setHistoricalBackfillStatus("error");
      setHistoricalBackfillResult(message);
      toast.error("Could not generate historical changelog.", {
        description: message,
      });
    }
  }

  function switchRepository(repositoryId: string) {
    const repository = githubConnection.repositories.find(
      (item) => item.id === repositoryId,
    );

    if (!repository) {
      return;
    }

    setActiveRepositoryId(repository.id);
    const nextDisplayName = getRepositoryDisplayName(repository);
    setActiveRepositoryDisplayName(nextDisplayName);
    setSettingsScope("workspace");
    setPublishedEntriesPage(1);
    persistActiveRepositoryId(repository.id);
    persistActiveRepositoryDisplayName(nextDisplayName);

    if (!repository.changelogSlug) {
      void selectRepository(repository.id);
      return;
    }

    if (repository.changelogId) {
      void loadChangelogSettings(repository.changelogId);
    }
    toast.success("Repository switched.", {
      description: `Showing ${repository.fullName}.`,
    });
  }

  async function signInWithGitHub() {
    setSignInStatus("running");
    try {
      const response = await fetch("/api/auth/sign-in/social", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "github",
          callbackURL: new URL("/changelog", window.location.origin).toString(),
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        throw new Error(
          body.error ??
            body.message ??
            `GitHub sign-in failed with ${response.status}`,
        );
      }

      const body = (await response.json()) as { url?: string };

      if (!body.url) {
        throw new Error("GitHub sign-in did not return a redirect URL.");
      }

      window.location.assign(body.url);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not start GitHub sign-in.";
      setGitHubConnection((current) => ({
        ...current,
        error: message,
      }));
      toast.error("Could not start GitHub sign-in.", {
        description: message,
      });
      setSignInStatus("idle");
    }
  }

  async function signOut() {
    try {
      const response = await fetch("/api/auth/sign-out", {
        credentials: "include",
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(`Sign-out failed with ${response.status}`);
      }

      setIsSignedIn(false);
      setAuthUser(null);
      window.location.assign(deploymentMode === "admin" ? "/login" : "/");
    } catch {
      toast.error("Could not log out. Try again in a moment.");
    }
  }

  async function publishHeldEntry(entry: HeldEntry) {
    try {
      const summary = (draftCopy[entry.source] ?? entry.copy).trim();
      if (!summary) {
        openHeldEntryReview(entry);
        toast.error("Add draft copy before publishing.");
        return;
      }

      const replacesVisibleHeldEntry = publishedEntries.some(
        (item) => item.id === entry.id,
      );
      const response = await fetch(
        `/api/admin/changelog-entries/${encodeURIComponent(entry.id)}/publish`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: entry.title,
            summary,
            category: toApiCategory(entry.category),
          }),
        },
      );
      if (!response.ok) {
        throw new Error(`Held entry publish failed with ${response.status}`);
      }

      const publishedEntry = toPublishedEntry(
        (await response.json()) as ApiChangelogEntry,
      );
      setHeldEntries((entries) =>
        entries.filter((item) => item.id !== entry.id),
      );
      setPublishedEntries((entries) => [
        publishedEntry,
        ...entries.filter((item) => item.id !== entry.id),
      ]);
      setPublishedEntriesTotal((total) =>
        replacesVisibleHeldEntry ? total : total + 1,
      );
      void loadHeldEntryCountEvent();
      setLogEvents((events) => [
        {
          title: "Held draft published",
          detail: `${entry.title} moved into the public changelog.`,
          time: "Now",
        },
        ...events,
      ]);
      setEditingSource(null);
      goToView("dashboard");
      toast.success("Held draft published.", {
        description: `${entry.title} moved into the public changelog.`,
      });
    } catch {
      toast.error("Could not publish held draft.");
    }
  }

  function openHeldEntryReview(entry: HeldEntry) {
    setHeldEntries((entries) =>
      entries.some((item) => item.id === entry.id)
        ? entries
        : [entry, ...entries],
    );
    setDraftCopy((copy) => ({
      ...copy,
      [entry.source]: copy[entry.source] ?? entry.copy,
    }));
    setEditingSource(entry.source);
    goToView("privacy");
  }

  async function regenerateHeldEntry(entry: HeldEntry) {
    if (regeneratingHeldEntryIds.has(entry.id)) {
      return;
    }

    setRegeneratingHeldEntryIds((ids) => new Set(ids).add(entry.id));

    try {
      const response = await fetch(
        `/api/admin/changelog-entries/${encodeURIComponent(entry.id)}/regenerate`,
        {
          method: "POST",
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          body.error ?? `Draft regeneration failed with ${response.status}`,
        );
      }

      const regeneratedApiEntry = (await response.json()) as ApiChangelogEntry;
      const regeneratedEntry = toHeldEntry(regeneratedApiEntry);
      setHeldEntries((entries) =>
        entries.map((item) =>
          item.id === regeneratedEntry.id ? regeneratedEntry : item,
        ),
      );
      setDraftCopy((copy) => ({
        ...copy,
        [regeneratedEntry.source]: regeneratedEntry.copy,
      }));
      setPublishedEntries((entries) =>
        entries.map((item) =>
          item.id === regeneratedEntry.id
            ? toPublishedEntry(regeneratedApiEntry)
            : item,
        ),
      );
      setEditingSource(null);
      toast.success("Post regenerated.", {
        description: "Review the new draft before creating the post.",
      });
    } catch (error) {
      toast.error("Could not regenerate post.", {
        description:
          error instanceof Error
            ? error.message
            : "Try again after checking the source pull request.",
      });
    } finally {
      setRegeneratingHeldEntryIds((ids) => {
        const nextIds = new Set(ids);
        nextIds.delete(entry.id);
        return nextIds;
      });
    }
  }

  async function markHeldEntryRelevant(entry: HeldEntry) {
    try {
      const removesVisibleHeldEntry = publishedEntries.some(
        (item) => item.id === entry.id,
      );
      const response = await fetch(
        `/api/admin/changelog-entries/${encodeURIComponent(entry.id)}/relevant`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            note: "User marked a skipped PR as customer-relevant.",
          }),
        },
      );
      if (!response.ok) {
        throw new Error(`Held entry relevance failed with ${response.status}`);
      }

      setHeldEntries((entries) =>
        entries.filter((item) => item.id !== entry.id),
      );
      setPublishedEntries((entries) =>
        entries.filter((item) => item.id !== entry.id),
      );
      if (removesVisibleHeldEntry) {
        setPublishedEntriesTotal((total) => Math.max(0, total - 1));
      }
      void loadHeldEntryCountEvent();
      setLogEvents((events) => [
        {
          title: "Skipped PR marked relevant",
          detail: `${entry.title} was saved as positive AI feedback.`,
          time: "Now",
        },
        ...events,
      ]);
      toast.success("Marked relevant.", {
        description: "Cooee will use this correction in future AI syncs.",
      });
    } catch {
      toast.error("Could not mark skipped PR as relevant.");
    }
  }

  async function postManualUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const title = manualUpdate.title.trim();
    const summary = manualUpdate.summary.trim();
    if (!title || !summary) {
      return;
    }
    const changelogId = activeRepository?.changelogId;
    if (!changelogId) {
      toast.error("Select a repository before posting an update.");
      return;
    }

    try {
      const response = await fetch(
        `/api/admin/changelogs/${encodeURIComponent(changelogId)}/entries`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title,
            summary,
            category: manualUpdate.category,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(`Manual post failed with ${response.status}`);
      }
      const entry = toPublishedEntry(
        (await response.json()) as ApiChangelogEntry,
      );
      setPublishedEntries((entries) => [entry, ...entries]);
      setPublishedEntriesTotal((total) => total + 1);
      setManualUpdate({
        title: "",
        summary: "",
        category: "improvement",
      });
      setLogEvents((events) => [
        {
          title: "Manual update posted",
          detail: `${title} was added to the public changelog.`,
          time: "Now",
        },
        ...events,
      ]);
      setIsManualModalOpen(false);
      goToView("dashboard");
      toast.success("Manual update posted.", {
        description: `${title} was added to the public changelog.`,
      });
    } catch {
      toast.error("Manual update could not be posted.");
    }
  }

  function openEditPublishedEntry(entry: PublishedEntry) {
    setEditingPublishedEntry(entry);
    setPublishedEntryRewriteInstructions("");
    setMarketingRegenerationStatus("idle");
    setPostImageGenerationStatus("idle");
    setPublishedEntryDraft({
      title: entry.title,
      summary: entry.summary,
      category: entry.category,
      publishedAt: entry.publishedAt ?? new Date().toISOString(),
    });
  }

  async function regeneratePublishedEntryMarketingCopy() {
    if (
      !editingPublishedEntry ||
      !isPersistedPublishedEntry(editingPublishedEntry)
    ) {
      return;
    }

    try {
      setMarketingRegenerationStatus("running");
      const body = await requestPublishedEntryMarketingRegeneration({
        category: publishedEntryDraft.category,
        entryId: editingPublishedEntry.id,
        rewriteInstructions: publishedEntryRewriteInstructions,
        summary: publishedEntryDraft.summary,
        title: publishedEntryDraft.title,
      });
      setPublishedEntryDraft({
        title: body.title,
        summary: body.summary,
        category: toUiCategory(body.category),
        publishedAt: publishedEntryDraft.publishedAt,
      });
      setPublishedEntryRewriteInstructions("");
      toast.success("Post rewritten.", {
        description: "Review the draft and save it when it is ready.",
      });
    } catch (error) {
      toast.error("Could not rewrite post.", {
        description:
          error instanceof Error
            ? error.message
            : "Try again after checking the source pull request.",
      });
    } finally {
      setMarketingRegenerationStatus("idle");
    }
  }

  function rewritePublishedEntryFromList(entry: PublishedEntry) {
    if (!isPersistedPublishedEntry(entry)) {
      return;
    }

    setConfirmationDialogInput("");
    setConfirmationDialog({
      title: "Rewrite this post?",
      description:
        "Add optional direction for this rewrite. You can review the result before saving it.",
      actionLabel: "Rewrite post",
      input: {
        label: "Rewrite instructions (optional)",
        placeholder:
          "For example: lead with the customer outcome and keep the technical detail brief.",
        maxLength: 1000,
      },
      onConfirm: (rewriteInstructions) =>
        regeneratePublishedEntryFromList(entry, rewriteInstructions),
    });
  }

  async function regeneratePublishedEntryFromList(
    entry: PublishedEntry,
    rewriteInstructions: string,
  ) {
    if (
      !isPersistedPublishedEntry(entry) ||
      regeneratingPublishedEntryIds.has(entry.id)
    ) {
      return;
    }

    setRegeneratingPublishedEntryIds((ids) => new Set(ids).add(entry.id));

    try {
      const body = await requestPublishedEntryMarketingRegeneration({
        category: entry.category,
        entryId: entry.id,
        rewriteInstructions,
        summary: entry.summary,
        title: entry.title,
      });
      setPublishedEntryRewriteInstructions("");
      setEditingPublishedEntry(entry);
      setMarketingRegenerationStatus("idle");
      setPostImageGenerationStatus("idle");
      setPublishedEntryDraft({
        title: body.title,
        summary: body.summary,
        category: toUiCategory(body.category),
        publishedAt: entry.publishedAt ?? new Date().toISOString(),
      });
      toast.success("Post rewritten.", {
        description: "Review the draft and save it when it is ready.",
      });
    } catch (error) {
      toast.error("Could not rewrite post.", {
        description:
          error instanceof Error
            ? error.message
            : "Try again after checking the source pull request.",
      });
    } finally {
      setRegeneratingPublishedEntryIds((ids) => {
        const nextIds = new Set(ids);
        nextIds.delete(entry.id);
        return nextIds;
      });
    }
  }

  async function requestPublishedEntryMarketingRegeneration({
    category,
    entryId,
    rewriteInstructions,
    summary,
    title,
  }: {
    category: PublishedEntry["category"];
    entryId: string;
    rewriteInstructions?: string;
    summary: string;
    title: string;
  }): Promise<Pick<ApiChangelogEntry, "category" | "summary" | "title">> {
    const response = await fetch(
      `/api/admin/changelog-entries/${encodeURIComponent(entryId)}/regenerate-marketing-copy`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          category: toApiCategory(category),
          rewriteInstructions: rewriteInstructions?.trim() || undefined,
          summary,
          title,
        }),
      },
    );

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(
        body.error ??
          `Marketing copy regeneration failed with ${response.status}`,
      );
    }

    return (await response.json()) as Pick<
      ApiChangelogEntry,
      "category" | "summary" | "title"
    >;
  }

  async function generatePublishedEntryPostImage() {
    if (
      !editingPublishedEntry ||
      !isPersistedPublishedEntry(editingPublishedEntry)
    ) {
      return;
    }

    if (postImageGenerationAvailability.status !== "available") {
      toast.error("Image generation is unavailable.", {
        description:
          postImageGenerationUnavailableReason ??
          postImageGenerationNotConfiguredMessage,
      });
      return;
    }

    try {
      setPostImageGenerationStatus("running");
      const response = await fetch(
        `/api/admin/changelog-entries/${encodeURIComponent(editingPublishedEntry.id)}/generate-image`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            category: toApiCategory(publishedEntryDraft.category),
            summary: publishedEntryDraft.summary,
            title: publishedEntryDraft.title,
          }),
        },
      );

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          unavailable?: boolean;
        };
        const message =
          body.unavailable === true
            ? postImageGenerationUnavailableMessage
            : (body.error ??
              `Post image generation failed with ${response.status}`);
        if (body.unavailable === true) {
          setPostImageGenerationAvailability({
            status: "unavailable",
            reason: postImageGenerationUnavailableMessage,
          });
        }
        throw new Error(message);
      }

      const body = (await response.json()) as ApiChangelogEntry;
      const imageUrl = body.imageUrl ?? null;
      const entryKey = getPublishedEntryKey(editingPublishedEntry);
      setPublishedEntries((entries) =>
        entries.map((entry) =>
          getPublishedEntryKey(entry) === entryKey
            ? { ...entry, imageUrl }
            : entry,
        ),
      );
      setEditingPublishedEntry((current) =>
        current && getPublishedEntryKey(current) === entryKey
          ? { ...current, imageUrl }
          : current,
      );
      toast.success("Post image generated.", {
        description: "Review the image and save any text changes when ready.",
      });
    } catch (error) {
      toast.error("Could not generate post image.", {
        description:
          error instanceof Error
            ? error.message
            : "Try again after checking the post copy.",
      });
    } finally {
      setPostImageGenerationStatus("idle");
    }
  }

  async function uploadPublishedEntryPostImage(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (
      !file ||
      !editingPublishedEntry ||
      !isPersistedPublishedEntry(editingPublishedEntry)
    ) {
      return;
    }

    try {
      setPostImageUploadStatus("running");
      const formData = new FormData();
      formData.append("image", file);
      formData.append("category", toApiCategory(publishedEntryDraft.category));

      const response = await fetch(
        `/api/admin/changelog-entries/${encodeURIComponent(editingPublishedEntry.id)}/image`,
        {
          method: "POST",
          body: formData,
        },
      );

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          body.error ?? `Post image upload failed with ${response.status}`,
        );
      }

      const body = (await response.json()) as ApiChangelogEntry;
      const imageUrl = body.imageUrl ?? null;
      const entryKey = getPublishedEntryKey(editingPublishedEntry);
      setPublishedEntries((entries) =>
        entries.map((entry) =>
          getPublishedEntryKey(entry) === entryKey
            ? { ...entry, imageUrl }
            : entry,
        ),
      );
      setEditingPublishedEntry((current) =>
        current && getPublishedEntryKey(current) === entryKey
          ? { ...current, imageUrl }
          : current,
      );
      toast.success("Post image uploaded.", {
        description: "The public post image was updated.",
      });
    } catch (error) {
      toast.error("Could not upload post image.", {
        description:
          error instanceof Error
            ? error.message
            : "Try again with a PNG, JPEG, WebP, or GIF image.",
      });
    } finally {
      setPostImageUploadStatus("idle");
    }
  }

  async function saveEditedPublishedEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editingPublishedEntry) {
      return;
    }

    const title = publishedEntryDraft.title.trim();
    const summary = publishedEntryDraft.summary.trim();
    const publishedAt = normalizePublishedEntryDraftDate(
      publishedEntryDraft.publishedAt,
    );
    if (!title || !summary || !publishedAt) {
      return;
    }

    const previousEntry = editingPublishedEntry;
    const previousEntryKey = getPublishedEntryKey(previousEntry);
    const optimisticEntry: PublishedEntry = {
      ...previousEntry,
      title,
      summary,
      category: publishedEntryDraft.category,
      publishedAt,
      time: formatPublishedEntryTime(publishedAt),
    };

    setPublishedEntries((entries) =>
      replacePublishedEntry(entries, previousEntryKey, optimisticEntry),
    );
    setEditingPublishedEntry(null);

    try {
      if (isPersistedPublishedEntry(previousEntry)) {
        const response = await fetch(
          `/api/admin/changelog-entries/${encodeURIComponent(previousEntry.id)}`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              title,
              summary,
              category: toApiCategory(publishedEntryDraft.category),
              publishedAt,
            }),
          },
        );

        if (!response.ok) {
          throw new Error(`Changelog update failed with ${response.status}`);
        }

        const body = (await response.json()) as ApiChangelogEntry;
        const confirmedEntry = toPublishedEntry(body);
        setPublishedEntries((entries) =>
          replacePublishedEntry(entries, previousEntryKey, confirmedEntry),
        );
      }

      toast.success("Changelog post updated.");
    } catch {
      setPublishedEntries((entries) =>
        replacePublishedEntry(entries, previousEntryKey, previousEntry),
      );
      setEditingPublishedEntry(previousEntry);
      setPublishedEntryDraft({
        title,
        summary,
        category: publishedEntryDraft.category,
        publishedAt,
      });
      toast.error("Could not update changelog post.");
    }
  }

  function deletePublishedEntry(entry: PublishedEntry) {
    const isHeldDraft = isHeldPublishedEntry(entry);

    setConfirmationDialog({
      title: isHeldDraft ? "Delete held draft?" : "Delete changelog post?",
      description: isHeldDraft
        ? `Delete the held draft for "${entry.title}"? This cannot be undone.`
        : `Delete "${entry.title}" from the changelog? This cannot be undone.`,
      actionLabel: isHeldDraft ? "Delete draft" : "Delete post",
      variant: "destructive",
      onConfirm: () => performDeletePublishedEntry(entry),
    });
  }

  async function performDeletePublishedEntry(entry: PublishedEntry) {
    try {
      if (isPersistedPublishedEntry(entry)) {
        const response = await fetch(
          `/api/admin/changelog-entries/${encodeURIComponent(entry.id)}`,
          { method: "DELETE" },
        );

        if (!response.ok) {
          throw new Error(`Changelog deletion failed with ${response.status}`);
        }
      }

      setPublishedEntries((entries) =>
        entries.filter(
          (item) => getPublishedEntryKey(item) !== getPublishedEntryKey(entry),
        ),
      );
      if (isHeldPublishedEntry(entry)) {
        setHeldEntries((entries) =>
          entries.filter((item) => item.id !== entry.id),
        );
        void loadHeldEntryCountEvent();
      }
      setPublishedEntriesTotal((total) => Math.max(0, total - 1));
      toast.success(
        isHeldPublishedEntry(entry)
          ? "Held draft deleted."
          : "Changelog post deleted.",
      );
    } catch {
      toast.error(
        isHeldPublishedEntry(entry)
          ? "Could not delete held draft."
          : "Could not delete changelog post.",
      );
    }
  }

  function togglePublishedEntrySelected(entry: PublishedEntry) {
    const key = getPublishedEntryKey(entry);
    setSelectedPublishedEntryKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function toggleAllPublishedEntriesSelected() {
    setSelectedPublishedEntryKeys((current) => {
      const entryKeys = publishedEntries
        .filter((entry) => !isHeldPublishedEntry(entry))
        .map(getPublishedEntryKey);
      const allSelected =
        entryKeys.length > 0 && entryKeys.every((key) => current.has(key));
      return allSelected ? new Set() : new Set(entryKeys);
    });
  }

  function deleteSelectedPublishedEntries() {
    const selectedEntries = publishedEntries.filter((entry) =>
      selectedPublishedEntryKeys.has(getPublishedEntryKey(entry)),
    );

    if (selectedEntries.length === 0) {
      return;
    }

    setConfirmationDialog({
      title: "Delete selected posts?",
      description: `Delete ${formatCount(selectedEntries.length, "selected post")} from the changelog? This cannot be undone.`,
      actionLabel: "Delete selected",
      variant: "destructive",
      onConfirm: () => performDeleteSelectedPublishedEntries(selectedEntries),
    });
  }

  async function performDeleteSelectedPublishedEntries(
    selectedEntries: PublishedEntry[],
  ) {
    try {
      await Promise.all(
        selectedEntries.filter(isPersistedPublishedEntry).map(async (entry) => {
          const response = await fetch(
            `/api/admin/changelog-entries/${encodeURIComponent(entry.id)}`,
            { method: "DELETE" },
          );

          if (!response.ok) {
            throw new Error(
              `Changelog deletion failed with ${response.status}`,
            );
          }
        }),
      );

      const selectedKeys = new Set(selectedEntries.map(getPublishedEntryKey));
      setPublishedEntries((entries) =>
        entries.filter(
          (entry) => !selectedKeys.has(getPublishedEntryKey(entry)),
        ),
      );
      setPublishedEntriesTotal((total) =>
        Math.max(0, total - selectedEntries.length),
      );
      setSelectedPublishedEntryKeys(new Set());
      setLogEvents((events) => [
        {
          title: "Posts deleted",
          detail: `${formatCount(selectedEntries.length, "post")} removed from the public changelog.`,
          time: "Now",
        },
        ...events,
      ]);
      toast.success("Selected posts deleted.", {
        description: `${formatCount(selectedEntries.length, "post")} removed from the changelog.`,
      });
    } catch {
      toast.error("Could not delete selected posts.");
    }
  }

  function mergeSelectedPublishedEntries() {
    const selectedEntries = publishedEntries.filter((entry) =>
      selectedPublishedEntryKeys.has(getPublishedEntryKey(entry)),
    );

    if (selectedEntries.length < 2) {
      toast.error("Select at least two posts to merge.");
      return;
    }

    if (!selectedEntries.every(isPersistedPublishedEntry)) {
      toast.error("Only synced changelog posts can be merged with AI.");
      return;
    }

    setConfirmationDialog({
      title: "Merge selected posts with AI?",
      description: `Cooee will rewrite ${formatCount(selectedEntries.length, "selected post")} into one changelog post and store this as a learning for future syncs.`,
      actionLabel: "Merge with AI",
      onConfirm: () => performMergeSelectedPublishedEntries(selectedEntries),
    });
  }

  async function performMergeSelectedPublishedEntries(
    selectedEntries: Array<PublishedEntry & { id: string }>,
  ) {
    try {
      const response = await fetch("/api/admin/changelog-entries/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entryIds: selectedEntries.map((entry) => entry.id),
        }),
      });

      if (!response.ok) {
        throw new Error(`Changelog merge failed with ${response.status}`);
      }

      const body = (await response.json()) as ApiChangelogEntry;
      const mergedEntry = toPublishedEntry(body);
      const selectedKeys = new Set(selectedEntries.map(getPublishedEntryKey));

      setPublishedEntries((entries) => [
        mergedEntry,
        ...entries.filter(
          (entry) => !selectedKeys.has(getPublishedEntryKey(entry)),
        ),
      ]);
      setPublishedEntriesTotal((total) =>
        Math.max(0, total - selectedEntries.length + 1),
      );
      setSelectedPublishedEntryKeys(new Set());
      setLogEvents((events) => [
        {
          title: "Posts merged",
          detail: `${formatCount(selectedEntries.length, "post")} merged into ${mergedEntry.title}.`,
          time: "Now",
        },
        ...events,
      ]);
      toast.success("Posts merged with AI.", {
        description: `${mergedEntry.title} replaced the selected posts.`,
      });
    } catch {
      toast.error("Could not merge selected posts.");
    }
  }

  function markPublishedEntryNotRelevant(entry: PublishedEntry) {
    setConfirmationDialogInput("");
    setConfirmationDialog({
      title: "Dismiss this post?",
      description: `Cooee will remove "${entry.title}" and use your feedback to improve future identification and writing for this changelog.`,
      actionLabel: "Dismiss post",
      variant: "destructive",
      input: {
        label: "What should Cooee learn? (optional)",
        placeholder:
          "For example: dependency-only updates are not relevant to our readers.",
        maxLength: 500,
      },
      onConfirm: (feedback) =>
        performMarkPublishedEntryNotRelevant(entry, feedback),
    });
  }

  async function performMarkPublishedEntryNotRelevant(
    entry: PublishedEntry,
    feedback: string,
  ) {
    try {
      if (isPersistedPublishedEntry(entry)) {
        const response = await fetch(
          `/api/admin/changelog-entries/${encodeURIComponent(entry.id)}/not-relevant`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              note:
                feedback.trim() ||
                "Dismissed as not relevant from the changelog editor.",
            }),
          },
        );

        if (!response.ok) {
          throw new Error(
            `Changelog relevance feedback failed with ${response.status}`,
          );
        }
      }

      setPublishedEntries((entries) =>
        entries.filter(
          (item) => getPublishedEntryKey(item) !== getPublishedEntryKey(entry),
        ),
      );
      setPublishedEntriesTotal((total) => Math.max(0, total - 1));
      setLogEvents((events) => [
        {
          title: "Post dismissed",
          detail: `${entry.title} was removed and saved as AI feedback.`,
          time: "Now",
        },
        ...events,
      ]);
      toast.success("Post dismissed.", {
        description:
          "Cooee will use this learning for future posts in this changelog.",
      });
    } catch {
      toast.error("Could not mark post as not relevant.");
    }
  }

  function closeOnboarding() {
    markOnboardingCompleted();
    const nextSettings = {
      ...settingsRef.current,
      onboardingCompleted: true,
    };
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
    setIsOnboardingOpen(false);
    void persistOnboardingCompleted();
    toast.success("Setup saved.", {
      description: "Your onboarding preferences were saved.",
    });
  }

  if (surface === "publicChangelog") {
    return (
      <>
        <PublicChangelogRoute slug={getCurrentPublicChangelogSlug()} />
        <Toaster theme={theme} />
      </>
    );
  }

  if (surface === "notFound") {
    return <NotFoundPage />;
  }

  if (
    (surface === "login" && (authSessionStatus === "loading" || !isSignedIn)) ||
    (deploymentMode === "admin" &&
      typeof window !== "undefined" &&
      authSessionStatus === "ready" &&
      !isSignedIn)
  ) {
    return (
      <>
        <AdminLoginPage
          error={githubConnection.error}
          isLoading={
            authSessionStatus === "loading" || signInStatus === "running"
          }
          onSignIn={() => void signInWithGitHub()}
          publicSiteUrl={publicSiteUrl}
        />
        <Toaster theme={theme} />
      </>
    );
  }

  if (
    shouldShowAdminSessionLoadingPage({
      authSessionStatus,
      deploymentMode,
      surface,
    })
  ) {
    return <AdminSessionLoadingPage />;
  }

  return (
    <>
      <div className="app-shell min-h-screen bg-muted/45 p-2 text-foreground sm:p-3">
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <div className="app-frame mx-auto grid min-h-[calc(100vh-1rem)] w-full items-start gap-2 sm:min-h-[calc(100vh-1.5rem)] sm:gap-3 lg:grid-cols-[16.5rem_minmax(0,1fr)]">
          <aside className="app-sidebar rounded-[1.75rem] border border-border/70 bg-card shadow-[0_18px_48px_-36px_rgb(0_0_0_/_0.42)] lg:sticky lg:top-3 lg:h-[calc(100vh-1.5rem)]">
            <div className="flex min-h-full flex-col gap-5 p-4 sm:p-5 lg:gap-7">
              <div className="flex flex-col gap-3">
                <AnimatedCooeeLogo
                  className="brand-logo h-6 w-auto self-start"
                  playOnMount
                />
                <p className="max-w-[16rem] text-xs leading-5 text-muted-foreground">
                  Changelogs on autopilot
                </p>
              </div>

              {orderedConnectedRepositories.length > 1 ? (
                <div>
                  <Select
                    items={repositorySelectItems}
                    onValueChange={(repositoryId) => {
                      if (repositoryId) {
                        switchRepository(repositoryId);
                      }
                    }}
                    value={activeRepository?.id ?? ""}
                  >
                    <SelectTrigger
                      aria-label="Switch repository"
                      className="h-10 w-full bg-background"
                    >
                      <SelectValue placeholder="Select repository" />
                    </SelectTrigger>
                    <SelectContent align="start" alignItemWithTrigger={false}>
                      <SelectGroup>
                        {repositorySelectItems.map((repository) => (
                          <SelectItem
                            key={repository.value}
                            value={repository.value}
                          >
                            {repository.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              <nav
                className="grid grid-cols-2 gap-1.5 text-sm sm:grid-cols-4 lg:flex lg:flex-col"
                aria-label="Main navigation"
              >
                {navItems.map(({ id, label, icon: Icon }) => {
                  const isPrivacyReview = id === "privacy";

                  return (
                    <button
                      type="button"
                      className={[
                        "flex h-10 items-center gap-3 rounded-xl px-3 text-left transition-[background-color,color,box-shadow]",
                        visibleActiveView === id
                          ? "bg-background text-foreground shadow-xs ring-1 ring-foreground/8"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      ].join(" ")}
                      aria-current={
                        visibleActiveView === id ? "page" : undefined
                      }
                      key={id}
                      onClick={() => goToView(id)}
                    >
                      <Icon aria-hidden className="size-4 shrink-0" />
                      <span>{label}</span>
                      {isPrivacyReview ? (
                        <Badge
                          aria-label={
                            heldEntryCount === null
                              ? "Loading held-review count"
                              : `${heldEntryCount} held for review`
                          }
                          className="ml-auto"
                          variant="secondary"
                        >
                          {heldEntryCount ?? "—"}
                        </Badge>
                      ) : null}
                    </button>
                  );
                })}
                <a
                  className="flex h-10 items-center gap-3 rounded-xl px-3 text-left text-muted-foreground transition-[background-color,color,box-shadow] hover:bg-muted hover:text-foreground"
                  href={`${publicSiteUrl}/docs`}
                >
                  <BookOpenIcon aria-hidden className="size-4 shrink-0" />
                  <span>Docs</span>
                </a>
              </nav>

              {showCloudAccountMenu ? (
                <SidebarUserMenu
                  authUser={authUser}
                  appName={appName}
                  onOpenBilling={() => goToView("billing")}
                  onOpenGitHub={() => goToView("repositories")}
                  onSignOut={() => void signOut()}
                />
              ) : null}
            </div>
          </aside>

          <main
            className="app-main-panel min-h-[calc(100vh-1rem)] min-w-0 overflow-clip rounded-[1.75rem] border border-border/70 bg-background shadow-[0_18px_48px_-36px_rgb(0_0_0_/_0.42)] sm:min-h-[calc(100vh-1.5rem)]"
            id="main-content"
          >
            <header className="app-command-bar sticky top-2 z-30 border-b border-border/70 bg-background/92 px-3 py-3 backdrop-blur-xl sm:top-3 sm:px-4 lg:px-5">
              <div className="flex w-full translate-y-px flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <h1 className="truncate text-balance text-lg font-semibold tracking-normal">
                    {pageTitle}
                  </h1>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 2xl:justify-end">
                  <HeaderWorkspaceStatus
                    aiCreditUsageLabel={aiCreditUsageLabel}
                    aiCreditUsagePercent={aiCreditUsagePercent}
                    aiCreditResetLabel={aiCreditResetLabel}
                    billingUsageStatus={billingUsageStatus}
                    nextScheduledRunLabel={nextScheduledRunLabel}
                    scheduleFrequency={settings.scheduleFrequency}
                    scheduleTimeZone={settings.timeZone}
                  />
                  <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                    <Button
                      className="text-xs"
                      onClick={() => setIsManualModalOpen(true)}
                      size="sm"
                      variant="outline"
                    >
                      <SendIcon data-icon="inline-start" aria-hidden />
                      Post update
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            aria-label="More actions"
                            size="icon-sm"
                            title="More actions"
                            variant="outline"
                          />
                        }
                      >
                        <EllipsisIcon aria-hidden />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuGroup>
                          <DropdownMenuItem
                            render={
                              <a
                                href={activePublicChangelogUrl}
                                rel="noreferrer"
                                target="_blank"
                              />
                            }
                          >
                            <ExternalLinkIcon
                              data-icon="inline-start"
                              aria-hidden
                            />
                            View changelog
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!activeRepository?.changelogId}
                            onClick={() => {
                              setBackfillDateRange(
                                getDefaultBackfillDateRange(),
                              );
                              setHistoricalBackfillStatus("idle");
                              setHistoricalBackfillResult(null);
                              setIsBackfillDialogOpen(true);
                            }}
                          >
                            <CalendarClockIcon
                              data-icon="inline-start"
                              aria-hidden
                            />
                            Backfill
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setTheme(nextTheme)}>
                            {theme === "dark" ? (
                              <SunIcon data-icon="inline-start" aria-hidden />
                            ) : (
                              <MoonIcon data-icon="inline-start" aria-hidden />
                            )}
                            {themeLabel}
                          </DropdownMenuItem>
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </div>
            </header>

            <div className="app-view px-4 py-7 sm:px-6 sm:py-9 lg:px-8 xl:px-10 xl:py-10">
              {visibleActiveView === "dashboard" ? (
                <DashboardView
                  categoryDefinitions={settings.categoryDefinitions}
                  onDeletePublishedEntry={deletePublishedEntry}
                  onEditPublishedEntry={openEditPublishedEntry}
                  onOpenHeldEntryReview={openHeldEntryReview}
                  onPublishedEntryDateRangeChange={
                    updatePublishedEntryDateRange
                  }
                  onPublishedEntryPageChange={setPublishedEntriesPage}
                  onPublishedEntryPageSizeChange={
                    updatePublishedEntriesPageSize
                  }
                  onPublishedEntrySearchChange={updatePublishedEntrySearch}
                  onClearPublishedEntryFilters={clearPublishedEntryFilters}
                  onDeleteSelectedPublishedEntries={
                    deleteSelectedPublishedEntries
                  }
                  onMergeSelectedPublishedEntries={
                    mergeSelectedPublishedEntries
                  }
                  onMarkPublishedEntryNotRelevant={
                    markPublishedEntryNotRelevant
                  }
                  onRegenerateHeldEntry={regenerateHeldEntry}
                  onRegeneratePublishedEntry={rewritePublishedEntryFromList}
                  onToggleAllPublishedEntriesSelected={
                    toggleAllPublishedEntriesSelected
                  }
                  onTogglePublishedEntrySelected={togglePublishedEntrySelected}
                  publishedEntryDateFrom={publishedEntryDateFrom}
                  publishedEntryDateTo={publishedEntryDateTo}
                  publishedEntryPage={publishedEntriesPage}
                  publishedEntryPageSize={publishedEntriesPageSize}
                  publishedEntrySearch={publishedEntrySearch}
                  publishedEntriesLoading={publishedEntriesLoading}
                  publishedEntries={publishedEntries}
                  publishedEntriesTotal={publishedEntriesTotal}
                  publishedEntriesTotalPages={publishedEntriesTotalPages}
                  publicTheme={theme}
                  regeneratingHeldEntryIds={regeneratingHeldEntryIds}
                  regeneratingPublishedEntryIds={regeneratingPublishedEntryIds}
                  selectedPublishedEntryKeys={selectedPublishedEntryKeys}
                />
              ) : null}

              {visibleActiveView === "repositories" ? (
                <RepositoriesView
                  githubConnection={githubConnection}
                  onConnectRepository={connectRepository}
                  onRefreshRepositories={loadGitHubConnection}
                  onSelectRepository={selectRepository}
                  onSignInWithGitHub={signInWithGitHub}
                  initialRepositorySearch={initialRepositorySearch}
                  repositoryVisibility={repositoryVisibility}
                  setRepositoryVisibility={setRepositoryVisibility}
                />
              ) : null}

              {visibleActiveView === "privacy" ? (
                <PrivacyReviewView
                  draftCopy={draftCopy}
                  editingSource={editingSource}
                  heldEntries={heldEntries}
                  regeneratingHeldEntryIds={regeneratingHeldEntryIds}
                  onMarkHeldEntryRelevant={markHeldEntryRelevant}
                  onPublishHeldEntry={publishHeldEntry}
                  onRegenerateHeldEntry={regenerateHeldEntry}
                  setDraftCopy={setDraftCopy}
                  setEditingSource={setEditingSource}
                />
              ) : null}

              {showCloudAccountMenu && visibleActiveView === "billing" ? (
                <BillingView
                  connectedRepoCount={connectedRepoCount}
                  customerEmail={getAuthUserContactEmail(authUser)}
                />
              ) : null}

              {visibleActiveView === "settings" ? (
                <SettingsView
                  customBrandingEnabled={
                    billingUsage?.entitlements.customBranding ?? false
                  }
                  customDomainActionStatus={customDomainActionStatus}
                  onSaveCustomDomain={saveCustomDomain}
                  onRefreshCustomDomainStatus={refreshCustomDomainStatus}
                  setSettings={updateSettings}
                  settings={settings}
                  defaultAppName={defaultAppName}
                />
              ) : null}
            </div>
          </main>
        </div>

        {isManualModalOpen ? (
          <ManualUpdateSheet
            categoryDefinitions={settings.categoryDefinitions}
            manualUpdate={manualUpdate}
            onClose={() => setIsManualModalOpen(false)}
            onPostManualUpdate={postManualUpdate}
            setManualUpdate={setManualUpdate}
          />
        ) : null}

        {editingPublishedEntry ? (
          <EditPublishedEntrySheet
            canGeneratePostImage={
              isPersistedPublishedEntry(editingPublishedEntry) &&
              getChangelogCategoryDisplayType(
                publishedEntryDraft.category,
                settings.categoryDefinitions,
              ) === "post"
            }
            canRegenerateMarketingCopy={isPersistedPublishedEntry(
              editingPublishedEntry,
            )}
            categoryDefinitions={settings.categoryDefinitions}
            entryDraft={publishedEntryDraft}
            rewriteInstructions={publishedEntryRewriteInstructions}
            imageUrl={editingPublishedEntry.imageUrl ?? null}
            isGeneratingPostImage={postImageGenerationStatus === "running"}
            postImageGenerationAvailabilityStatus={
              postImageGenerationAvailability.status
            }
            isRegeneratingMarketingCopy={
              marketingRegenerationStatus === "running"
            }
            isUploadingPostImage={postImageUploadStatus === "running"}
            onClose={() => setEditingPublishedEntry(null)}
            onGeneratePostImage={generatePublishedEntryPostImage}
            onRegenerateMarketingCopy={regeneratePublishedEntryMarketingCopy}
            onSaveEditedEntry={saveEditedPublishedEntry}
            onUploadPostImage={uploadPublishedEntryPostImage}
            setEntryDraft={setPublishedEntryDraft}
            setRewriteInstructions={setPublishedEntryRewriteInstructions}
            sourcePullRequests={editingPublishedEntry.sourcePullRequests ?? []}
          />
        ) : null}

        <HistoricalBackfillDialog
          activeRepositoryName={activeRepository?.fullName ?? null}
          dateRange={backfillDateRange}
          onDateRangeChange={setBackfillDateRange}
          onOpenChange={(open) => {
            if (historicalBackfillStatus === "running") {
              setIsBackfillDialogOpen(open);
              return;
            }

            setIsBackfillDialogOpen(open);
            if (!open) {
              setHistoricalBackfillStatus("idle");
              setHistoricalBackfillResult(null);
            }
          }}
          onRun={() => runHistoricalBackfill(backfillDateRange)}
          open={isBackfillDialogOpen}
          result={historicalBackfillResult}
          status={historicalBackfillStatus}
        />

        {shouldRenderOnboarding ? (
          <OnboardingWizardModal
            currentStep={onboardingStep}
            onClose={closeOnboarding}
            onConnectRepository={() => {
              closeOnboarding();
              connectRepository();
            }}
            setCurrentStep={setOnboardingStep}
            setSettings={updateSettings}
            settings={settings}
          />
        ) : null}

        <AlertDialog
          open={confirmationDialog !== null}
          onOpenChange={(open) => {
            if (!open) {
              setConfirmationDialog(null);
              setConfirmationDialogInput("");
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{confirmationDialog?.title}</AlertDialogTitle>
              <AlertDialogDescription>
                {confirmationDialog?.description}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {confirmationDialog?.input ? (
              <label className="grid gap-2">
                <span className="text-sm font-medium">
                  {confirmationDialog.input.label}
                </span>
                <Textarea
                  aria-label={confirmationDialog.input.label}
                  className="min-h-24 resize-y leading-6"
                  maxLength={confirmationDialog.input.maxLength}
                  onChange={(event) =>
                    setConfirmationDialogInput(event.target.value)
                  }
                  placeholder={confirmationDialog.input.placeholder}
                  value={confirmationDialogInput}
                />
              </label>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const action = confirmationDialog?.onConfirm;
                  const inputValue = confirmationDialogInput;
                  setConfirmationDialog(null);
                  setConfirmationDialogInput("");
                  void action?.(inputValue);
                }}
                variant={confirmationDialog?.variant ?? "default"}
              >
                {confirmationDialog?.actionLabel}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      <Toaster theme={theme} />
    </>
  );
}

function HeaderWorkspaceStatus({
  aiCreditUsageLabel,
  aiCreditUsagePercent,
  aiCreditResetLabel,
  billingUsageStatus,
  nextScheduledRunLabel,
  scheduleFrequency,
  scheduleTimeZone,
}: {
  aiCreditUsageLabel: string | null;
  aiCreditUsagePercent: number | null;
  aiCreditResetLabel: string | null;
  billingUsageStatus: "loading" | "ready" | "error";
  nextScheduledRunLabel: string | null;
  scheduleFrequency: ScheduleFrequency;
  scheduleTimeZone: string;
}) {
  return (
    <div
      aria-label="Workspace status"
      className="flex w-full flex-wrap items-center gap-x-5 gap-y-2 sm:w-auto"
    >
      <div className="w-32 min-w-0">
        <div className="flex items-center justify-between gap-3 text-[0.6875rem] leading-4">
          <span className="font-medium text-muted-foreground">Credits</span>
          <span
            aria-label="Credits usage"
            className="truncate font-semibold tabular-nums"
          >
            {aiCreditUsageLabel ??
              (billingUsageStatus === "loading" ? (
                <Skeleton className="h-4 w-12" />
              ) : (
                "Unavailable"
              ))}
          </span>
        </div>
        <UsageMeter
          className="mt-1 h-1 bg-muted"
          value={aiCreditUsagePercent ?? 0}
        />
      </div>
      <div className="flex min-w-0 items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">Resets on</span>
        <span className="truncate font-semibold tabular-nums">
          {aiCreditResetLabel ??
            (billingUsageStatus === "loading" ? (
              <Skeleton className="h-4 w-20" />
            ) : (
              "Unavailable"
            ))}
        </span>
      </div>
      <div
        className="flex min-w-0 items-center gap-1.5 text-xs"
        title={
          nextScheduledRunLabel && scheduleFrequency !== "on-merge"
            ? `${nextScheduledRunLabel} (${scheduleTimeZone})`
            : undefined
        }
      >
        <span className="text-muted-foreground">Next automatic run</span>
        <span className="truncate font-semibold tabular-nums">
          {nextScheduledRunLabel ?? <Skeleton className="h-4 w-28" />}
        </span>
      </div>
    </div>
  );
}

function SidebarUserMenu({
  appName,
  authUser,
  onOpenBilling,
  onOpenGitHub,
  onSignOut,
}: {
  appName: string;
  authUser: AuthUser | null;
  onOpenBilling: () => void;
  onOpenGitHub: () => void;
  onSignOut: () => void;
}) {
  const displayName = getAuthUserDisplayName(authUser, appName);
  const email = getAuthUserContactEmail(authUser);
  const initials = getAuthUserInitials(displayName);

  return (
    <DropdownMenu>
      <div className="mt-auto border-t pt-4">
        <DropdownMenuTrigger
          render={
            <Button
              className="h-auto w-full justify-between rounded-full px-2.5 py-2 text-left"
              type="button"
              variant="ghost"
            />
          }
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
              {initials ? (
                initials
              ) : (
                <UserCircleIcon aria-hidden className="size-4" />
              )}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {displayName}
              </span>
              {email ? (
                <span className="block truncate text-xs text-muted-foreground">
                  {email}
                </span>
              ) : null}
            </span>
          </span>
          <ChevronDownIcon
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground"
          />
        </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent
        align="start"
        className="w-(--anchor-width)"
        side="top"
        sideOffset={8}
      >
        <DropdownMenuItem onClick={onOpenGitHub}>
          <GithubIcon aria-hidden className="text-muted-foreground" />
          GitHub
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onOpenBilling}>
          <CreditCardIcon aria-hidden className="text-muted-foreground" />
          Billing
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onSignOut}>
          <LogOutIcon aria-hidden className="size-4" />
          Logout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function getAuthUserDisplayName(
  authUser: AuthUser | null,
  fallback: string,
): string {
  return (
    authUser?.name?.trim() || getAuthUserContactEmail(authUser) || fallback
  );
}

export function getAuthUserContactEmail(
  authUser: AuthUser | null,
): string | null {
  const email = authUser?.email?.trim() || null;
  return email?.endsWith("@auth.cooee.invalid") ? null : email;
}

function getAuthUserInitials(value: string): string {
  return value
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function PublicChangelogRoute({ slug }: { slug: string | null }) {
  const [state, setState] = useState<PublicChangelogLoadState>({
    status: "loading",
  });
  const publicChangelogLoadCursorRef = useRef<string | null>(null);

  useEffect(() => {
    let ignore = false;

    async function loadPublicChangelog() {
      setState({ status: "loading" });

      try {
        const response = await fetch(getPublicChangelogFeedPath(slug));
        if (!response.ok) {
          throw new Error(`Changelog feed failed with ${response.status}`);
        }

        const body = (await response.json()) as ApiPublicChangelogFeed;
        const entries = (body.entries ?? []).map(toPublishedEntry);
        const appName = body.changelog?.name?.trim() || "Cooee";
        const description = body.changelog?.description?.trim() || null;
        const publicUrl =
          body.changelog?.publicUrl?.trim() ||
          (typeof window === "undefined"
            ? getPublicChangelogPath(slug ?? "changelog")
            : window.location.href);
        const logoUrl = body.changelog?.logoUrl?.trim() || null;
        const lightLogoUrl = body.changelog?.lightLogoUrl?.trim() || null;
        const faviconUrl = body.changelog?.faviconUrl?.trim() || null;
        const categoryDefinitions = normalizeChangelogCategoryDefinitions(
          body.changelog?.categoryDefinitions,
        );
        const groupEntriesByCategory =
          body.changelog?.groupEntriesByCategory ?? true;
        const publicTheme = normalizeThemeMode(body.changelog?.publicTheme);
        const publicLogoAlignment = normalizePublicLogoAlignment(
          body.changelog?.publicLogoAlignment,
        );
        const publicAppUrl = body.changelog?.publicAppUrl?.trim() ?? "";
        const publicAppLabel = normalizePublicAppLabel(
          body.changelog?.publicAppLabel,
        );

        if (!ignore) {
          setState({
            status: "ready",
            appName,
            description,
            entries,
            categoryDefinitions,
            groupEntriesByCategory,
            publicTheme,
            publicLogoAlignment,
            publicUrl,
            publicAppUrl,
            publicAppLabel,
            logoUrl,
            lightLogoUrl,
            faviconUrl,
            pagination: normalizePublicChangelogPagination(body.pagination),
            isLoadingMoreEntries: false,
            loadMoreError: null,
          });
        }
      } catch {
        if (!ignore) {
          setState({
            status: "error",
            message: "This changelog is not available.",
          });
        }
      }
    }

    void loadPublicChangelog();

    return () => {
      ignore = true;
    };
  }, [slug]);

  const loadOlderPublicChangelogEntries = useCallback(async () => {
    if (
      state.status !== "ready" ||
      state.isLoadingMoreEntries ||
      !state.pagination.hasMore ||
      !state.pagination.nextBefore ||
      publicChangelogLoadCursorRef.current === state.pagination.nextBefore
    ) {
      return;
    }

    const before = state.pagination.nextBefore;
    publicChangelogLoadCursorRef.current = before;
    setState((current) =>
      current.status === "ready" && current.pagination.nextBefore === before
        ? { ...current, isLoadingMoreEntries: true, loadMoreError: null }
        : current,
    );

    try {
      const response = await fetch(getPublicChangelogFeedPath(slug, before));
      if (!response.ok) {
        throw new Error(`Changelog feed failed with ${response.status}`);
      }

      const body = (await response.json()) as ApiPublicChangelogFeed;
      const olderEntries = (body.entries ?? []).map(toPublishedEntry);
      const pagination = normalizePublicChangelogPagination(body.pagination);

      setState((current) => {
        if (current.status !== "ready") {
          return current;
        }

        return {
          ...current,
          entries: mergePublicChangelogEntries(current.entries, olderEntries),
          pagination,
          isLoadingMoreEntries: false,
          loadMoreError: null,
        };
      });
    } catch {
      setState((current) =>
        current.status === "ready"
          ? {
              ...current,
              isLoadingMoreEntries: false,
              loadMoreError: "Could not load older updates.",
            }
          : current,
      );
    } finally {
      publicChangelogLoadCursorRef.current = null;
    }
  }, [slug, state]);

  useEffect(() => {
    if (state.status !== "ready") {
      return;
    }

    applyPublicChangelogSeoMetadata({
      appName: state.appName,
      description: state.description,
      faviconUrl: state.faviconUrl,
      publicUrl: state.publicUrl,
    });
  }, [state]);

  if (state.status === "ready") {
    return (
      <PublicChangelogPage
        appName={state.appName}
        categoryDefinitions={state.categoryDefinitions}
        entries={state.entries}
        groupEntriesByCategory={state.groupEntriesByCategory}
        logoDataUrl={state.logoUrl}
        lightLogoDataUrl={state.lightLogoUrl}
        publicTheme={state.publicTheme}
        publicLogoAlignment={state.publicLogoAlignment}
        publicAppLabel={state.publicAppLabel}
        publicAppUrl={state.publicAppUrl}
        hasMoreEntries={state.pagination.hasMore}
        isLoadingMoreEntries={state.isLoadingMoreEntries}
        loadMoreError={state.loadMoreError}
        onLoadMoreEntries={loadOlderPublicChangelogEntries}
        visibleRepositories={[]}
      />
    );
  }

  if (state.status === "loading") {
    return null;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-3xl items-center px-6 py-6">
        <a
          href="/"
          aria-label="Cooee home"
          className="home-logo-link inline-flex items-center"
        >
          <AnimatedCooeeLogo className="h-4 w-auto" />
        </a>
      </header>

      <main className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-3xl items-center px-6 py-16">
        <section className="w-full border-t border-border pt-10">
          <h1 className="max-w-xl text-2xl font-semibold tracking-normal text-foreground sm:text-3xl">
            Changelog not found
          </h1>
        </section>
      </main>
    </div>
  );
}

export function PublicChangelogPage({
  appName,
  categoryDefinitions = defaultChangelogCategoryDefinitions,
  embedded = false,
  entries,
  groupEntriesByCategory = true,
  hasMoreEntries = false,
  isLoadingMoreEntries = false,
  lightLogoDataUrl = null,
  loadMoreError = null,
  logoDataUrl,
  onLoadMoreEntries,
  onThemeChange,
  publicTheme = "light",
  publicLogoAlignment = "left",
  publicAppLabel = defaultPublicAppLabel,
  publicAppUrl,
  showBranding = true,
  visibleRepositories: _visibleRepositories,
}: {
  appName: string;
  categoryDefinitions?: ChangelogCategoryDefinition[];
  embedded?: boolean;
  entries: PublishedEntry[];
  groupEntriesByCategory?: boolean;
  hasMoreEntries?: boolean;
  isLoadingMoreEntries?: boolean;
  lightLogoDataUrl?: string | null;
  loadMoreError?: string | null;
  logoDataUrl: string | null;
  onLoadMoreEntries?: () => void;
  onThemeChange?: (theme: ThemeMode) => void;
  publicTheme?: ThemeMode;
  publicLogoAlignment?: PublicLogoAlignment;
  publicAppLabel?: string;
  publicAppUrl: string;
  showBranding?: boolean;
  visibleRepositories: PublicPreviewRepository[];
}) {
  const escapedAppName = appName.trim() || "Cooee";
  const configuredPublicTheme = normalizeThemeMode(publicTheme);
  const logoAlignment = normalizePublicLogoAlignment(publicLogoAlignment);
  const [currentPublicTheme, setCurrentPublicTheme] = useState<ThemeMode>(() =>
    embedded
      ? configuredPublicTheme
      : getRememberedPublicChangelogTheme(configuredPublicTheme),
  );
  const nextPublicTheme = currentPublicTheme === "dark" ? "light" : "dark";
  const activeLogoUrl =
    currentPublicTheme === "light"
      ? lightLogoDataUrl || logoDataUrl
      : logoDataUrl || lightLogoDataUrl;
  const publicThemeToggleLabel = `Switch to ${nextPublicTheme} mode`;
  const resolvedCategoryDefinitions =
    normalizeChangelogCategoryDefinitions(categoryDefinitions);
  const publicCategories = resolvedCategoryDefinitions.map(
    (definition) => definition.id,
  );
  const allPublicCategoryFilterKey = publicCategories.join("|");
  const [publicEntrySearch, setPublicEntrySearch] = useState("");
  const [publicEntryDateFrom, setPublicEntryDateFrom] = useState("");
  const [publicEntryDateTo, setPublicEntryDateTo] = useState("");
  const selectedPublicDateRange = toDateRange(
    publicEntryDateFrom,
    publicEntryDateTo,
  );
  const [isPublicFiltersOpen, setIsPublicFiltersOpen] = useState(false);
  const [isPublicDateRangeOpen, setIsPublicDateRangeOpen] = useState(false);
  const [draftPublicDateRange, setDraftPublicDateRange] = useState<
    DateRange | undefined
  >(selectedPublicDateRange);
  const [selectedPublicCategories, setSelectedPublicCategories] = useState<
    Set<PublishedEntry["category"]>
  >(() => new Set(publicCategories));
  const selectedCategoryKey = getPublicCategoryFilterKey(
    selectedPublicCategories,
    publicCategories,
  );
  const filteredEntries = filterPublicEntries(entries, {
    categories: selectedPublicCategories,
    categoryDefinitions: resolvedCategoryDefinitions,
    dateFrom: publicEntryDateFrom,
    dateTo: publicEntryDateTo,
    search: publicEntrySearch,
  });
  const dateGroups = groupPublicEntriesByDate(
    filteredEntries,
    resolvedCategoryDefinitions,
  );
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const hasLoadMoreControl = hasMoreEntries && Boolean(onLoadMoreEntries);
  const appUrl = publicAppUrl.trim();
  const appLabel = normalizePublicAppLabel(publicAppLabel);
  const publicFilterToggleLabel = "Filter changelog updates";
  const hasFilters = Boolean(
    publicEntrySearch ||
    publicEntryDateFrom ||
    publicEntryDateTo ||
    selectedCategoryKey !== allPublicCategoryFilterKey,
  );

  useEffect(() => {
    setDraftPublicDateRange(
      toDateRange(publicEntryDateFrom, publicEntryDateTo),
    );
  }, [publicEntryDateFrom, publicEntryDateTo]);

  useEffect(() => {
    setCurrentPublicTheme(
      embedded
        ? configuredPublicTheme
        : getRememberedPublicChangelogTheme(configuredPublicTheme),
    );
  }, [configuredPublicTheme, embedded]);

  useEffect(() => {
    if (embedded) {
      return;
    }

    document.documentElement.dataset.theme = currentPublicTheme;
  }, [currentPublicTheme, embedded]);

  useEffect(() => {
    onThemeChange?.(currentPublicTheme);
  }, [currentPublicTheme, onThemeChange]);

  useEffect(() => {
    if (!hasLoadMoreControl || isLoadingMoreEntries) {
      return;
    }

    const target = loadMoreRef.current;
    if (!target || typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      (observedEntries) => {
        if (observedEntries.some((entry) => entry.isIntersecting)) {
          onLoadMoreEntries?.();
        }
      },
      { rootMargin: "600px 0px" },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [hasLoadMoreControl, isLoadingMoreEntries, onLoadMoreEntries]);

  function updatePublicTheme(theme: ThemeMode) {
    setCurrentPublicTheme(theme);
    if (!embedded) {
      persistPublicChangelogTheme(theme);
    }
  }

  function togglePublicCategoryFilter(category: PublishedEntry["category"]) {
    setSelectedPublicCategories((current) => {
      const isAllSelected = publicCategories.every((item) => current.has(item));
      const next = isAllSelected
        ? new Set<PublishedEntry["category"]>()
        : new Set(current);

      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }

      return next.size === 0 ? new Set(publicCategories) : next;
    });
  }

  function clearPublicFilters() {
    setPublicEntrySearch("");
    setPublicEntryDateFrom("");
    setPublicEntryDateTo("");
    setSelectedPublicCategories(new Set(publicCategories));
  }

  const PublicChangelogContentRoot = embedded ? "div" : "main";

  return (
    <div
      className={cn(
        "bg-background text-foreground",
        embedded ? "min-h-full" : "min-h-screen",
      )}
      data-theme={currentPublicTheme}
      data-public-changelog-embedded={embedded ? "" : undefined}
    >
      {!embedded ? (
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
      ) : null}
      <PublicChangelogContentRoot
        className={cn(
          "mx-auto max-w-3xl px-6",
          embedded ? "py-10 max-sm:py-8" : "py-16 max-sm:py-10",
        )}
        id={embedded ? undefined : "main-content"}
      >
        <header className="mb-9 border-b border-border pb-6">
          {showBranding && activeLogoUrl ? (
            <div
              className={cn(
                "mb-8 flex items-center",
                logoAlignment === "center" && "justify-center",
                logoAlignment === "right" && "justify-end",
                logoAlignment === "left" && "justify-start",
              )}
              data-public-logo-alignment={logoAlignment}
            >
              <img
                className="block h-9 max-w-[180px] object-contain"
                src={activeLogoUrl}
                alt={`${escapedAppName} logo`}
              />
            </div>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h1 className="text-balance text-3xl font-semibold leading-tight tracking-normal text-foreground">
              {escapedAppName} changelog
            </h1>
            <div
              className="flex flex-wrap items-center gap-2"
              data-public-header-actions
            >
              <Button
                className="rounded-full"
                aria-label={publicThemeToggleLabel}
                onClick={() => updatePublicTheme(nextPublicTheme)}
                size="icon-sm"
                type="button"
                variant="outline"
              >
                {currentPublicTheme === "dark" ? (
                  <SunIcon data-icon="inline-start" aria-hidden />
                ) : (
                  <MoonIcon data-icon="inline-start" aria-hidden />
                )}
                <span className="sr-only">{publicThemeToggleLabel}</span>
              </Button>
              <Button
                className="rounded-full"
                aria-controls="public-changelog-filters"
                aria-label={publicFilterToggleLabel}
                aria-expanded={isPublicFiltersOpen}
                data-public-filter-toggle
                onClick={() => setIsPublicFiltersOpen((open) => !open)}
                size="icon-sm"
                type="button"
                variant={hasFilters ? "default" : "outline"}
              >
                <ListFilterIcon data-icon="inline-start" aria-hidden />
                <span className="sr-only">{publicFilterToggleLabel}</span>
              </Button>
              {appUrl ? (
                <a
                  className={cn(
                    buttonVariants({ size: "sm", variant: "outline" }),
                    "rounded-full text-sm",
                  )}
                  data-public-app-link
                  href={appUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  {appLabel}
                </a>
              ) : null}
            </div>
          </div>
        </header>

        {isPublicFiltersOpen ? (
          <section
            aria-label="Filter changelog updates"
            className="mb-8 grid gap-3 rounded-2xl border border-border/70 bg-card/80 p-4 text-card-foreground shadow-xs"
            id="public-changelog-filters"
          >
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_18rem_auto] md:items-end">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">
                  Search
                </span>
                <Input
                  className="h-9 text-sm"
                  onChange={(event) => setPublicEntrySearch(event.target.value)}
                  placeholder="Title or summary"
                  type="search"
                  value={publicEntrySearch}
                />
              </label>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-normal text-muted-foreground">
                  Date range
                </span>
                <Popover
                  open={isPublicDateRangeOpen}
                  onOpenChange={setIsPublicDateRangeOpen}
                >
                  <PopoverTrigger
                    render={
                      <Button
                        className={cn(
                          "h-9 justify-start overflow-hidden px-3 text-left text-sm font-normal",
                          !selectedPublicDateRange && "text-muted-foreground",
                        )}
                        type="button"
                        variant="outline"
                      />
                    }
                  >
                    <CalendarIcon data-icon="inline-start" aria-hidden />
                    <span className="truncate">
                      {formatDateRangeLabel(selectedPublicDateRange)}
                    </span>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-auto p-0">
                    <Calendar
                      mode="range"
                      numberOfMonths={2}
                      onSelect={setDraftPublicDateRange}
                      selected={draftPublicDateRange}
                    />
                    <div className="flex items-center justify-end gap-2 border-t p-2">
                      <Button
                        onClick={() => setDraftPublicDateRange(undefined)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Clear dates
                      </Button>
                      <Button
                        onClick={() => {
                          setPublicEntryDateFrom(
                            formatDateFilterValue(draftPublicDateRange?.from),
                          );
                          setPublicEntryDateTo(
                            formatDateFilterValue(
                              draftPublicDateRange?.to ??
                                draftPublicDateRange?.from,
                            ),
                          );
                          setIsPublicDateRangeOpen(false);
                        }}
                        size="sm"
                        type="button"
                      >
                        Apply
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
              <Button
                className="h-9 text-sm"
                disabled={!hasFilters}
                onClick={clearPublicFilters}
                type="button"
                variant="outline"
              >
                Clear
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                className="h-8 text-xs"
                onClick={() =>
                  setSelectedPublicCategories(new Set(publicCategories))
                }
                size="sm"
                type="button"
                variant={
                  selectedCategoryKey === allPublicCategoryFilterKey
                    ? "default"
                    : "outline"
                }
              >
                All types
              </Button>
              {resolvedCategoryDefinitions.map((definition) => (
                <Button
                  className={cn(
                    "h-8 text-xs",
                    getPublicCategoryBadgeToneClass(
                      definition.id,
                      currentPublicTheme,
                    ),
                    !selectedPublicCategories.has(definition.id) &&
                      selectedCategoryKey !== allPublicCategoryFilterKey &&
                      "opacity-40",
                  )}
                  key={definition.id}
                  onClick={() => togglePublicCategoryFilter(definition.id)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {definition.label}
                </Button>
              ))}
            </div>
          </section>
        ) : null}

        {entries.length === 0 ? (
          <section className="text-balance rounded-2xl border border-dashed border-border/70 bg-card/50 p-6 text-center text-muted-foreground">
            No updates published yet.
          </section>
        ) : dateGroups.length === 0 ? (
          <section className="text-balance rounded-2xl border border-dashed border-border/70 bg-card/50 p-6 text-center text-muted-foreground">
            No updates match your filters.
          </section>
        ) : (
          <section aria-label="Changelog updates">
            {dateGroups.map((group, groupIndex) => (
              <PublicChangelogDateGroup
                categoryDefinitions={resolvedCategoryDefinitions}
                groupEntriesByCategory={groupEntriesByCategory}
                group={group}
                isLastGroup={groupIndex === dateGroups.length - 1}
                key={group.date}
                publicTheme={currentPublicTheme}
              />
            ))}
          </section>
        )}

        {hasLoadMoreControl ? (
          <div
            className="mt-1 flex flex-col items-center gap-3 border-t border-border pt-5"
            data-public-load-more-sentinel
            ref={loadMoreRef}
          >
            <Button
              className="rounded-full text-sm"
              disabled={isLoadingMoreEntries}
              onClick={onLoadMoreEntries}
              type="button"
              variant="outline"
            >
              {isLoadingMoreEntries ? (
                <span className="inline-flex items-center gap-2" role="status">
                  <LoaderCircleIcon
                    aria-hidden
                    className="size-4 animate-spin"
                    data-public-load-more-spinner
                  />
                  Loading older updates
                </span>
              ) : (
                "Load older updates"
              )}
            </Button>
            {loadMoreError ? (
              <p
                className="text-center text-sm text-muted-foreground"
                role="status"
              >
                {loadMoreError}
              </p>
            ) : null}
          </div>
        ) : null}

        {showBranding ? (
          <footer className="mt-8 flex justify-center border-t border-border pt-6">
            <a
              className="home-logo-link inline-flex items-center gap-2 text-sm text-muted-foreground no-underline"
              href="https://cooee.sh"
              rel="noreferrer"
              target="_blank"
            >
              <span>Powered by</span>
              <AnimatedCooeeLogo className="brand-logo h-[15px] w-auto" />
            </a>
          </footer>
        ) : null}
      </PublicChangelogContentRoot>
    </div>
  );
}

function handlePublicDateCategoryLinkClick(
  event: ReactMouseEvent<HTMLAnchorElement>,
) {
  const anchor = event.currentTarget;
  const href = anchor.getAttribute("href");

  if (!href?.startsWith("#")) {
    return;
  }

  const target = document.getElementById(decodeURIComponent(href.slice(1)));
  if (!target) {
    return;
  }

  const details = anchor.closest("details");
  if (details instanceof HTMLDetailsElement) {
    details.open = true;
  }

  event.preventDefault();
  event.stopPropagation();
  target.scrollIntoView({
    behavior: getPublicSmoothScrollBehavior(),
    block: "start",
  });
  window.history.pushState(null, "", href);
}

function getPublicSmoothScrollBehavior(): ScrollBehavior {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
}

function PublicChangelogDateGroup({
  categoryDefinitions,
  groupEntriesByCategory,
  group,
  isLastGroup,
  publicTheme,
}: {
  categoryDefinitions: ChangelogCategoryDefinition[];
  groupEntriesByCategory: boolean;
  group: PublicDateGroup;
  isLastGroup: boolean;
  publicTheme: ThemeMode;
}) {
  const entrySegments = groupPublicEntrySegments(
    group.entries,
    categoryDefinitions,
    groupEntriesByCategory,
  );
  const categorySummaries = getPublicDateCategorySummaries(
    group,
    categoryDefinitions,
  );
  const categorySummariesByCategory = new Map(
    categorySummaries.map((summary) => [summary.category, summary]),
  );
  const anchoredCategories = new Set<string>();
  const consumeAnchorId = (category: string): string | undefined =>
    consumePublicCategoryAnchorId(
      category,
      categorySummariesByCategory,
      anchoredCategories,
    );
  let lastCategorySegmentIndex = -1;
  entrySegments.forEach((segment, index) => {
    if (segment.kind === "category") {
      lastCategorySegmentIndex = index;
    }
  });
  const header = (
    <div className="relative mb-3 flex min-h-7 items-center gap-2.5">
      <span
        className={cn(
          "absolute -left-[34px] top-1 size-[17px] rounded-full border-2",
          "border-muted-foreground bg-background",
        )}
        aria-hidden="true"
      />
      <h2 className="m-0 text-balance text-lg font-semibold leading-tight tracking-normal text-foreground">
        {group.date}
      </h2>
      <nav
        aria-label={`${group.date} categories`}
        className="flex flex-wrap items-center gap-y-1 text-sm text-muted-foreground"
      >
        {categorySummaries.map((summary, index) => (
          <Fragment key={summary.category}>
            {index > 0 ? (
              <span aria-hidden="true" className="mr-1.5">
                ,
              </span>
            ) : null}
            <a
              className="text-balance rounded-sm underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              href={`#${summary.anchorId}`}
              onClick={handlePublicDateCategoryLinkClick}
            >
              {summary.label}
            </a>
          </Fragment>
        ))}
      </nav>
    </div>
  );
  const entries = (
    <div className="timeline-entries">
      {entrySegments.map((segment, segmentIndex) =>
        segment.kind === "entry" ? (
          <PublicChangelogEntry
            anchorId={consumeAnchorId(segment.entry.category)}
            categoryDefinitions={categoryDefinitions}
            entry={segment.entry}
            publicTheme={publicTheme}
            key={
              segment.entry.id ??
              `${group.date}-${segment.entry.title}-${segmentIndex}`
            }
          />
        ) : (
          <section
            className={cn(
              "relative mt-6 scroll-mt-24 before:absolute before:-left-[26px] before:top-3 before:h-px before:w-[18px] first:mt-0",
              "before:bg-border",
              isLastGroup &&
                segmentIndex === lastCategorySegmentIndex &&
                "after:absolute after:-bottom-8 after:-left-[26px] after:top-[13px] after:w-px after:bg-background",
            )}
            data-final-timeline-branch={
              isLastGroup && segmentIndex === lastCategorySegmentIndex
                ? ""
                : undefined
            }
            data-category-section={segment.category}
            data-timeline-branch=""
            id={consumeAnchorId(segment.category)}
            key={`${segment.category}-${segmentIndex}`}
          >
            <h3
              className={cn(
                "mb-3 inline-flex w-fit items-center justify-center rounded-full border px-2.5 py-1 text-balance text-xs font-semibold leading-none tracking-normal",
                getPublicCategoryBadgeToneClass(segment.category, publicTheme),
              )}
            >
              {segment.label}
            </h3>
            {segment.entries.map((entry, index) => (
              <PublicChangelogEntry
                categoryDefinitions={categoryDefinitions}
                entry={entry}
                publicTheme={publicTheme}
                key={entry.id ?? `${group.date}-${entry.title}-${index}`}
              />
            ))}
          </section>
        ),
      )}
    </div>
  );

  return (
    <section
      className={cn(
        "relative m-0 pb-8 pl-[34px] before:absolute before:bottom-0 before:left-2 before:top-3 before:w-px",
        "before:bg-border",
      )}
    >
      {header}
      {entries}
    </section>
  );
}

function PublicChangelogEntry({
  anchorId,
  categoryDefinitions,
  entry,
  publicTheme,
}: {
  anchorId?: string;
  categoryDefinitions: ChangelogCategoryDefinition[];
  entry: PublishedEntry;
  publicTheme: ThemeMode;
}) {
  const displayType = getChangelogCategoryDisplayType(
    entry.category,
    categoryDefinitions,
  );
  const categories = getPublicEntryCategoryIds(entry).join(" ");
  const summaryMarkup = renderMarkdown(entry.summary);
  const [isCalloutExpanded, setIsCalloutExpanded] = useState(false);
  const [isCalloutExpandable, setIsCalloutExpandable] = useState(false);
  const calloutSummaryRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (displayType !== "callout") {
      setIsCalloutExpandable(false);
      return;
    }

    const summary = calloutSummaryRef.current;
    if (!summary) {
      return;
    }

    function updateExpandableState() {
      if (!summary) {
        return;
      }

      const canExpand =
        summary.scrollHeight > getPublicCalloutCollapsedHeight() + 1;
      setIsCalloutExpandable(canExpand);
      if (!canExpand) {
        setIsCalloutExpanded(false);
      }
    }

    updateExpandableState();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(updateExpandableState);
    observer.observe(summary);
    return () => observer.disconnect();
  }, [displayType, summaryMarkup]);

  if (displayType === "text") {
    return (
      <article
        className={cn(
          "py-1.5 pl-4 text-foreground/80 [&+&]:mt-1.5",
          anchorId && "scroll-mt-24",
        )}
        data-categories={categories}
        data-display-type="text"
        data-public-entry=""
        data-search={publicEntrySearchText(entry)}
        id={anchorId}
      >
        <details className="group">
          <summary className="inline-flex cursor-pointer list-none items-center gap-2 marker:hidden [&::-webkit-details-marker]:hidden">
            <span className="text-balance text-sm font-normal leading-relaxed text-foreground">
              {entry.title}
            </span>
            <ChevronDownIcon
              aria-hidden="true"
              className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
              data-icon="text-entry-chevron"
            />
          </summary>
          <div
            className="markdown-summary mt-2 text-balance text-sm leading-relaxed text-foreground/80 [&_a]:font-semibold [&_a]:text-primary [&_ol]:mt-3 [&_p]:m-0 [&_p]:text-balance [&_p+p]:mt-3 [&_ul]:mt-3"
            dangerouslySetInnerHTML={{ __html: summaryMarkup }}
          />
          <PublicChangelogEntryItems
            categoryDefinitions={categoryDefinitions}
            items={entry.items}
            publicTheme={publicTheme}
            variant="plain"
          />
        </details>
      </article>
    );
  }

  if (displayType === "callout") {
    return (
      <article
        className={cn(
          "rounded-2xl border border-border/70 bg-muted/50 p-5 shadow-none [&+&]:mt-3",
          anchorId && "scroll-mt-24",
        )}
        data-categories={categories}
        data-display-type="callout"
        data-public-entry=""
        data-search={publicEntrySearchText(entry)}
        id={anchorId}
      >
        <div className="mb-2">
          <h3 className="m-0 text-balance text-base font-semibold leading-snug tracking-normal text-foreground">
            {entry.title}
          </h3>
        </div>
        <div
          className={cn(
            "markdown-summary max-w-[68ch] text-balance text-sm leading-relaxed text-foreground/80 [&_a]:font-semibold [&_a]:text-primary [&_ol]:mt-3 [&_p]:m-0 [&_p]:text-balance [&_p+p]:mt-3 [&_ul]:mt-3",
            !isCalloutExpanded && "max-h-[7.5rem] overflow-hidden",
          )}
          dangerouslySetInnerHTML={{ __html: summaryMarkup }}
          ref={calloutSummaryRef}
        />
        <Button
          aria-expanded={isCalloutExpanded}
          aria-label={
            isCalloutExpanded ? "Collapse callout text" : "Expand callout text"
          }
          className="-ml-1 mt-3 text-muted-foreground"
          hidden={!isCalloutExpandable}
          onClick={() => setIsCalloutExpanded((current) => !current)}
          size="icon-xs"
          type="button"
          variant="ghost"
        >
          <ChevronDownIcon
            aria-hidden="true"
            className={cn(
              "size-4 transition-transform",
              isCalloutExpanded && "rotate-180",
            )}
            data-icon="callout-entry-chevron"
          />
        </Button>
        <PublicChangelogEntryItems
          categoryDefinitions={categoryDefinitions}
          items={entry.items}
          publicTheme={publicTheme}
        />
      </article>
    );
  }

  return (
    <article
      className={cn(
        "rounded-3xl border border-border/70 bg-white/90 p-9 text-card-foreground shadow-xs dark:bg-card [&+&]:mt-3",
        anchorId && "scroll-mt-24",
      )}
      data-categories={categories}
      data-display-type="post"
      data-public-entry=""
      data-search={publicEntrySearchText(entry)}
      id={anchorId}
    >
      {entry.imageUrl ? (
        <img
          alt=""
          className="mb-5 aspect-[3/2] w-full rounded-2xl border border-border/70 object-cover"
          loading="lazy"
          src={entry.imageUrl}
        />
      ) : null}
      <div className="mb-4">
        <h3 className="m-0 text-balance text-xl font-semibold leading-tight tracking-normal text-foreground sm:text-2xl">
          {entry.title}
        </h3>
      </div>
      <div
        className="markdown-summary max-w-[68ch] text-balance text-base leading-relaxed text-foreground/80 [&_a]:font-semibold [&_a]:text-primary [&_ol]:mt-4 [&_p]:m-0 [&_p]:text-balance [&_p+p]:mt-4 [&_ul]:mt-4"
        dangerouslySetInnerHTML={{ __html: summaryMarkup }}
      />
      <PublicChangelogEntryItems
        categoryDefinitions={categoryDefinitions}
        items={entry.items}
        publicTheme={publicTheme}
      />
    </article>
  );
}

function getPublicCalloutCollapsedHeight(): number {
  if (typeof window === "undefined") {
    return 120;
  }

  const rootFontSize = Number.parseFloat(
    window.getComputedStyle(document.documentElement).fontSize,
  );
  return Number.isFinite(rootFontSize) ? rootFontSize * 7.5 : 120;
}

function PublicChangelogEntryItems({
  categoryDefinitions,
  items,
  publicTheme,
  variant = "card",
}: {
  categoryDefinitions: ChangelogCategoryDefinition[];
  items: PublishedEntry["items"];
  publicTheme: ThemeMode;
  variant?: "card" | "plain";
}) {
  if (!items || items.length === 0) {
    return null;
  }

  const sortedItems = [...items].sort((left, right) =>
    compareChangelogCategories(
      toApiCategory(left.category),
      toApiCategory(right.category),
      categoryDefinitions,
    ),
  );

  if (variant === "plain") {
    return (
      <div className="mt-3 grid gap-2.5">
        {sortedItems.map((item, index) => (
          <section key={`${item.title}-${index}`}>
            <h4 className="m-0 text-balance text-sm font-normal leading-snug tracking-normal text-foreground">
              {item.title}
            </h4>
            <div
              className="markdown-summary mt-1 text-balance text-sm leading-relaxed text-muted-foreground [&_a]:font-semibold [&_a]:text-primary [&_ol]:mt-3 [&_p]:m-0 [&_p]:text-balance [&_p+p]:mt-3 [&_ul]:mt-3"
              dangerouslySetInnerHTML={{
                __html: renderMarkdown(item.summary),
              }}
            />
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="mt-4 grid gap-3">
      {sortedItems.map((item, index) => (
        <section
          className="rounded-2xl border border-border/70 bg-background/70 p-4"
          key={`${item.title}-${index}`}
        >
          <div className="flex items-start justify-between gap-3">
            <h4 className="m-0 text-balance text-[15px] font-semibold leading-snug tracking-normal text-foreground">
              {item.title}
            </h4>
            <PublicChangelogCategoryBadge
              category={item.category}
              categoryDefinitions={categoryDefinitions}
              publicTheme={publicTheme}
            />
          </div>
          <div
            className="markdown-summary mt-2 text-balance text-sm leading-relaxed text-muted-foreground [&_a]:font-semibold [&_a]:text-primary [&_ol]:mt-3 [&_p]:m-0 [&_p]:text-balance [&_p+p]:mt-3 [&_ul]:mt-3"
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(item.summary),
            }}
          />
        </section>
      ))}
    </div>
  );
}

function PublicChangelogCategoryBadge({
  category,
  categoryDefinitions,
  publicTheme,
}: {
  category: PublishedEntry["category"];
  categoryDefinitions: ChangelogCategoryDefinition[];
  publicTheme: ThemeMode;
}) {
  return (
    <Badge
      className={cn(
        "border px-2.5 py-1 text-xs font-semibold",
        getPublicCategoryBadgeToneClass(category, publicTheme),
      )}
      variant="outline"
    >
      {getChangelogCategoryLabel(category, categoryDefinitions)}
    </Badge>
  );
}

function getPublicCategoryBadgeToneClass(
  category: PublishedEntry["category"],
  publicTheme: ThemeMode = "light",
): string {
  if (publicTheme === "dark") {
    switch (normalizeChangelogCategoryId(category)) {
      case "feature":
        return "border-emerald-500/40 bg-emerald-950 text-emerald-200";
      case "improvement":
        return "border-blue-500/40 bg-blue-950 text-blue-200";
      case "fix":
        return "border-amber-500/40 bg-amber-950 text-amber-200";
      case "maintenance":
        return "border-stone-700 bg-stone-800 text-stone-200";
      default:
        return "border-stone-700 bg-stone-900 text-stone-200";
    }
  }

  switch (normalizeChangelogCategoryId(category)) {
    case "feature":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "improvement":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "fix":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "maintenance":
      return "border-stone-300 bg-stone-100 text-stone-700";
    default:
      return "border-stone-300 bg-white text-stone-700";
  }
}

function AdminLoginPage({
  error,
  isLoading,
  onSignIn,
  publicSiteUrl,
}: {
  error: string | null;
  isLoading: boolean;
  onSignIn: () => void;
  publicSiteUrl: string;
}) {
  const [supportNavigationPill, setSupportNavigationPill] = useState<{
    isVisible: boolean;
    isReadyToMove: boolean;
    left: number;
    width: number;
  } | null>(null);
  const supportNavigationRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Sign in | Cooee";

    return () => {
      document.title = previousTitle;
    };
  }, []);

  const handleLinkHover = (link: HTMLAnchorElement) => {
    play("tick");
    const navigation = supportNavigationRef.current;
    if (!navigation) {
      return;
    }

    const navigationBounds = navigation.getBoundingClientRect();
    const linkBounds = link.getBoundingClientRect();
    const position = {
      left: linkBounds.left - navigationBounds.left,
      width: linkBounds.width,
    };

    if (!supportNavigationPill) {
      setSupportNavigationPill({
        ...position,
        isVisible: true,
        isReadyToMove: false,
      });
      window.requestAnimationFrame(() => {
        setSupportNavigationPill((current) =>
          current ? { ...current, isReadyToMove: true } : current,
        );
      });
      return;
    }

    setSupportNavigationPill((current) =>
      current ? { ...current, ...position, isVisible: true } : current,
    );
  };

  return (
    <main
      className="home-page h-[100svh] overflow-hidden bg-background text-foreground lg:h-auto lg:min-h-screen lg:overflow-visible"
      id="main-content"
    >
      <div className="relative flex h-full min-h-0 flex-col lg:grid lg:min-h-screen lg:grid-cols-[minmax(0,0.88fr)_minmax(32rem,1.12fr)]">
        <section className="flex shrink-0 flex-col px-6 pb-4 pt-5 sm:px-10 sm:pb-5 sm:pt-7 lg:min-h-screen lg:px-12 lg:py-9 xl:px-16">
          <div className="flex flex-col items-start gap-2">
            <a
              aria-label="Cooee public site"
              className="home-logo-link inline-flex"
              href={publicSiteUrl}
            >
              <AnimatedCooeeLogo className="h-6 w-auto" playOnMount />
            </a>
            <p className="text-xs text-muted-foreground">
              Changelogs on autopilot
            </p>
          </div>

          <div className="mx-auto flex w-full max-w-[25rem] pb-2 pt-7 sm:pb-3 sm:pt-9 lg:flex-1 lg:items-center lg:py-20">
            <div className="w-full">
              <h1 className="text-balance text-4xl font-semibold tracking-[-0.045em] sm:text-[2.75rem] sm:leading-[1.06]">
                Sign in
              </h1>
              <p className="mt-4 max-w-sm text-balance text-sm leading-6 text-muted-foreground">
                Connect a GitHub repository to get started, or manage your
                existing changelog.
              </p>

              {error ? (
                <p
                  className="mt-6 rounded-xl border border-destructive/25 bg-destructive/8 px-4 py-3 text-sm text-destructive"
                  role="alert"
                >
                  {error}
                </p>
              ) : null}

              <Button
                className="mt-8 h-12 w-full justify-center rounded-full text-sm"
                disabled={isLoading}
                onClick={onSignIn}
                type="button"
              >
                {isLoading ? (
                  <LoaderCircleIcon
                    aria-hidden
                    className="animate-spin"
                    data-icon="inline-start"
                  />
                ) : (
                  <GithubIcon aria-hidden data-icon="inline-start" />
                )}
                {isLoading ? "Connecting…" : "Continue with GitHub"}
              </Button>
            </div>
          </div>
        </section>

        <aside
          aria-label="Cooee illustration"
          className="relative mx-4 min-h-0 flex-1 overflow-hidden rounded-[2rem] bg-muted sm:mx-6 lg:m-4 lg:ml-0 lg:min-h-[calc(100vh-2rem)] lg:rounded-[2.5rem]"
        >
          <img
            alt=""
            className="absolute inset-0 size-full object-cover object-center"
            decoding="async"
            fetchPriority="high"
            src="/cooee-login-galah.webp"
          />
          <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-stone-950/90 via-stone-950/45 to-transparent px-6 pb-5 pt-20 text-stone-50 sm:px-8 sm:pb-7 sm:pt-24 lg:px-10 lg:pb-10 lg:pt-32 xl:px-14 xl:pb-14">
            <p className="home-display max-w-lg text-balance text-3xl leading-[1] tracking-[-0.03em] sm:text-4xl lg:text-5xl lg:leading-[0.98] xl:text-6xl">
              Don&apos;t let your changelog go walkabout.
            </p>
            <p className="mt-4 max-w-md text-balance text-sm leading-6 text-stone-100/80">
              AI helps developers ship more, faster. Cooee keeps your changelog
              moving at the same pace.
            </p>
          </div>
        </aside>

        <nav
          aria-label="Sign-in support"
          className="relative mx-6 flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 py-3 text-xs text-muted-foreground sm:mx-10 sm:py-4 lg:absolute lg:bottom-9 lg:left-12 lg:m-0 lg:py-0 xl:left-16"
          onMouseLeave={() =>
            setSupportNavigationPill((current) =>
              current ? { ...current, isVisible: false } : current,
            )
          }
          ref={supportNavigationRef}
        >
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute left-0 top-1/2 z-0 h-7 rounded-full bg-muted duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
              supportNavigationPill?.isReadyToMove
                ? "transition-[transform,width,opacity]"
                : "transition-none",
            )}
            style={{
              opacity: supportNavigationPill?.isVisible ? 1 : 0,
              transform: `translate(${supportNavigationPill?.left ?? 0}px, -50%)`,
              width: `${supportNavigationPill?.width ?? 0}px`,
            }}
          />
          <a
            className="relative z-10 -mx-2 inline-flex rounded-full px-2 py-1 transition-colors hover:text-foreground motion-reduce:transition-none"
            href={publicSiteUrl}
            onFocus={(event) => handleLinkHover(event.currentTarget)}
            onMouseEnter={(event) => handleLinkHover(event.currentTarget)}
          >
            Back to Cooee
          </a>
          <a
            className="relative z-10 -mx-2 inline-flex rounded-full px-2 py-1 transition-colors hover:text-foreground motion-reduce:transition-none"
            href={`${publicSiteUrl}/docs`}
            onFocus={(event) => handleLinkHover(event.currentTarget)}
            onMouseEnter={(event) => handleLinkHover(event.currentTarget)}
          >
            Docs
          </a>
          <a
            className="relative z-10 -mx-2 inline-flex rounded-full px-2 py-1 transition-colors hover:text-foreground motion-reduce:transition-none"
            href={`${publicSiteUrl}/privacy`}
            onFocus={(event) => handleLinkHover(event.currentTarget)}
            onMouseEnter={(event) => handleLinkHover(event.currentTarget)}
          >
            Privacy
          </a>
        </nav>
      </div>
    </main>
  );
}

function AdminSessionLoadingPage() {
  return (
    <main
      aria-busy="true"
      aria-live="polite"
      className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground"
      role="status"
    >
      <span className="text-sm text-muted-foreground">Loading Cooee…</span>
    </main>
  );
}

function NotFoundPage() {
  return (
    <main
      className="home-page relative isolate min-h-screen overflow-hidden bg-background px-5 py-6 text-foreground sm:px-8 sm:py-10 lg:px-12"
      id="main-content"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 z-0 w-full lg:w-[68%]"
      >
        <img
          alt=""
          className="size-full object-cover object-center"
          decoding="async"
          fetchPriority="high"
          height="1086"
          src="/cooee-404-galah.webp"
          width="1448"
        />
        <div className="absolute inset-y-0 left-0 w-[60%] bg-linear-to-r from-background via-background/35 to-transparent" />
      </div>

      <div className="home-page-container relative z-10 mx-auto flex min-h-[calc(100svh-3rem)] flex-col sm:min-h-[calc(100svh-5rem)]">
        <a aria-label="Cooee home" className="inline-flex self-start" href="/">
          <AnimatedCooeeLogo className="h-5 w-auto" />
        </a>

        <div className="flex flex-1 items-center py-12 lg:py-16">
          <div className="flex max-w-xl flex-col items-start gap-6">
            <p className="text-balance text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              404
            </p>
            <h1 className="home-display max-w-xl text-balance text-[clamp(4rem,10vw,7.5rem)] leading-[0.94] tracking-normal">
              Silly Galah!
            </h1>
            <p className="max-w-md text-balance text-lg leading-8 text-muted-foreground">
              There&apos;s nothing here mate, the page must&apos;ve gone
              walkabout!
            </p>
            <a
              className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/85"
              href="/"
            >
              Back to home
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}

function MarkdownEditorLoadingState() {
  return (
    <div
      aria-busy="true"
      className="flex min-h-32 items-center justify-center rounded-lg border bg-muted/30 text-sm text-muted-foreground"
      role="status"
    >
      Loading editor…
    </div>
  );
}

function DashboardView({
  categoryDefinitions,
  onDeletePublishedEntry,
  onDeleteSelectedPublishedEntries,
  onEditPublishedEntry,
  onOpenHeldEntryReview,
  onPublishedEntryDateRangeChange,
  onPublishedEntryPageChange,
  onPublishedEntryPageSizeChange,
  onPublishedEntrySearchChange,
  onClearPublishedEntryFilters,
  onMergeSelectedPublishedEntries,
  onMarkPublishedEntryNotRelevant,
  onRegenerateHeldEntry,
  onRegeneratePublishedEntry,
  onToggleAllPublishedEntriesSelected,
  onTogglePublishedEntrySelected,
  publishedEntryDateFrom,
  publishedEntryDateTo,
  publishedEntryPage,
  publishedEntryPageSize,
  publishedEntrySearch,
  publishedEntriesLoading,
  publishedEntries,
  publishedEntriesTotal,
  publishedEntriesTotalPages,
  publicTheme,
  regeneratingHeldEntryIds,
  regeneratingPublishedEntryIds,
  selectedPublishedEntryKeys,
}: {
  categoryDefinitions: ChangelogCategoryDefinition[];
  onDeletePublishedEntry: (entry: PublishedEntry) => void;
  onDeleteSelectedPublishedEntries: () => void;
  onEditPublishedEntry: (entry: PublishedEntry) => void;
  onOpenHeldEntryReview: (entry: HeldEntry) => void;
  onPublishedEntryDateRangeChange: (range: {
    from: string;
    to: string;
  }) => void;
  onPublishedEntryPageChange: Dispatch<SetStateAction<number>>;
  onPublishedEntryPageSizeChange: (pageSize: number) => void;
  onPublishedEntrySearchChange: (query: string) => void;
  onClearPublishedEntryFilters: () => void;
  onMergeSelectedPublishedEntries: () => void;
  onMarkPublishedEntryNotRelevant: (entry: PublishedEntry) => void;
  onRegenerateHeldEntry: (entry: HeldEntry) => void;
  onRegeneratePublishedEntry: (entry: PublishedEntry) => void;
  onToggleAllPublishedEntriesSelected: () => void;
  onTogglePublishedEntrySelected: (entry: PublishedEntry) => void;
  publishedEntryDateFrom: string;
  publishedEntryDateTo: string;
  publishedEntryPage: number;
  publishedEntryPageSize: number;
  publishedEntrySearch: string;
  publishedEntriesLoading: boolean;
  publishedEntries: PublishedEntry[];
  publishedEntriesTotal: number;
  publishedEntriesTotalPages: number;
  publicTheme: ThemeMode;
  regeneratingHeldEntryIds: Set<string>;
  regeneratingPublishedEntryIds: Set<string>;
  selectedPublishedEntryKeys: Set<string>;
}) {
  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-balance text-xl font-semibold tracking-normal">
        Changelog editor
      </h2>
      <PublishedEntriesList
        categoryDefinitions={categoryDefinitions}
        entries={publishedEntries}
        dateFrom={publishedEntryDateFrom}
        dateTo={publishedEntryDateTo}
        isLoading={publishedEntriesLoading}
        onBulkDeleteEntries={onDeleteSelectedPublishedEntries}
        onClearFilters={onClearPublishedEntryFilters}
        onDeleteEntry={onDeletePublishedEntry}
        onEditEntry={onEditPublishedEntry}
        onOpenHeldEntryReview={onOpenHeldEntryReview}
        onDateRangeChange={onPublishedEntryDateRangeChange}
        onMergeEntries={onMergeSelectedPublishedEntries}
        onPageChange={onPublishedEntryPageChange}
        onPageSizeChange={onPublishedEntryPageSizeChange}
        onMarkEntryNotRelevant={onMarkPublishedEntryNotRelevant}
        onRegenerateHeldEntry={onRegenerateHeldEntry}
        onRegenerateEntry={onRegeneratePublishedEntry}
        onSearchChange={onPublishedEntrySearchChange}
        onToggleAllEntriesSelected={onToggleAllPublishedEntriesSelected}
        onToggleEntrySelected={onTogglePublishedEntrySelected}
        page={publishedEntryPage}
        pageSize={publishedEntryPageSize}
        regeneratingHeldEntryIds={regeneratingHeldEntryIds}
        regeneratingEntryIds={regeneratingPublishedEntryIds}
        search={publishedEntrySearch}
        selectedEntryKeys={selectedPublishedEntryKeys}
        total={publishedEntriesTotal}
        totalPages={publishedEntriesTotalPages}
        publicTheme={publicTheme}
      />
    </section>
  );
}

function OnboardingWizardModal({
  currentStep,
  onClose,
  onConnectRepository,
  setCurrentStep,
  setSettings,
  settings,
}: {
  currentStep: number;
  onClose: () => void;
  onConnectRepository: () => void;
  setCurrentStep: Dispatch<SetStateAction<number>>;
  setSettings: Dispatch<SetStateAction<SettingsState>>;
  settings: SettingsState;
}) {
  const steps: Array<{ icon: LucideIcon; label: string }> = [
    { icon: GithubIcon, label: "Connect repository" },
    { icon: CalendarClockIcon, label: "Schedule cadence" },
    { icon: SparklesIcon, label: "AI personality" },
    { icon: ImageIcon, label: "Update images" },
  ];
  const isLastStep = currentStep === steps.length - 1;
  const CurrentStepIcon = steps[currentStep]?.icon ?? GithubIcon;
  const progressLabel = `${currentStep + 1} of ${steps.length}`;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const rootSiblings = dialog.parentElement
      ? [...dialog.parentElement.children].filter(
          (element) => element !== dialog,
        )
      : [];
    const previousSiblingState = rootSiblings.map((element) => ({
      ariaHidden: element.getAttribute("aria-hidden"),
      element,
      inert: (element as HTMLElement).inert,
    }));

    for (const sibling of rootSiblings) {
      sibling.setAttribute("aria-hidden", "true");
      (sibling as HTMLElement).inert = true;
    }

    const getFocusableElements = () =>
      [
        ...dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => !element.hasAttribute("hidden"));

    (getFocusableElements()[0] ?? dialog).focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = getFocusableElements();
      const first = focusableElements[0];
      const last = focusableElements.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialog?.focus();
        return;
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      for (const { ariaHidden, element, inert } of previousSiblingState) {
        if (ariaHidden === null) {
          element.removeAttribute("aria-hidden");
        } else {
          element.setAttribute("aria-hidden", ariaHidden);
        }
        (element as HTMLElement).inert = inert;
      }
      previouslyFocused?.focus();
    };
  }, []);

  function goNext() {
    if (isLastStep) {
      onClose();
      return;
    }

    setCurrentStep((step) => clampOnboardingStep(step + 1));
  }

  function goBack() {
    setCurrentStep((step) => clampOnboardingStep(step - 1));
  }

  return (
    <div
      aria-describedby="onboarding-description"
      aria-labelledby="onboarding-title"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto scrollbar-thin bg-black/10 p-4"
      ref={dialogRef}
      role="dialog"
      tabIndex={-1}
    >
      <Card className="max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto scrollbar-thin">
        <CardHeader className="gap-5 p-7 pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
                <CurrentStepIcon aria-hidden className="size-5" />
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle
                    className="text-balance text-xl"
                    id="onboarding-title"
                  >
                    Start setup
                  </CardTitle>
                  <Badge variant="outline">{progressLabel}</Badge>
                </div>
                <CardDescription>
                  <span id="onboarding-description">
                    Four quick choices, then Cooee can start writing updates.
                  </span>
                </CardDescription>
              </div>
            </div>
            <Button
              aria-label="Close onboarding"
              className="size-8"
              onClick={onClose}
              size="sm"
              variant="outline"
            >
              <XIcon aria-hidden />
            </Button>
          </div>

          <ol
            className="grid gap-2 text-xs sm:grid-cols-4"
            aria-label="Setup progress"
          >
            {steps.map((step, index) => {
              const StepIcon = step.icon;

              return (
                <li
                  className={[
                    "flex min-w-0 items-center gap-2 rounded-full border px-3 py-2 transition-colors",
                    currentStep === index
                      ? "bg-foreground text-background"
                      : "bg-background text-muted-foreground",
                  ].join(" ")}
                  key={step.label}
                >
                  <StepIcon aria-hidden className="size-4 shrink-0" />
                  <span className="truncate">{step.label}</span>
                </li>
              );
            })}
          </ol>
        </CardHeader>
        <CardContent className="p-7 pt-0">
          <div className="flex min-h-[19rem] flex-col justify-between gap-8">
            {currentStep === 0 ? (
              <div className="flex flex-col gap-5">
                <div>
                  <h2 className="text-balance text-lg font-semibold">
                    What should Cooee listen to?
                  </h2>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                    Connect a repository. Cooee watches merged PR metadata by
                    default, without sending code or diffs to AI.
                  </p>
                </div>
                <Button
                  className="self-start"
                  onClick={onConnectRepository}
                  size="sm"
                >
                  <GithubIcon data-icon="inline-start" aria-hidden />
                  Connect repo
                </Button>
              </div>
            ) : null}

            {currentStep === 1 ? (
              <div className="flex flex-col gap-5">
                <div>
                  <h2 className="text-balance text-lg font-semibold">
                    Pick the rhythm
                  </h2>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                    Bundle updates at the pace your customers expect.
                  </p>
                </div>
                <RadioGroup
                  className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
                  name="schedule-frequency"
                  onValueChange={(scheduleFrequency) =>
                    setSettings((current) => ({
                      ...current,
                      scheduleFrequency:
                        scheduleFrequency as SettingsState["scheduleFrequency"],
                    }))
                  }
                  value={settings.scheduleFrequency}
                >
                  <OnboardingChoice
                    checked={settings.scheduleFrequency === "daily"}
                    description="Best for active products."
                    label="Every day"
                    value="daily"
                  />
                  <OnboardingChoice
                    checked={settings.scheduleFrequency === "weekly"}
                    description="Batch updates weekly."
                    label="Every week"
                    value="weekly"
                  />
                  <OnboardingChoice
                    checked={settings.scheduleFrequency === "monthly"}
                    description="Quiet release cadence."
                    label="Every month"
                    value="monthly"
                  />
                  <OnboardingChoice
                    checked={settings.scheduleFrequency === "on-merge"}
                    description="Publish after each merge."
                    label="Every PR merge"
                    value="on-merge"
                  />
                </RadioGroup>
                {settings.scheduleFrequency !== "on-merge" ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {settings.scheduleFrequency === "weekly" ? (
                      <SelectField
                        label="Run day"
                        onValueChange={(scheduleWeekday) =>
                          setSettings((current) => ({
                            ...current,
                            scheduleWeekday: Number(scheduleWeekday),
                          }))
                        }
                        options={scheduleWeekdayOptions}
                        value={String(settings.scheduleWeekday)}
                      />
                    ) : null}
                    {settings.scheduleFrequency === "monthly" ? (
                      <SelectField
                        label="Run day"
                        onValueChange={(scheduleMonthDay) =>
                          setSettings((current) => ({
                            ...current,
                            scheduleMonthDay: Number(scheduleMonthDay),
                          }))
                        }
                        options={scheduleMonthDayOptions}
                        value={String(settings.scheduleMonthDay)}
                      />
                    ) : null}
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-medium">Run time</span>
                      <TimePickerInput
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            publishTime: event.target.value,
                          }))
                        }
                        value={settings.publishTime}
                      />
                    </label>
                  </div>
                ) : null}
                <div className="rounded-lg border bg-background p-4">
                  <div className="flex flex-col gap-1">
                    <h3 className="text-sm font-medium">Import history</h3>
                    <p className="text-sm leading-6 text-muted-foreground">
                      Generate the first changelog from recent merged pull
                      requests.
                    </p>
                  </div>
                  <label className="mt-4 flex max-w-44 flex-col gap-2">
                    <span className="text-sm font-medium">Backfill days</span>
                    <Input
                      max={365}
                      min={1}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          historicalBackfillDays: clampNumber(
                            Number(event.target.value),
                            1,
                            365,
                          ),
                        }))
                      }
                      type="number"
                      value={settings.historicalBackfillDays}
                    />
                  </label>
                </div>
              </div>
            ) : null}

            {currentStep === 2 ? (
              <div className="flex flex-col gap-5">
                <div>
                  <h2 className="text-balance text-lg font-semibold">
                    Choose the voice
                  </h2>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                    Set the first draft tone. You can still edit everything
                    before it goes live.
                  </p>
                </div>
                <RadioGroup
                  className="grid gap-3 sm:grid-cols-3"
                  name="ai-personality"
                  onValueChange={(value) => {
                    const aiPersonality =
                      value as SettingsState["aiPersonality"];

                    setSettings((current) => ({
                      ...current,
                      aiAudience:
                        aiPersonality === "technical"
                          ? "technical-users"
                          : "product-users",
                      aiPersonality,
                    }));
                  }}
                  value={settings.aiPersonality}
                >
                  <OnboardingChoice
                    checked={settings.aiPersonality === "product-user"}
                    description="Clear customer value."
                    label="Product-user"
                    value="product-user"
                  />
                  <OnboardingChoice
                    checked={settings.aiPersonality === "concise"}
                    description="Short and direct."
                    label="Concise"
                    value="concise"
                  />
                  <OnboardingChoice
                    checked={settings.aiPersonality === "technical"}
                    description="More implementation detail."
                    label="Technical"
                    value="technical"
                  />
                </RadioGroup>
              </div>
            ) : null}

            {currentStep === 3 ? (
              <div className="flex flex-col gap-5">
                <div>
                  <h2 className="text-balance text-lg font-semibold">
                    Need artwork too?
                  </h2>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
                    Stay text-only, or let Cooee create a simple image with each
                    published update.
                  </p>
                </div>
                <label className="flex items-start justify-between gap-4 rounded-lg border bg-background p-4">
                  <span>
                    <span className="block text-sm font-medium">
                      Generate one image for each published update
                    </span>
                    <span className="mt-1 block text-sm leading-6 text-muted-foreground">
                      Keep this off for a text-only changelog.
                    </span>
                  </span>
                  <Checkbox
                    checked={settings.createImagesPerUpdate}
                    className="mt-1"
                    onCheckedChange={(checked) =>
                      setSettings((current) => ({
                        ...current,
                        createImagesPerUpdate: checked,
                      }))
                    }
                  />
                </label>
              </div>
            ) : null}

            <div className="flex flex-wrap justify-between gap-3 border-t pt-5">
              <Button
                onClick={onClose}
                size="sm"
                type="button"
                variant="outline"
              >
                Skip setup
              </Button>
              <div className="flex gap-2">
                <Button
                  disabled={currentStep === 0}
                  onClick={goBack}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Back
                </Button>
                <Button onClick={goNext} size="sm" type="button">
                  {isLastStep ? "Finish" : "Next"}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function OnboardingChoice({
  checked,
  description,
  label,
  value,
}: {
  checked: boolean;
  description: string;
  label: string;
  value: string;
}) {
  return (
    <label
      className={[
        "flex h-full cursor-pointer flex-col gap-3 rounded-lg border p-4 transition-all hover:-translate-y-0.5",
        checked
          ? "bg-muted text-foreground shadow-sm"
          : "bg-background text-foreground hover:bg-muted/50",
      ].join(" ")}
    >
      <span className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <RadioGroupItem aria-label={label} value={value} />
      </span>
      <span className="text-sm leading-6 text-muted-foreground">
        {description}
      </span>
    </label>
  );
}

function HistoricalBackfillDialog({
  activeRepositoryName,
  dateRange,
  onDateRangeChange,
  onOpenChange,
  onRun,
  open,
  result,
  status,
}: {
  activeRepositoryName: string | null;
  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
  onOpenChange: (open: boolean) => void;
  onRun: () => void;
  open: boolean;
  result: string | null;
  status: HistoricalBackfillStatus;
}) {
  const [activityIndex, setActivityIndex] = useState(0);
  const [isDateRangeOpen, setIsDateRangeOpen] = useState(false);
  const [draftDateRange, setDraftDateRange] = useState<DateRange | undefined>(
    dateRange,
  );
  const isRunning = status === "running";
  const canRun =
    Boolean(activeRepositoryName) &&
    Boolean(dateRange.from && dateRange.to) &&
    !isRunning;
  const currentActivity = backfillActivitySteps[activityIndex];
  const progressValue =
    status === "success"
      ? 100
      : status === "error"
        ? 100
        : isRunning
          ? currentActivity.progress
          : 0;
  const statusTitle =
    status === "success"
      ? "Backfill complete"
      : status === "error"
        ? "Backfill needs attention"
        : isRunning
          ? currentActivity.title
          : "Ready to scan";
  const statusDetail =
    status === "success"
      ? (result ?? "Generated posts are ready to review.")
      : status === "error"
        ? (result ?? "The backfill could not finish.")
        : isRunning
          ? currentActivity.detail
          : dateRange.from && dateRange.to
            ? `Cooee will scan merged PRs from ${formatDateRangeLabel(dateRange)}.`
            : "Choose the dates to scan for merged PRs.";

  useEffect(() => {
    if (!isDateRangeOpen) {
      setDraftDateRange(dateRange);
    }
  }, [dateRange, isDateRangeOpen]);

  useEffect(() => {
    if (!open || status !== "running") {
      if (status === "idle") {
        setActivityIndex(0);
      }
      return;
    }

    setActivityIndex(0);
    const activityTimer = window.setInterval(() => {
      setActivityIndex((index) =>
        Math.min(index + 1, backfillActivitySteps.length - 1),
      );
    }, 1200);

    return () => window.clearInterval(activityTimer);
  }, [open, status]);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="px-6 pb-4 pt-6">
          <DialogTitle className="text-xl">Backfill updates</DialogTitle>
          <DialogDescription>
            Scan merged PRs and draft changelog posts.
          </DialogDescription>
        </DialogHeader>

        <form
          className="min-h-0 overflow-y-auto scrollbar-thin px-6 pb-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (canRun) {
              onRun();
            }
          }}
        >
          <div className="flex flex-col gap-5">
            <div className="grid gap-2">
              <span className="text-sm font-medium">Date range</span>
              <Popover open={isDateRangeOpen} onOpenChange={setIsDateRangeOpen}>
                <PopoverTrigger
                  render={
                    <Button
                      className={cn(
                        "h-10 justify-start px-3 text-left font-normal",
                        !dateRange.from && "text-muted-foreground",
                      )}
                      disabled={isRunning}
                      type="button"
                      variant="outline"
                    />
                  }
                >
                  <CalendarIcon data-icon="inline-start" aria-hidden />
                  {formatDateRangeLabel(dateRange)}
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-0">
                  <Calendar
                    mode="range"
                    numberOfMonths={2}
                    onSelect={setDraftDateRange}
                    selected={draftDateRange}
                  />
                  <div className="flex items-center justify-end gap-2 border-t p-2">
                    <Button
                      onClick={() => setDraftDateRange(undefined)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Clear dates
                    </Button>
                    <Button
                      disabled={!draftDateRange?.from || !draftDateRange?.to}
                      onClick={() => {
                        if (!draftDateRange?.from || !draftDateRange.to) return;
                        onDateRangeChange({
                          from: draftDateRange.from,
                          to: draftDateRange.to,
                        });
                        setIsDateRangeOpen(false);
                      }}
                      size="sm"
                      type="button"
                    >
                      Apply
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
              <p className="text-sm leading-6 text-muted-foreground">
                Select the first and last local calendar dates to scan. Both
                dates are included.
              </p>
            </div>

            {activeRepositoryName ? (
              <Badge className="w-fit" variant="outline">
                {activeRepositoryName}
              </Badge>
            ) : (
              <p className="rounded-lg border bg-background p-3 text-sm leading-6 text-muted-foreground">
                Select a connected repository before running a backfill.
              </p>
            )}

            <div
              aria-live="polite"
              className="rounded-lg border bg-background p-4"
            >
              <Progress className="gap-2" value={progressValue}>
                <ProgressLabel>{statusTitle}</ProgressLabel>
                <span className="ml-auto text-sm tabular-nums text-muted-foreground">
                  {Math.round(progressValue)}%
                </span>
              </Progress>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {statusDetail}
              </p>
            </div>
          </div>
        </form>

        <DialogFooter className="mx-0 mb-0">
          <Button
            disabled={isRunning}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            {status === "success" ? "Done" : "Cancel"}
          </Button>
          <Button disabled={!canRun} onClick={onRun} type="button">
            <CalendarClockIcon data-icon="inline-start" aria-hidden />
            {isRunning
              ? "Running backfill"
              : status === "success"
                ? "Run again"
                : "Run backfill"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PostEditorSheet({
  children,
  description,
  footer,
  onClose,
  title,
}: {
  children: ReactNode;
  description: string;
  footer: ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <Drawer
      direction="right"
      modal
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open
    >
      <DrawerContent className="bg-card shadow-2xl outline-none data-[vaul-drawer-direction=right]:w-[calc(100%-1rem)] data-[vaul-drawer-direction=right]:sm:w-[calc(100%-1.5rem)] data-[vaul-drawer-direction=right]:sm:max-w-xl">
        <DrawerHeader className="flex-row items-start justify-between gap-4 border-b px-6 py-5 text-left">
          <div className="grid gap-1.5">
            <DrawerTitle className="text-xl font-semibold tracking-normal">
              {title}
            </DrawerTitle>
            <DrawerDescription className="max-w-prose text-sm leading-6 text-muted-foreground">
              {description}
            </DrawerDescription>
          </div>
          <Button
            aria-label={`Close ${title.toLowerCase()}`}
            className="size-8 shrink-0"
            onClick={onClose}
            size="sm"
            variant="outline"
          >
            <XIcon aria-hidden />
          </Button>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-6 py-6">
          {children}
        </div>
        <DrawerFooter className="flex-col-reverse border-t bg-card px-6 py-4 sm:flex-row sm:justify-end">
          {footer}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

function SelectField({
  className,
  label,
  labelClassName,
  onValueChange,
  options,
  placeholder,
  triggerClassName,
  value,
}: {
  className?: string;
  label: string;
  labelClassName?: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  triggerClassName?: string;
  value: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <span className={cn("text-sm font-medium", labelClassName)}>{label}</span>
      <Select
        items={options}
        modal={false}
        onValueChange={(nextValue) => {
          if (typeof nextValue === "string") {
            onValueChange(nextValue);
          }
        }}
        value={value}
      >
        <SelectTrigger
          aria-label={label}
          className={cn("w-full", triggerClassName)}
        >
          <SelectValue placeholder={placeholder ?? label} />
        </SelectTrigger>
        <SelectContent align="start" alignItemWithTrigger={false}>
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}

type TimePickerInputProps = Omit<
  React.ComponentProps<typeof Input>,
  "step" | "type"
>;

function TimePickerInput({ className, ...props }: TimePickerInputProps) {
  return (
    <Input
      className={cn(
        "w-32 appearance-none bg-background font-mono [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none",
        className,
      )}
      step="1"
      type="time"
      {...props}
    />
  );
}

function ManualUpdateSheet({
  categoryDefinitions,
  manualUpdate,
  onClose,
  onPostManualUpdate,
  setManualUpdate,
}: {
  categoryDefinitions: ChangelogCategoryDefinition[];
  manualUpdate: ManualUpdateState;
  onClose: () => void;
  onPostManualUpdate: (event: FormEvent<HTMLFormElement>) => void;
  setManualUpdate: Dispatch<SetStateAction<ManualUpdateState>>;
}) {
  const formId = "manual-update-sheet-form";
  const selectedCategory = getChangelogCategoryDefinition(
    manualUpdate.category,
    categoryDefinitions,
  );

  return (
    <PostEditorSheet
      description="Write a customer-facing changelog entry without waiting for merged pull requests."
      footer={
        <>
          <Button onClick={onClose} type="button" variant="outline">
            Cancel
          </Button>
          <Button
            disabled={
              !manualUpdate.title.trim() || !manualUpdate.summary.trim()
            }
            form={formId}
            type="submit"
          >
            <SendIcon data-icon="inline-start" aria-hidden />
            Post update
          </Button>
        </>
      }
      onClose={onClose}
      title="Post update"
    >
      <form className="grid gap-5" id={formId} onSubmit={onPostManualUpdate}>
        <label className="grid gap-2">
          <span className="text-sm font-medium">Title</span>
          <Input
            onChange={(event) =>
              setManualUpdate((current) => ({
                ...current,
                title: event.target.value,
              }))
            }
            placeholder="Workspace exports"
            value={manualUpdate.title}
          />
        </label>

        <CategoryRadioGroup
          categoryDefinitions={categoryDefinitions}
          label="Category"
          name="manual-update-category"
          onValueChange={(category) =>
            setManualUpdate((current) => ({
              ...current,
              category,
            }))
          }
          value={manualUpdate.category}
        />
        <CategoryModeSummary category={selectedCategory} />

        <div className="grid gap-2">
          <span className="text-sm font-medium">Public summary</span>
          <Suspense fallback={<MarkdownEditorLoadingState />}>
            <MarkdownEditor
              ariaLabel="Public summary"
              markdown={manualUpdate.summary}
              onChange={(markdown) =>
                setManualUpdate((current) => ({
                  ...current,
                  summary: markdown,
                }))
              }
            />
          </Suspense>
        </div>
      </form>
    </PostEditorSheet>
  );
}

function CategoryModeSummary({
  category,
}: {
  category: ChangelogCategoryDefinition;
}) {
  const isMarketingPost =
    category.displayType === "post" && category.marketingCopy === true;

  return (
    <div className="flex flex-wrap gap-2">
      <Badge variant="secondary">
        {formatCategoryDisplayTypeBadge(category.displayType)}
      </Badge>
      {isMarketingPost ? <Badge>Marketing copy</Badge> : null}
    </div>
  );
}

function CategoryRadioGroup({
  categoryDefinitions,
  label,
  name,
  onValueChange,
  value,
}: {
  categoryDefinitions: ChangelogCategoryDefinition[];
  label: string;
  name: string;
  onValueChange: (value: string) => void;
  value: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">{label}</span>
      <RadioGroup
        aria-label={label}
        className="flex flex-wrap gap-2"
        name={name}
        onValueChange={onValueChange}
        value={value}
      >
        {categoryDefinitions.map((category) => {
          const isSelected = value === category.id;

          return (
            <RadioGroupItem
              aria-label={category.label}
              className={cn(
                "h-7 w-auto aspect-auto cursor-pointer border-0 bg-transparent p-0 shadow-none focus-visible:ring-offset-2 data-checked:!bg-transparent [&_[data-slot=radio-group-indicator]]:hidden",
              )}
              key={category.id}
              value={category.id}
            >
              <Badge
                className={cn(
                  "h-7 cursor-pointer border px-3 text-xs font-semibold transition-[box-shadow,transform] hover:-translate-y-px",
                  getCategoryRadioToneClass(category.id),
                  isSelected && "ring-2 ring-ring ring-offset-2",
                )}
                variant="outline"
              >
                {category.label}
              </Badge>
            </RadioGroupItem>
          );
        })}
      </RadioGroup>
    </div>
  );
}

function getCategoryRadioToneClass(category: string): string {
  switch (normalizeChangelogCategoryId(category)) {
    case "feature":
      return "!border-emerald-300 !bg-emerald-50 !text-emerald-800 dark:!border-emerald-700 dark:!bg-emerald-950 dark:!text-emerald-200";
    case "improvement":
      return "!border-blue-300 !bg-blue-50 !text-blue-800 dark:!border-blue-700 dark:!bg-blue-950 dark:!text-blue-200";
    case "fix":
      return "!border-amber-300 !bg-amber-50 !text-amber-800 dark:!border-amber-700 dark:!bg-amber-950 dark:!text-amber-200";
    case "maintenance":
      return "!border-stone-300 !bg-stone-100 !text-stone-700 dark:!border-stone-700 dark:!bg-stone-800 dark:!text-stone-200";
    default:
      return "!border-stone-300 !bg-stone-100 !text-stone-700 dark:!border-stone-700 dark:!bg-stone-800 dark:!text-stone-200";
  }
}

function EditPublishedEntrySheet({
  canGeneratePostImage,
  canRegenerateMarketingCopy,
  categoryDefinitions,
  entryDraft,
  imageUrl,
  isGeneratingPostImage,
  postImageGenerationAvailabilityStatus,
  rewriteInstructions,
  isRegeneratingMarketingCopy,
  isUploadingPostImage,
  onClose,
  onGeneratePostImage,
  onRegenerateMarketingCopy,
  onSaveEditedEntry,
  onUploadPostImage,
  setEntryDraft,
  setRewriteInstructions,
  sourcePullRequests,
}: {
  canGeneratePostImage: boolean;
  canRegenerateMarketingCopy: boolean;
  categoryDefinitions: ChangelogCategoryDefinition[];
  entryDraft: PublishedEntryDraftState;
  imageUrl: string | null;
  isGeneratingPostImage: boolean;
  postImageGenerationAvailabilityStatus: PostImageGenerationAvailability["status"];
  rewriteInstructions: string;
  isRegeneratingMarketingCopy: boolean;
  isUploadingPostImage: boolean;
  onClose: () => void;
  onGeneratePostImage: () => void;
  onRegenerateMarketingCopy: () => void;
  onSaveEditedEntry: (event: FormEvent<HTMLFormElement>) => void;
  onUploadPostImage: (event: ChangeEvent<HTMLInputElement>) => void;
  setEntryDraft: Dispatch<SetStateAction<PublishedEntryDraftState>>;
  setRewriteInstructions: Dispatch<SetStateAction<string>>;
  sourcePullRequests: NonNullable<PublishedEntry["sourcePullRequests"]>;
}) {
  const formId = "edit-published-entry-sheet-form";
  const selectedCategory = getChangelogCategoryDefinition(
    entryDraft.category,
    categoryDefinitions,
  );
  const isPostImageTextMissing =
    !entryDraft.title.trim() || !entryDraft.summary.trim();
  const isPostImageGenerationLocked =
    postImageGenerationAvailabilityStatus !== "available";
  const postDateParts = getPublishedAtInputParts(entryDraft.publishedAt);
  const isPostDateValid = Boolean(
    normalizePublishedEntryDraftDate(entryDraft.publishedAt),
  );
  const originalPullRequestMergedAt =
    getOriginalPullRequestMergedAt(sourcePullRequests);

  function updatePublishedEntryDraftDate(dateValue: string) {
    setEntryDraft((current) => ({
      ...current,
      publishedAt: mergePublishedAtInput(
        dateValue,
        getPublishedAtInputParts(current.publishedAt).time,
        current.publishedAt,
      ),
    }));
  }

  function updatePublishedEntryDraftTime(timeValue: string) {
    setEntryDraft((current) => ({
      ...current,
      publishedAt: mergePublishedAtInput(
        getPublishedAtInputParts(current.publishedAt).date,
        timeValue,
        current.publishedAt,
      ),
    }));
  }

  function useOriginalPullRequestMergedAt() {
    if (!originalPullRequestMergedAt) {
      return;
    }

    setEntryDraft((current) => ({
      ...current,
      publishedAt: originalPullRequestMergedAt,
    }));
  }

  return (
    <PostEditorSheet
      description="Update the customer-facing title, summary, and category."
      footer={
        <>
          <Button onClick={onClose} type="button" variant="outline">
            Cancel
          </Button>
          <Button
            disabled={
              !entryDraft.title.trim() ||
              !entryDraft.summary.trim() ||
              !isPostDateValid
            }
            form={formId}
            type="submit"
          >
            <PencilIcon data-icon="inline-start" aria-hidden />
            Save changes
          </Button>
        </>
      }
      onClose={onClose}
      title="Edit post"
    >
      <form className="grid gap-5" id={formId} onSubmit={onSaveEditedEntry}>
        <label className="grid gap-2">
          <span className="text-sm font-medium">Title</span>
          <Input
            onChange={(event) =>
              setEntryDraft((current) => ({
                ...current,
                title: event.target.value,
              }))
            }
            value={entryDraft.title}
          />
        </label>

        <CategoryRadioGroup
          categoryDefinitions={categoryDefinitions}
          label="Category"
          name="edit-post-category"
          onValueChange={(category) =>
            setEntryDraft((current) => ({
              ...current,
              category,
            }))
          }
          value={entryDraft.category}
        />
        <CategoryModeSummary category={selectedCategory} />

        <div className="grid gap-2">
          <span className="text-sm font-medium">Post date</span>
          <div className="flex flex-wrap gap-2">
            <Input
              aria-label="Post date"
              className="w-40 bg-background"
              onChange={(event) =>
                updatePublishedEntryDraftDate(event.target.value)
              }
              type="date"
              value={postDateParts.date}
            />
            <TimePickerInput
              aria-label="Post time"
              onChange={(event) =>
                updatePublishedEntryDraftTime(event.target.value)
              }
              value={postDateParts.time}
            />
          </div>
          {originalPullRequestMergedAt ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
              <span>
                Original PR merged{" "}
                {formatOriginalPullRequestMergedAt(originalPullRequestMergedAt)}
              </span>
              <Button
                className="h-8 gap-1.5 px-2.5 text-xs"
                onClick={useOriginalPullRequestMergedAt}
                type="button"
                variant="outline"
              >
                <CalendarClockIcon data-icon="inline-start" aria-hidden />
                Use merged date
              </Button>
            </div>
          ) : null}
        </div>

        <div className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">Post image</span>
            {canGeneratePostImage ? (
              <div className="flex flex-wrap items-center gap-2">
                <label
                  className={cn(
                    buttonVariants({
                      className: "h-8 gap-1.5 px-2.5 text-xs",
                      variant: "outline",
                    }),
                    isUploadingPostImage && "pointer-events-none opacity-50",
                  )}
                >
                  <UploadIcon data-icon="inline-start" aria-hidden />
                  {isUploadingPostImage ? "Uploading" : "Upload image"}
                  <Input
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="sr-only"
                    disabled={isUploadingPostImage}
                    onChange={onUploadPostImage}
                    type="file"
                  />
                </label>
                <Button
                  className="h-8 gap-1.5 px-2.5 text-xs"
                  disabled={
                    isGeneratingPostImage ||
                    isUploadingPostImage ||
                    isPostImageTextMissing ||
                    isPostImageGenerationLocked
                  }
                  onClick={onGeneratePostImage}
                  type="button"
                  variant="outline"
                >
                  {isPostImageGenerationLocked ? (
                    <LockIcon data-icon="inline-start" aria-hidden />
                  ) : (
                    <ImageIcon data-icon="inline-start" aria-hidden />
                  )}
                  {isPostImageGenerationLocked
                    ? postImageGenerationAvailabilityStatus === "checking"
                      ? "Checking availability"
                      : "Generation unavailable"
                    : isGeneratingPostImage
                      ? "Generating"
                      : "Generate image"}
                </Button>
              </div>
            ) : null}
          </div>
          {imageUrl ? (
            <img
              alt="Generated post image preview"
              className="aspect-[3/2] w-full rounded-md border object-cover"
              src={imageUrl}
            />
          ) : (
            <p className="rounded-md border bg-muted/30 px-3 py-2 text-balance text-sm text-muted-foreground">
              Generate an image for post-style updates.
            </p>
          )}
        </div>

        <div className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">Public summary</span>
            {canRegenerateMarketingCopy ? (
              <Button
                className="h-8 gap-1.5 px-2.5 text-xs"
                disabled={isRegeneratingMarketingCopy}
                onClick={onRegenerateMarketingCopy}
                type="button"
                variant="outline"
              >
                <SparklesIcon data-icon="inline-start" aria-hidden />
                {isRegeneratingMarketingCopy ? "Rewriting" : "Rewrite"}
              </Button>
            ) : null}
          </div>
          {canRegenerateMarketingCopy ? (
            <label className="grid gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                Rewrite instructions (optional)
              </span>
              <Textarea
                aria-label="Rewrite instructions"
                className="min-h-20 resize-y leading-6"
                maxLength={1000}
                onChange={(event) => setRewriteInstructions(event.target.value)}
                placeholder="For example: lead with the customer outcome and keep the technical detail to one sentence."
                value={rewriteInstructions}
              />
            </label>
          ) : null}
          <Suspense fallback={<MarkdownEditorLoadingState />}>
            <MarkdownEditor
              ariaLabel="Public summary"
              markdown={entryDraft.summary}
              onChange={(markdown) =>
                setEntryDraft((current) => ({
                  ...current,
                  summary: markdown,
                }))
              }
            />
          </Suspense>
        </div>
      </form>
    </PostEditorSheet>
  );
}

function RepositoriesView({
  githubConnection,
  initialRepositorySearch,
  onConnectRepository,
  onRefreshRepositories,
  onSelectRepository,
  onSignInWithGitHub,
  repositoryVisibility,
  setRepositoryVisibility,
}: {
  githubConnection: GitHubConnectionState;
  initialRepositorySearch: string;
  onConnectRepository: () => void;
  onRefreshRepositories: () => void;
  onSelectRepository: (repositoryId: string) => void;
  onSignInWithGitHub: () => void;
  repositoryVisibility: Record<string, boolean>;
  setRepositoryVisibility: Dispatch<SetStateAction<Record<string, boolean>>>;
}) {
  const [repositorySearch, setRepositorySearch] = useState(
    initialRepositorySearch,
  );
  const repositoryTotalCount = githubConnection.repositories.length;
  const selectedRepositoryCount = githubConnection.repositories.filter(
    (repository) => repository.selected,
  ).length;
  const repositoryAllowance =
    githubConnection.repositoryLimit ?? repositoryTotalCount;
  const orderedRepositories = orderRepositoriesForDisplay(
    githubConnection.repositories,
  );
  const visibleRepositories = filterRepositories(
    orderedRepositories,
    repositorySearch,
  );

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-balance text-xl font-semibold tracking-normal">
            Repositories
          </h2>
          <p className="mt-1 text-balance text-sm text-muted-foreground">
            GitHub App installations Cooee can scan for merged pull requests.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onSignInWithGitHub} size="sm" variant="outline">
            <GithubIcon data-icon="inline-start" aria-hidden />
            Sign in with GitHub
          </Button>
          <Button onClick={onRefreshRepositories} size="sm" variant="outline">
            Refresh
          </Button>
          <Button
            disabled={githubConnection.loading}
            onClick={onConnectRepository}
            size="sm"
          >
            <GithubIcon data-icon="inline-start" aria-hidden />
            Connect repo
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-5">
        {githubConnection.error ? (
          <div className="rounded-[1.5rem] border border-destructive/20 bg-destructive/10 p-5 text-sm leading-6 text-destructive">
            {githubConnection.error}
          </div>
        ) : null}

        {!githubConnection.loading && !githubConnection.configured ? (
          <div className="rounded-[1.5rem] border border-border/70 bg-card/60 p-5">
            <h2 className="text-balance font-medium">
              GitHub App setup required
            </h2>
            <p className="mt-2 text-balance text-sm leading-6 text-muted-foreground">
              Configure `GITHUB_APP_SLUG`, `GITHUB_APP_ID`,
              `GITHUB_APP_PRIVATE_KEY`, and `GITHUB_WEBHOOK_SECRET` before
              connecting repositories.
            </p>
          </div>
        ) : null}

        {githubConnection.loading ? (
          <p className="rounded-[1.5rem] border border-border/70 bg-card/60 p-5 text-balance text-sm leading-6 text-muted-foreground">
            Checking GitHub App connection status.
          </p>
        ) : null}

        {!githubConnection.loading &&
        githubConnection.repositories.length === 0 ? (
          <p className="rounded-[1.5rem] border border-border/70 bg-card/60 p-5 text-balance text-sm leading-6 text-muted-foreground">
            No repositories connected yet.
          </p>
        ) : null}

        {githubConnection.repositories.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <label className="relative block">
              <span className="sr-only">Search repositories</span>
              <SearchIcon
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                className="pl-9"
                onChange={(event) => setRepositorySearch(event.target.value)}
                placeholder="Search repositories"
                type="search"
                value={repositorySearch}
              />
            </label>
            <div className="text-sm leading-6 text-muted-foreground">
              {selectedRepositoryCount} of {repositoryAllowance} connected
            </div>
          </div>
        ) : null}

        {githubConnection.repositories.length > 0 ? (
          <p className="text-balance text-sm leading-6 text-muted-foreground">
            Showing {visibleRepositories.length} of {repositoryTotalCount}{" "}
            repositories
          </p>
        ) : null}

        {githubConnection.repositories.length > 0 &&
        visibleRepositories.length === 0 ? (
          <p className="rounded-[1.5rem] border border-border/70 bg-card/60 p-5 text-balance text-sm leading-6 text-muted-foreground">
            No repositories match your search.
          </p>
        ) : null}

        {visibleRepositories.length > 0 ? (
          <div className="divide-y divide-border/70 overflow-hidden rounded-[1.5rem] border border-border/70 bg-card/60">
            {visibleRepositories.map((repository) => (
              <RepositoryRow
                description={
                  repository.accountLogin
                    ? `Installed on ${repository.accountLogin}`
                    : "GitHub App installation synced"
                }
                changelogSlug={repository.changelogSlug}
                label={repository.private ? "Private" : "Public"}
                name={repository.fullName}
                key={repository.id}
                onSelectRepository={() => onSelectRepository(repository.id)}
                onShowGitHubRepositoryChange={(checked) => {
                  setRepositoryVisibility((current) => ({
                    ...current,
                    [repository.fullName]: checked,
                  }));
                  toast.success("Repository visibility updated.", {
                    description: checked
                      ? `${repository.fullName} will show on the public preview.`
                      : `${repository.fullName} will be hidden from the public preview.`,
                  });
                }}
                selected={repository.selected}
                showGitHubRepository={
                  repositoryVisibility[repository.fullName] ?? false
                }
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function PrivacyReviewView({
  draftCopy,
  editingSource,
  heldEntries,
  regeneratingHeldEntryIds,
  onMarkHeldEntryRelevant,
  onPublishHeldEntry,
  onRegenerateHeldEntry,
  setDraftCopy,
  setEditingSource,
}: {
  draftCopy: Record<string, string>;
  editingSource: string | null;
  heldEntries: HeldEntry[];
  regeneratingHeldEntryIds: Set<string>;
  onMarkHeldEntryRelevant: (entry: HeldEntry) => void;
  onPublishHeldEntry: (entry: HeldEntry) => void;
  onRegenerateHeldEntry: (entry: HeldEntry) => void;
  setDraftCopy: Dispatch<SetStateAction<Record<string, string>>>;
  setEditingSource: Dispatch<SetStateAction<string | null>>;
}) {
  return (
    <section className="flex flex-col gap-6">
      <div className="max-w-3xl">
        <h2 className="text-balance text-xl font-semibold tracking-normal">
          Held for review
        </h2>
        <p className="mt-1 text-balance text-sm text-muted-foreground">
          Review held posts, check the source PR, then edit or publish the
          public copy.
        </p>
      </div>
      <div className="flex flex-col gap-5">
        {heldEntries.length === 0 ? (
          <p className="text-balance text-sm leading-6 text-muted-foreground">
            No posts are held for review.
          </p>
        ) : (
          heldEntries.map((entry) => {
            const isRegenerating = regeneratingHeldEntryIds.has(entry.id);

            return (
              <article
                className="rounded-[1.5rem] border border-border/70 bg-card/70 p-5 sm:p-6"
                key={entry.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-balance font-medium">{entry.title}</h2>
                    <p className="mt-1 text-balance text-sm text-muted-foreground">
                      Held after reviewing{" "}
                      {formatCount(
                        entry.sourcePullRequests.length || 1,
                        "pull request",
                      )}
                    </p>
                  </div>
                  <Badge variant="destructive">Held</Badge>
                </div>

                <div className="mt-4 rounded-2xl bg-destructive/8 p-4">
                  <div className="text-xs font-medium uppercase text-muted-foreground">
                    Why it is held
                  </div>
                  <div className="mt-2 text-sm font-medium">
                    {entry.reason.title}
                  </div>
                  <p className="mt-1 text-balance text-sm leading-6 text-muted-foreground">
                    {entry.reason.detail}
                  </p>
                </div>

                {entry.sourcePullRequests.length > 0 ? (
                  <div className="mt-3 rounded-2xl bg-muted/40 p-4">
                    <div className="text-xs font-medium uppercase text-muted-foreground">
                      Source PRs to review
                    </div>
                    <div className="mt-2 flex flex-col gap-1.5">
                      {entry.sourcePullRequests.map((pullRequest) => (
                        <a
                          className="grid gap-1 rounded-xl px-2 py-1.5 text-sm underline-offset-4 hover:bg-background hover:no-underline"
                          href={pullRequest.url}
                          key={`${entry.id}:${pullRequest.number}:${pullRequest.url}`}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="font-medium">
                              #{pullRequest.number}
                              {pullRequest.title ? ` ${pullRequest.title}` : ""}
                            </span>
                            <Badge variant="secondary">
                              {entry.reason.pullRequestReason}
                            </Badge>
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {pullRequest.author
                              ? `by ${pullRequest.author} · `
                              : ""}
                            PR merged {formatActivityDate(pullRequest.mergedAt)}{" "}
                            · Processed {formatActivityDate(entry.processedAt)}
                          </span>
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}

                {editingSource === entry.source ? (
                  <Textarea
                    aria-label={`Edit public copy for ${entry.title}`}
                    className="mt-3 min-h-24 resize-y leading-6"
                    onChange={(event) =>
                      setDraftCopy((copy) => ({
                        ...copy,
                        [entry.source]: event.target.value,
                      }))
                    }
                    value={draftCopy[entry.source] ?? entry.copy}
                  />
                ) : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    onClick={() => {
                      const wasEditing = editingSource === entry.source;
                      setEditingSource((source) =>
                        source === entry.source ? null : entry.source,
                      );
                      if (wasEditing) {
                        toast.success("Draft copy updated.", {
                          description: `${entry.title} was updated locally.`,
                        });
                      }
                    }}
                    size="sm"
                    variant="outline"
                  >
                    {editingSource === entry.source
                      ? "Save draft"
                      : "Edit draft"}
                  </Button>
                  <Button onClick={() => onPublishHeldEntry(entry)} size="sm">
                    Publish post
                  </Button>
                  <Button
                    disabled={isRegenerating}
                    onClick={() => onRegenerateHeldEntry(entry)}
                    size="sm"
                    variant="outline"
                  >
                    {isRegenerating ? (
                      <LoaderCircleIcon
                        className="animate-spin"
                        data-icon="inline-start"
                        aria-hidden
                      />
                    ) : (
                      <RefreshCwIcon data-icon="inline-start" aria-hidden />
                    )}
                    {isRegenerating ? "Regenerating" : "Regenerate draft"}
                  </Button>
                  <Button
                    onClick={() => onMarkHeldEntryRelevant(entry)}
                    size="sm"
                    variant="outline"
                  >
                    Mark relevant
                  </Button>
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}

function BillingView({
  connectedRepoCount,
  customerEmail,
}: {
  connectedRepoCount: number;
  customerEmail: string | null;
}) {
  const [billingDetails, setBillingDetails] =
    useState<BillingSubscriptionDetails | null>(null);
  const [billingDetailsStatus, setBillingDetailsStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [billingActionStatus, setBillingActionStatus] = useState<
    "idle" | "loading" | "error"
  >("idle");
  const [billingActionPlanId, setBillingActionPlanId] = useState<
    BillingPlan["id"] | null
  >(null);
  const [billingRecoveryStatus, setBillingRecoveryStatus] = useState<
    "idle" | "loading" | "error"
  >("idle");
  const [autoRechargeStatus, setAutoRechargeStatus] = useState<
    "idle" | "loading" | "error"
  >("idle");
  const [billingCadence, setBillingCadence] =
    useState<PricingBillingCadence>("monthly");

  useEffect(() => {
    let isCurrent = true;

    async function loadBillingDetails() {
      setBillingDetailsStatus("loading");

      try {
        const countryCode = getBrowserCountryCode();
        const subscriptionUrl = countryCode
          ? `/api/admin/billing/subscription?countryCode=${encodeURIComponent(countryCode)}`
          : "/api/admin/billing/subscription";
        const response = await fetch(subscriptionUrl);
        if (!response.ok) {
          throw new Error(`Billing request failed with ${response.status}`);
        }

        const body = (await response.json()) as BillingSubscriptionDetails;
        if (isCurrent) {
          setBillingDetails(body);
          setBillingDetailsStatus("ready");
        }
      } catch {
        if (isCurrent) {
          setBillingDetailsStatus("error");
        }
      }
    }

    void loadBillingDetails();

    return () => {
      isCurrent = false;
    };
  }, []);

  if (billingDetailsStatus === "loading" && !billingDetails) {
    return <BillingViewSkeleton />;
  }

  const subscription = billingDetails?.subscription ?? null;
  const hasComplimentaryAccess =
    billingDetails?.accessSource === "complimentary";
  const billingCurrency =
    billingDetails?.currency ??
    getBillingCurrencyForCountry(getBrowserCountryCode());
  const plans =
    billingDetails?.plans && billingDetails.plans.length > 0
      ? billingDetails.plans
      : defaultBillingPlans;
  const repositoryLimit =
    subscription?.repositoryLimit ?? billingDetails?.repositoryLimit ?? 0;
  const currentPlan = getCurrentBillingPlan({
    plans,
    planId: billingDetails?.planId ?? null,
    subscription,
  });
  const hasActiveSubscription = Boolean(
    hasComplimentaryAccess ||
    (subscription &&
      (subscription.accessState === "active" ||
        subscription.accessState === "grace")),
  );
  const hasManageableSubscription = Boolean(
    subscription &&
    !["canceled", "incomplete_expired"].includes(subscription.status),
  );
  const subscriptionStatus = subscription
    ? formatSubscriptionStatus(subscription.status)
    : "No active subscription";
  const periodEnd = formatBillingPeriodEnd(
    billingDetails?.usage?.periodEndedAt ?? subscription?.currentPeriodEnd,
  );
  const currentPlanName = currentPlan?.name ?? "Free";
  const estimatedMonthlyPullRequests =
    currentPlan?.estimatedMonthlyPullRequests ?? "Not available";
  const connectedRepositoriesUsed =
    billingDetails?.usage?.connectedRepositories ?? connectedRepoCount;
  const pullRequestsUsed = billingDetails?.usage?.pullRequestsThisPeriod ?? 0;
  const aiCreditsUsed = billingDetails?.usage?.aiCreditsThisPeriod ?? 0;
  const includedCredits =
    billingDetails?.usage?.includedCredits ??
    currentPlan?.monthlyIncludedCredits ??
    0;
  const repositoryUsagePercent = getUsagePercent(
    connectedRepositoriesUsed,
    repositoryLimit,
  );
  const creditUsagePercent = getUsagePercent(aiCreditsUsed, includedCredits);
  const billingPortalAvailable = Boolean(billingDetails?.portalUrl);
  const billingRecoveryRequired =
    !hasComplimentaryAccess &&
    billingDetails?.managementState === "recovery_required";
  const billingNotice = hasComplimentaryAccess
    ? null
    : getBillingAccountNotice(subscription);

  async function openBillingFlow(plan: BillingPlan) {
    setBillingActionStatus("loading");
    setBillingActionPlanId(plan.id);

    try {
      if (hasManageableSubscription && billingDetails?.portalUrl) {
        window.location.assign(billingDetails.portalUrl);
        return;
      }

      if (hasManageableSubscription && !billingRecoveryRequired) {
        throw new Error("Billing changes require the subscription portal.");
      }

      const response = await fetch("/api/admin/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerEmail: customerEmail?.trim() || undefined,
          planId: plan.id,
          billingCadence,
          countryCode: getBrowserCountryCode(),
          recoverSubscription: billingRecoveryRequired,
        }),
      });

      if (!response.ok) {
        throw new Error(`Billing checkout failed with ${response.status}`);
      }

      const body = (await response.json()) as BillingCheckoutResponse;
      if (!body.enabled || !body.url) {
        throw new Error("Billing checkout did not return a URL.");
      }

      window.location.assign(body.url);
    } catch {
      setBillingActionStatus("error");
    } finally {
      setBillingActionPlanId(null);
    }
  }

  async function downgradeBillingToFree() {
    setBillingRecoveryStatus("loading");

    try {
      const response = await fetch("/api/admin/billing/recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "downgrade_to_free",
          countryCode: getBrowserCountryCode(),
        }),
      });
      if (!response.ok) {
        throw new Error(`Billing recovery failed with ${response.status}`);
      }

      const body = (await response.json()) as BillingSubscriptionDetails;
      setBillingDetails(body);
      setBillingDetailsStatus("ready");
      setBillingRecoveryStatus("idle");
    } catch {
      setBillingRecoveryStatus("error");
    }
  }

  async function setAutoRechargeEnabled(enabled: boolean) {
    if (!subscription) return;
    setAutoRechargeStatus("loading");
    try {
      const response = await fetch("/api/admin/billing/auto-recharge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) {
        throw new Error(`Auto-recharge update failed with ${response.status}`);
      }
      const body = (await response.json()) as BillingSubscriptionDetails;
      setBillingDetails(body);
      setBillingDetailsStatus("ready");
      setAutoRechargeStatus("idle");
    } catch {
      setAutoRechargeStatus("error");
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-[1.5rem] border border-border/70 bg-card/60 p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-balance text-xl font-semibold tracking-normal">
                {currentPlanName}
              </h2>
              <Badge variant={hasActiveSubscription ? "default" : "secondary"}>
                {hasComplimentaryAccess
                  ? "Complimentary access"
                  : subscription
                    ? subscriptionStatus
                    : "Free allowance"}
              </Badge>
            </div>
            <p className="mt-2 max-w-2xl text-balance text-sm leading-6 text-muted-foreground">
              {hasComplimentaryAccess
                ? `Full ${currentPlanName} access is provided at no charge. No payment method or automatic recharges are used.`
                : hasActiveSubscription
                  ? "Your active subscription controls repository access and includes an AI credit allowance."
                  : "No paid subscription is active. Manual posts remain available on the Free plan."}
            </p>
          </div>
          {billingPortalAvailable ? (
            <a
              className={cn(
                buttonVariants({ size: "sm", variant: "outline" }),
                "rounded-full",
              )}
              href={billingDetails?.portalUrl ?? undefined}
              rel="noreferrer"
              target="_blank"
            >
              <ExternalLinkIcon data-icon="inline-start" aria-hidden />
              Manage subscription
            </a>
          ) : null}
        </div>

        {billingDetailsStatus === "error" ? (
          <p className="mt-5 text-balance text-sm leading-6 text-destructive">
            Billing details could not be loaded.
          </p>
        ) : (
          <>
            {billingRecoveryRequired ? (
              <div
                className="mt-5 flex flex-col gap-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-4 text-rose-950 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-50 sm:flex-row sm:items-center sm:justify-between"
                role="status"
              >
                <div className="max-w-2xl">
                  <p className="text-sm font-medium">Choose how to continue</p>
                  <p className="mt-1 text-balance text-sm leading-6 text-rose-800 dark:text-rose-200">
                    We can’t manage the saved plan from this workspace. Choose a
                    plan below to reconnect billing, or switch to Free for
                    manual posts and one repository.
                  </p>
                  {billingRecoveryStatus === "error" ? (
                    <p className="mt-2 text-sm leading-6 text-destructive">
                      We couldn’t switch this workspace to Free. Try again.
                    </p>
                  ) : null}
                </div>
                <Button
                  className="shrink-0 border-rose-300 bg-rose-100 text-rose-950 hover:bg-rose-200 focus-visible:border-rose-500 focus-visible:ring-rose-300/50 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-50 dark:hover:bg-rose-900"
                  disabled={billingRecoveryStatus === "loading"}
                  onClick={downgradeBillingToFree}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {billingRecoveryStatus === "loading"
                    ? "Switching to Free"
                    : "Switch to Free"}
                </Button>
              </div>
            ) : billingNotice ? (
              <div
                className={cn(
                  "mt-5 rounded-xl border px-4 py-3 text-sm leading-6",
                  billingNotice.urgent
                    ? "border-destructive/30 bg-destructive/5 text-destructive"
                    : "border-border bg-muted/35 text-foreground",
                )}
                role={billingNotice.urgent ? "alert" : "status"}
              >
                <span className="font-medium">{billingNotice.title}</span>{" "}
                {billingNotice.message}
              </div>
            ) : null}
            <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-3">
              <div className="rounded-xl bg-muted/45 p-4">
                <dt className="text-balance text-muted-foreground">
                  Repositories used
                </dt>
                <dd className="mt-2 text-balance text-lg font-semibold tracking-normal">
                  {formatUsageCount(connectedRepositoriesUsed, repositoryLimit)}
                </dd>
                <UsageMeter value={repositoryUsagePercent} />
              </div>
              <div className="rounded-xl bg-muted/45 p-4">
                <dt className="text-balance text-muted-foreground">
                  AI credits used
                </dt>
                <dd className="mt-2 text-balance text-lg font-semibold tracking-normal">
                  {formatUsageCount(aiCreditsUsed, includedCredits)}
                </dd>
                <UsageMeter value={creditUsagePercent} />
                <p className="mt-2 text-balance text-xs leading-5 text-muted-foreground">
                  {formatCompactCount(pullRequestsUsed)} PRs processed; typical
                  allowance covers ~{estimatedMonthlyPullRequests}.
                </p>
              </div>
              <div className="rounded-xl bg-muted/45 p-4">
                <dt className="text-balance text-muted-foreground">
                  Usage resets
                </dt>
                <dd className="mt-2 text-balance text-lg font-semibold tracking-normal">
                  {periodEnd}
                </dd>
              </div>
            </dl>
            {!hasComplimentaryAccess &&
            hasActiveSubscription &&
            subscription ? (
              <div className="mt-4 flex flex-col gap-3 rounded-xl border border-border/70 bg-muted/25 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">
                    Automatic AI credit recharges
                  </p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {subscription.autoRechargeEnabled
                      ? `${formatBillingAmount(aiCreditRecharge.amount, billingCurrency)} adds ${aiCreditRecharge.credits} credits whenever your included allowance is used.`
                      : `AI runs pause when your included credits are used. Turn this on to add ${aiCreditRecharge.credits}-credit recharges automatically.`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {autoRechargeStatus === "loading"
                      ? "Updating"
                      : subscription.autoRechargeEnabled
                        ? "On"
                        : "Off"}
                  </span>
                  <Switch
                    aria-label="Automatic AI credit recharges"
                    checked={subscription.autoRechargeEnabled}
                    disabled={autoRechargeStatus === "loading"}
                    onCheckedChange={(enabled) =>
                      void setAutoRechargeEnabled(enabled)
                    }
                  />
                </div>
              </div>
            ) : null}
            {autoRechargeStatus === "error" ? (
              <p className="mt-3 text-sm text-destructive">
                We couldn’t update automatic recharges. Try again.
              </p>
            ) : null}
          </>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-balance text-xl font-semibold tracking-normal">
              Plans
            </h2>
            <p className="mt-1 text-balance text-sm text-muted-foreground">
              {hasComplimentaryAccess
                ? "Your complimentary plan is managed for this workspace."
                : "Pick the repository and AI credit allowance that matches this workspace."}
            </p>
          </div>
          {!hasComplimentaryAccess ? (
            <div
              aria-label="Billing cadence"
              className="inline-flex self-start rounded-full border bg-muted/45 p-1 sm:self-auto"
            >
              {(
                [
                  ["monthly", "Monthly"],
                  ["annual", "Annual · 2 months free"],
                ] as const
              ).map(([cadence, label]) => {
                const isActive = billingCadence === cadence;
                return (
                  <button
                    aria-pressed={isActive}
                    className={cn(
                      "h-8 rounded-full px-3 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-background text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    key={cadence}
                    onClick={() => setBillingCadence(cadence)}
                    type="button"
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          {plans.map((plan) => {
            const priceLabel = formatBillingAmount(
              billingCadence === "annual"
                ? plan.annualAmount
                : plan.monthlyAmount,
              billingCurrency,
            );
            const cadence =
              billingCadence === "annual" ? plan.annualCadence : plan.cadence;
            const isCurrent =
              !billingRecoveryRequired && currentPlan?.id === plan.id;
            const isLoading =
              billingActionStatus === "loading" &&
              billingActionPlanId === plan.id;
            const isActionDisabled =
              hasComplimentaryAccess ||
              billingDetailsStatus === "loading" ||
              isCurrent ||
              (hasManageableSubscription &&
                !billingPortalAvailable &&
                !billingRecoveryRequired);

            return (
              <article
                className={[
                  "flex min-h-full flex-col rounded-[1.5rem] border border-border/70 bg-card/60 p-5",
                  isCurrent ? "border-primary/70 bg-primary/5" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                key={plan.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-balance text-lg font-semibold tracking-normal">
                      {plan.name}
                    </h3>
                    <p className="mt-2 text-balance text-sm leading-6 text-muted-foreground">
                      {plan.description}
                    </p>
                  </div>
                  {isCurrent ? <Badge>Current</Badge> : null}
                </div>

                <div className="mt-6 flex items-baseline gap-2">
                  <span className="text-3xl font-semibold tracking-normal">
                    {hasComplimentaryAccess && isCurrent
                      ? "Complimentary"
                      : priceLabel}
                  </span>
                  {hasComplimentaryAccess && isCurrent ? null : (
                    <span className="text-sm text-muted-foreground">
                      / {cadence}
                    </span>
                  )}
                </div>

                <dl className="mt-5 text-sm">
                  <div className="rounded-xl bg-muted/45 p-3">
                    <dt className="text-balance text-muted-foreground">
                      AI credits / month
                    </dt>
                    <dd className="mt-1 font-medium">
                      {formatCompactCount(plan.monthlyIncludedCredits)}
                    </dd>
                  </div>
                </dl>

                <p className="mt-3 text-sm text-muted-foreground">
                  ~{formatCompactCount(plan.estimatedMonthlyPullRequests)} PRs
                  at typical usage
                </p>

                <ul className="mt-5 flex flex-1 flex-col gap-3">
                  {plan.features.map((feature) => (
                    <li
                      className="flex items-start gap-2 text-sm leading-6 text-muted-foreground"
                      key={feature}
                    >
                      <CheckCircle2Icon
                        aria-hidden
                        className="mt-1 size-4 shrink-0 text-foreground"
                      />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  className="mt-6 w-full"
                  disabled={isActionDisabled || isLoading}
                  onClick={() => openBillingFlow(plan)}
                  size="lg"
                  type="button"
                  variant={isCurrent ? "outline" : "default"}
                >
                  {!hasComplimentaryAccess ? (
                    <ExternalLinkIcon data-icon="inline-start" aria-hidden />
                  ) : null}
                  {hasComplimentaryAccess
                    ? isCurrent
                      ? "Included"
                      : "Managed by Cooee"
                    : isLoading
                      ? "Opening billing"
                      : getBillingPlanActionLabel({
                          plan,
                          currentPlan,
                          hasPortal: billingPortalAvailable,
                          hasSubscription: hasManageableSubscription,
                          recoveryRequired: billingRecoveryRequired,
                        })}
                </Button>
              </article>
            );
          })}
        </div>
        {!hasComplimentaryAccess ? (
          <p className="text-center text-xs text-muted-foreground">
            {getAiCreditOverageLabel(billingCurrency)}
          </p>
        ) : null}
        {billingActionStatus === "error" ? (
          <p className="text-balance text-sm leading-6 text-destructive">
            Billing could not be opened.
          </p>
        ) : null}
      </section>
    </div>
  );
}

function UsageMeter({
  className,
  value,
}: {
  className?: string;
  value: number;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "mt-4 h-1.5 overflow-hidden rounded-full bg-background",
        className,
      )}
    >
      <div
        className="h-full rounded-full bg-foreground"
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

function BillingViewSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-live="polite">
      <section className="rounded-[1.5rem] border border-border/70 bg-card/60 p-5 sm:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-7 w-24" />
              <Skeleton className="h-6 w-16 rounded-full" />
            </div>
            <Skeleton className="mt-3 h-4 w-full max-w-xl" />
          </div>
          <Skeleton className="h-9 w-44 rounded-xl" />
        </div>

        <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-3">
          {["repositories", "pull-requests", "reset"].map((item) => (
            <div className="rounded-xl bg-muted/45 p-4" key={item}>
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-3 h-7 w-24" />
              <Skeleton className="mt-4 h-1.5 w-full rounded-full" />
            </div>
          ))}
        </dl>
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <Skeleton className="h-7 w-16" />
          <Skeleton className="mt-2 h-4 w-full max-w-md" />
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          {["lobster", "pineapple", "watermelon"].map((plan) => (
            <BillingPlanSkeleton key={plan} />
          ))}
        </div>
      </section>
    </div>
  );
}

function BillingPlanSkeleton() {
  return (
    <article className="flex min-h-full flex-col rounded-[1.5rem] border border-border/70 bg-card/60 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Skeleton className="h-7 w-28" />
          <Skeleton className="mt-3 h-4 w-48" />
          <Skeleton className="mt-2 h-4 w-36" />
        </div>
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>

      <div className="mt-6 flex items-baseline gap-2">
        <Skeleton className="h-10 w-20" />
        <Skeleton className="h-4 w-16" />
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-muted/45 p-3">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="mt-2 h-5 w-10" />
        </div>
        <div className="rounded-xl bg-muted/45 p-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="mt-2 h-5 w-12" />
        </div>
      </dl>

      <div className="mt-5 flex flex-1 flex-col gap-3">
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-11/12" />
        <Skeleton className="h-5 w-4/5" />
      </div>

      <Skeleton className="mt-6 h-9 w-full rounded-xl" />
    </article>
  );
}

function getCurrentBillingPlan({
  plans,
  planId,
  subscription,
}: {
  plans: BillingPlan[];
  planId: BillingSubscriptionDetails["planId"];
  subscription: BillingSubscriptionDetails["subscription"];
}): BillingPlan | null {
  if (
    !subscription ||
    !["active", "grace"].includes(subscription.accessState) ||
    planId === "free" ||
    !planId
  ) {
    return null;
  }

  return plans.find((plan) => plan.id === planId) ?? null;
}

function getBillingAccountNotice(
  subscription: BillingSubscriptionDetails["subscription"],
): { title: string; message: string; urgent: boolean } | null {
  if (!subscription) return null;
  if (subscription.accessState === "grace") {
    return {
      title: "Payment needs attention.",
      message:
        "Paid features remain available while payment is retried. Update your payment method to avoid an interruption.",
      urgent: true,
    };
  }
  if (subscription.accessState === "restricted") {
    return {
      title: "Paid features are paused.",
      message: "Update billing to restore your plan’s features and limits.",
      urgent: true,
    };
  }
  if (subscription.cancelAtPeriodEnd) {
    const end = formatBillingPeriodEnd(
      subscription.cancelAt ?? subscription.currentPeriodEnd,
    );
    return {
      title: "Cancellation scheduled.",
      message: `Paid access remains available until ${end}.`,
      urgent: false,
    };
  }
  return null;
}

function getBillingPlanActionLabel({
  currentPlan,
  hasPortal,
  hasSubscription,
  plan,
  recoveryRequired,
}: {
  currentPlan: BillingPlan | null;
  hasPortal: boolean;
  hasSubscription: boolean;
  plan: BillingPlan;
  recoveryRequired: boolean;
}): string {
  if (recoveryRequired) {
    return `Choose ${plan.name}`;
  }

  if (currentPlan?.id === plan.id) {
    return "Current plan";
  }

  if (hasSubscription) {
    return hasPortal ? "Change plan" : "Manage unavailable";
  }

  return `Start ${plan.name}`;
}

function getUsagePercent(used: number, limit: number): number {
  if (limit <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, (used / limit) * 100));
}

function formatUsageCount(used: number, limit: number): string {
  if (limit <= 0) {
    return formatCompactCount(used);
  }

  return `${formatCompactCount(used)} of ${formatCompactCount(limit)}`;
}

function formatHeaderAiCreditUsage(usageDetails: BillingUsageDetails): string {
  const { aiCreditsThisPeriod, includedCredits } = usageDetails.usage;
  if (
    usageDetails.billingMode === "self-hosted" ||
    includedCredits >= Number.MAX_SAFE_INTEGER
  ) {
    return `${formatCompactCount(aiCreditsThisPeriod)} used`;
  }

  return formatUsageCount(aiCreditsThisPeriod, includedCredits);
}

export function getNextScheduledRunLabel({
  now,
  settings,
}: {
  now: Date;
  settings: Pick<
    SettingsState,
    "publishTime" | "scheduleFrequency" | "timeZone"
  > &
    Partial<Pick<SettingsState, "scheduleMonthDay" | "scheduleWeekday">>;
}): string {
  if (settings.scheduleFrequency === "on-merge") {
    return "On the next PR merge";
  }

  try {
    const nextRun = getNextScheduledRun({
      frequency: settings.scheduleFrequency,
      now,
      publishTime: settings.publishTime,
      scheduleMonthDay: settings.scheduleMonthDay,
      scheduleWeekday: settings.scheduleWeekday,
      timeZone: settings.timeZone,
    });

    const parts = new Intl.DateTimeFormat("en-AU", {
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      month: "short",
      timeZone: settings.timeZone,
      weekday: "short",
    }).formatToParts(nextRun);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((candidate) => candidate.type === type)?.value ?? "";

    return `${part("weekday").slice(0, 3)}, ${part("day")} ${part("month").slice(0, 3)} at ${part("hour")}:${part("minute")} ${part("dayPeriod").toLowerCase()}`;
  } catch {
    return "Unavailable";
  }
}

function formatCompactCount(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 1,
    notation: value >= 1000 ? "compact" : "standard",
  }).format(value);
}

function formatOrdinal(value: number): string {
  const modulo100 = value % 100;
  const suffix =
    modulo100 >= 11 && modulo100 <= 13
      ? "th"
      : value % 10 === 1
        ? "st"
        : value % 10 === 2
          ? "nd"
          : value % 10 === 3
            ? "rd"
            : "th";

  return `${value}${suffix}`;
}

function formatSubscriptionStatus(status: string): string {
  return status
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function getBrowserCountryCode(): string | null {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (timeZone === "Pacific/Auckland" || timeZone === "Pacific/Chatham") {
    return "NZ";
  }
  if (timeZone?.startsWith("Australia/")) return "AU";
  if (timeZone === "Europe/London") return "GB";

  if (typeof navigator !== "undefined") {
    for (const locale of navigator.languages ?? [navigator.language]) {
      const country = getCountryCodeFromLocale(locale);
      if (country) return country;
    }
  }

  return null;
}

function formatBillingPeriodEnd(value: string | null | undefined): string {
  if (!value) {
    return "Not available";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not available"
    : format(date, "MMM d, yyyy");
}

const settingsNavigationItems = [
  { id: "settings-brand", label: "Brand" },
  { id: "settings-public-page", label: "Public page" },
  { id: "settings-schedule", label: "Schedule" },
  { id: "settings-ai", label: "AI" },
  { id: "settings-domain", label: "Domain" },
  { id: "settings-categories", label: "Categories" },
  { id: "settings-privacy", label: "Privacy" },
];

const settingsFieldLabelClassName =
  "text-balance text-sm font-normal leading-6 text-muted-foreground";

function SettingsView({
  customBrandingEnabled,
  customDomainActionStatus,
  defaultAppName,
  onRefreshCustomDomainStatus,
  onSaveCustomDomain,
  setSettings,
  settings,
}: {
  customBrandingEnabled: boolean;
  customDomainActionStatus: CustomDomainActionStatus;
  defaultAppName: string;
  onRefreshCustomDomainStatus: () => void;
  onSaveCustomDomain: () => void;
  setSettings: SettingsUpdater;
  settings: SettingsState;
}) {
  const [logoUploadStatus, setLogoUploadStatus] = useState<"idle" | "saving">(
    "idle",
  );
  const logoPreviewUrl = settings.logoUrl ?? settings.logoDataUrl;
  const lightLogoPreviewUrl =
    settings.lightLogoUrl ?? settings.lightLogoDataUrl;
  const faviconPreviewUrl = settings.faviconUrl ?? settings.faviconDataUrl;
  const [customBrandAssetStatus, setCustomBrandAssetStatus] =
    useState<CustomBrandAssetKind | null>(null);
  const cnameTarget = settings.customHostnameCnameTarget || "cloud.cooee.sh";
  const domainStatusLabel = formatCustomHostnameStatus(
    settings.customHostnameStatus,
    "Waiting for save",
  );
  const sslStatusLabel = formatCustomHostnameStatus(
    settings.customHostnameSslStatus,
    "Waiting for DNS",
  );
  const customDomainActionInFlight = customDomainActionStatus !== "idle";
  const categoryDefinitions =
    settings.categoryDefinitions.length > 0
      ? settings.categoryDefinitions
      : defaultChangelogCategoryDefinitions;
  const [activeSettingsSectionId, setActiveSettingsSectionId] = useState(
    settingsNavigationItems[0].id,
  );

  useEffect(() => {
    let animationFrameId = 0;

    function updateActiveSettingsSection() {
      const activationOffset = Math.min(window.innerHeight * 0.32, 180);
      let nextActiveSectionId = settingsNavigationItems[0].id;

      for (const item of settingsNavigationItems) {
        const section = document.getElementById(item.id);

        if (!section) {
          continue;
        }

        if (section.getBoundingClientRect().top <= activationOffset) {
          nextActiveSectionId = item.id;
        }
      }

      const isAtPageEnd =
        window.scrollY + window.innerHeight >=
        document.documentElement.scrollHeight - 2;

      if (isAtPageEnd) {
        nextActiveSectionId =
          settingsNavigationItems.at(-1)?.id ?? nextActiveSectionId;
      }

      setActiveSettingsSectionId(nextActiveSectionId);
    }

    function scheduleActiveSettingsSectionUpdate() {
      if (animationFrameId) {
        window.cancelAnimationFrame(animationFrameId);
      }

      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = 0;
        updateActiveSettingsSection();
      });
    }

    updateActiveSettingsSection();
    window.addEventListener("scroll", scheduleActiveSettingsSectionUpdate, {
      passive: true,
    });
    window.addEventListener("resize", scheduleActiveSettingsSectionUpdate);

    return () => {
      if (animationFrameId) {
        window.cancelAnimationFrame(animationFrameId);
      }

      window.removeEventListener("scroll", scheduleActiveSettingsSectionUpdate);
      window.removeEventListener("resize", scheduleActiveSettingsSectionUpdate);
    };
  }, []);

  async function copyCnameTarget() {
    try {
      await navigator.clipboard.writeText(cnameTarget);
      toast.success("CNAME copied.", {
        description: cnameTarget,
      });
    } catch {
      toast.error("Could not copy CNAME.", {
        description: "Select and copy the CNAME target manually.",
      });
    }
  }

  async function uploadLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const form = new FormData();
    form.set("logo", file);
    setLogoUploadStatus("saving");

    try {
      const response = await fetch("/api/admin/settings/logo", {
        method: "POST",
        body: form,
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          body.error ?? `Logo upload failed with ${response.status}`,
        );
      }

      const body = (await response.json()) as {
        settings?: Partial<SettingsState>;
      };
      setSettings((current) => mergeSettings(current, body.settings), {
        autosave: false,
      });
      toast.success("Logo uploaded.", {
        description: "The public changelog logo was updated.",
      });
    } catch (error) {
      toast.error("Could not upload logo.", {
        description:
          error instanceof Error
            ? error.message
            : "Check object storage configuration and try again.",
      });
    } finally {
      setLogoUploadStatus("idle");
      event.target.value = "";
    }
  }

  async function removeLogo() {
    setLogoUploadStatus("saving");

    try {
      const response = await fetch("/api/admin/settings/logo", {
        method: "DELETE",
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          body.error ?? `Logo removal failed with ${response.status}`,
        );
      }

      const body = (await response.json()) as {
        settings?: Partial<SettingsState>;
      };
      setSettings((current) => mergeSettings(current, body.settings), {
        autosave: false,
      });
      toast.success("Logo removed.", {
        description: "The public changelog logo was removed.",
      });
    } catch (error) {
      toast.error("Could not remove logo.", {
        description:
          error instanceof Error
            ? error.message
            : "Check object storage configuration and try again.",
      });
    } finally {
      setLogoUploadStatus("idle");
    }
  }

  async function uploadCustomBrandAsset(
    kind: CustomBrandAssetKind,
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    if (!file || !customBrandingEnabled || customBrandAssetStatus) return;

    const endpoint = kind === "lightLogo" ? "light-logo" : "favicon";
    const label = kind === "lightLogo" ? "Light mode logo" : "Favicon";
    const form = new FormData();
    form.set(kind === "lightLogo" ? "logo" : "favicon", file);
    setCustomBrandAssetStatus(kind);

    try {
      const response = await fetch(`/api/admin/settings/${endpoint}`, {
        method: "POST",
        body: form,
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          body.error ?? `${label} upload failed with ${response.status}`,
        );
      }

      const body = (await response.json()) as {
        settings?: Partial<SettingsState>;
      };
      setSettings((current) => mergeSettings(current, body.settings), {
        autosave: false,
      });
      toast.success(`${label} uploaded.`);
    } catch (error) {
      toast.error(`Could not upload ${label.toLowerCase()}.`, {
        description:
          error instanceof Error
            ? error.message
            : "Check object storage configuration and try again.",
      });
    } finally {
      setCustomBrandAssetStatus(null);
      event.target.value = "";
    }
  }

  async function removeCustomBrandAsset(kind: CustomBrandAssetKind) {
    if (!customBrandingEnabled || customBrandAssetStatus) return;

    const endpoint = kind === "lightLogo" ? "light-logo" : "favicon";
    const label = kind === "lightLogo" ? "Light mode logo" : "Favicon";
    setCustomBrandAssetStatus(kind);

    try {
      const response = await fetch(`/api/admin/settings/${endpoint}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          body.error ?? `${label} removal failed with ${response.status}`,
        );
      }

      const body = (await response.json()) as {
        settings?: Partial<SettingsState>;
      };
      setSettings((current) => mergeSettings(current, body.settings), {
        autosave: false,
      });
      toast.success(`${label} removed.`);
    } catch (error) {
      toast.error(`Could not remove ${label.toLowerCase()}.`, {
        description:
          error instanceof Error
            ? error.message
            : "Check object storage configuration and try again.",
      });
    } finally {
      setCustomBrandAssetStatus(null);
    }
  }

  function updateCategoryDefinition(
    index: number,
    patch: Partial<
      Pick<
        ChangelogCategoryDefinition,
        "displayType" | "label" | "marketingCopy"
      >
    >,
  ) {
    setSettings((current) => {
      const definitions = normalizeChangelogCategoryDefinitions(
        current.categoryDefinitions,
      );
      const next = definitions.map((definition, itemIndex) => {
        if (itemIndex !== index) {
          return definition;
        }

        const label =
          patch.label !== undefined
            ? patch.label.slice(0, 48)
            : definition.label;
        const id =
          patch.label !== undefined
            ? normalizeChangelogCategoryId(label) || definition.id
            : definition.id;
        const displayType = patch.displayType ?? definition.displayType;
        const marketingCopy =
          displayType === "post"
            ? (patch.marketingCopy ?? definition.marketingCopy ?? false)
            : false;

        return {
          ...definition,
          ...patch,
          id,
          label,
          displayType,
          marketingCopy,
        };
      });

      return {
        ...current,
        categoryDefinitions: next,
      };
    });
  }

  function addCategoryDefinition() {
    setSettings((current) => {
      const definitions = normalizeChangelogCategoryDefinitions(
        current.categoryDefinitions,
      );
      const labels = new Set(definitions.map((category) => category.label));
      let label = "New category";
      let suffix = 2;
      while (labels.has(label)) {
        label = `New category ${suffix}`;
        suffix += 1;
      }

      return {
        ...current,
        categoryDefinitions: normalizeChangelogCategoryDefinitions([
          ...definitions,
          {
            id: normalizeChangelogCategoryId(label),
            label,
            displayType: "callout",
            marketingCopy: false,
          },
        ]),
      };
    });
  }

  function removeCategoryDefinition(index: number) {
    setSettings((current) => {
      const definitions = normalizeChangelogCategoryDefinitions(
        current.categoryDefinitions,
      );

      if (definitions.length <= 1) {
        return current;
      }

      return {
        ...current,
        categoryDefinitions: normalizeChangelogCategoryDefinitions(
          definitions.filter((_, itemIndex) => itemIndex !== index),
        ),
      };
    });
  }

  return (
    <section className="flex flex-col gap-8">
      <div className="pb-2">
        <div className="min-w-0">
          <h2 className="text-balance text-xl font-semibold tracking-normal">
            Settings
          </h2>
          <p className="mt-1 max-w-2xl text-balance text-sm leading-6 text-muted-foreground">
            Set up how Cooee turns merged pull requests into a public changelog.
            Start with Brand and Public page, then adjust the advanced sections
            when you need them.
          </p>
        </div>
      </div>

      <div className="grid gap-8 xl:grid-cols-[12rem_minmax(0,1fr)] xl:items-start xl:gap-10">
        <nav
          aria-label="Settings sections"
          className="xl:sticky xl:top-6 xl:self-start"
        >
          <div className="flex gap-1 overflow-x-auto border-b border-border pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden xl:flex-col xl:overflow-visible xl:border-b-0 xl:pb-0">
            {settingsNavigationItems.map((item) => (
              <a
                aria-current={
                  activeSettingsSectionId === item.id ? "location" : undefined
                }
                className={cn(
                  "shrink-0 rounded-full px-3 py-2 text-sm font-medium underline-offset-4 transition-[background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  activeSettingsSectionId === item.id
                    ? "bg-foreground text-background shadow-xs"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                href={`#${item.id}`}
                key={item.id}
              >
                {item.label}
              </a>
            ))}
          </div>
        </nav>

        <div className="min-w-0 space-y-10">
          <SettingsSection
            description="These details appear on the dashboard and the public changelog."
            id="settings-brand"
            title="Brand"
          >
            <SettingsRow
              description="Use the product name customers recognize."
              htmlFor="settings-app-name"
              title="App name"
            >
              <Input
                id="settings-app-name"
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    appName: event.target.value,
                  }))
                }
                placeholder={defaultAppName}
                value={settings.appName}
              />
            </SettingsRow>

            <SettingsRow
              description="Used in dark mode and whenever no light mode logo is set. PNG, JPEG, WebP, GIF, or SVG up to 512 KB."
              htmlFor="settings-logo-upload"
              title="Default logo"
            >
              <div className="grid gap-3">
                <Input
                  accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                  disabled={logoUploadStatus === "saving"}
                  id="settings-logo-upload"
                  onChange={uploadLogo}
                  type="file"
                />
                {logoPreviewUrl ? (
                  <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/70 bg-muted/35 px-3 py-2">
                    <img
                      alt="Uploaded logo preview"
                      className="h-7 w-auto"
                      src={logoPreviewUrl}
                    />
                    <Button
                      disabled={logoUploadStatus === "saving"}
                      onClick={removeLogo}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {logoUploadStatus === "saving" ? "Removing" : "Remove"}
                    </Button>
                  </div>
                ) : null}
              </div>
            </SettingsRow>

            <SettingsRow
              description={
                customBrandingEnabled
                  ? "Shown on light backgrounds. Falls back to the default logo when empty. PNG, JPEG, WebP, GIF, or SVG up to 512 KB."
                  : "Available on paid plans. Shown on light backgrounds instead of the default logo."
              }
              htmlFor="settings-light-logo-upload"
              title="Light mode logo"
            >
              <div className="grid gap-3">
                <Input
                  accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                  disabled={
                    !customBrandingEnabled || customBrandAssetStatus !== null
                  }
                  id="settings-light-logo-upload"
                  onChange={(event) =>
                    void uploadCustomBrandAsset("lightLogo", event)
                  }
                  type="file"
                />
                {lightLogoPreviewUrl ? (
                  <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/70 bg-[oklch(0.98_0.005_105)] px-3 py-2">
                    <img
                      alt="Light mode logo preview"
                      className="h-7 w-auto"
                      src={lightLogoPreviewUrl}
                    />
                    <Button
                      disabled={customBrandAssetStatus !== null}
                      onClick={() => void removeCustomBrandAsset("lightLogo")}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {customBrandAssetStatus === "lightLogo"
                        ? "Removing"
                        : "Remove"}
                    </Button>
                  </div>
                ) : null}
              </div>
            </SettingsRow>

            <SettingsRow
              description={
                customBrandingEnabled
                  ? "Used in browser tabs for the public changelog. PNG, SVG, or ICO up to 256 KB."
                  : "Available on paid plans. Used in browser tabs for the public changelog."
              }
              htmlFor="settings-favicon-upload"
              title="Favicon"
            >
              <div className="grid gap-3">
                <Input
                  accept="image/png,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,.ico"
                  disabled={
                    !customBrandingEnabled || customBrandAssetStatus !== null
                  }
                  id="settings-favicon-upload"
                  onChange={(event) =>
                    void uploadCustomBrandAsset("favicon", event)
                  }
                  type="file"
                />
                {faviconPreviewUrl ? (
                  <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/70 bg-muted/35 px-3 py-2">
                    <img
                      alt="Favicon preview"
                      className="size-7 object-contain"
                      src={faviconPreviewUrl}
                    />
                    <Button
                      disabled={customBrandAssetStatus !== null}
                      onClick={() => void removeCustomBrandAsset("favicon")}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {customBrandAssetStatus === "favicon"
                        ? "Removing"
                        : "Remove"}
                    </Button>
                  </div>
                ) : null}
              </div>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection
            description="Control what visitors see when they open your changelog."
            id="settings-public-page"
            title="Public page"
          >
            <SettingsRow
              description="Turn this on when approved updates should appear on the public changelog and feed."
              title="Publish approved updates"
            >
              <SettingsSwitch
                checked={settings.publicChangelog}
                label="Publish approved updates"
                onCheckedChange={(checked) =>
                  setSettings((current) => ({
                    ...current,
                    publicChangelog: checked,
                  }))
                }
              />
            </SettingsRow>

            <SettingsRow
              description="This becomes the last part of the public changelog URL."
              htmlFor="settings-public-slug"
              title="Public URL slug"
            >
              <Input
                className="font-mono"
                id="settings-public-slug"
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    publicSlug: event.target.value,
                  }))
                }
                value={settings.publicSlug}
              />
            </SettingsRow>

            <SettingsRow
              description="Optional. Add a button that takes visitors back to your product or marketing site."
              htmlFor="settings-public-app-url"
              title="Product link URL"
            >
              <Input
                id="settings-public-app-url"
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    publicAppUrl: event.target.value,
                  }))
                }
                placeholder="https://app.example.com"
                type="url"
                value={settings.publicAppUrl}
              />
            </SettingsRow>

            <SettingsRow
              description="Short button text for the product link."
              htmlFor="settings-public-app-label"
              title="Product link label"
            >
              <Input
                id="settings-public-app-label"
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    publicAppLabel: event.target.value,
                  }))
                }
                placeholder={defaultPublicAppLabel}
                value={settings.publicAppLabel}
              />
            </SettingsRow>

            <SettingsRow
              description="Position the logo above the changelog title."
              title="Public logo alignment"
            >
              <ToggleGroup
                aria-label="Public logo alignment"
                onValueChange={(value) => {
                  const alignment = value.at(-1);
                  if (!alignment) {
                    return;
                  }

                  setSettings((current) => ({
                    ...current,
                    publicLogoAlignment:
                      normalizePublicLogoAlignment(alignment),
                  }));
                }}
                size="sm"
                spacing={0}
                value={[settings.publicLogoAlignment]}
                variant="outline"
              >
                <ToggleGroupItem value="left">
                  <AlignLeftIcon aria-hidden data-icon="inline-start" />
                  Left
                </ToggleGroupItem>
                <ToggleGroupItem value="center">
                  <AlignCenterIcon aria-hidden data-icon="inline-start" />
                  Center
                </ToggleGroupItem>
                <ToggleGroupItem value="right">
                  <AlignRightIcon aria-hidden data-icon="inline-start" />
                  Right
                </ToggleGroupItem>
              </ToggleGroup>
            </SettingsRow>

            <SettingsRow
              description="Visitors can still switch themes. This only sets the first view."
              title="Default public theme"
            >
              <ToggleGroup
                aria-label="Default public theme"
                onValueChange={(value) => {
                  const themeOption = value.at(-1);
                  if (!themeOption) {
                    return;
                  }

                  setSettings((current) => ({
                    ...current,
                    publicTheme: normalizeThemeMode(themeOption),
                  }));
                }}
                size="sm"
                spacing={0}
                value={[settings.publicTheme]}
                variant="outline"
              >
                <ToggleGroupItem value="light">
                  <SunIcon aria-hidden data-icon="inline-start" />
                  Light
                </ToggleGroupItem>
                <ToggleGroupItem value="dark">
                  <MoonIcon aria-hidden data-icon="inline-start" />
                  Dark
                </ToggleGroupItem>
              </ToggleGroup>
            </SettingsRow>

            <SettingsRow
              description="Show source pull requests on public entries. Leave this off if PR titles or links may expose internal context."
              title="Show pull request links publicly"
            >
              <SettingsSwitch
                checked={settings.includePullRequestLinks}
                label="Show pull request links publicly"
                onCheckedChange={(checked) =>
                  setSettings((current) => ({
                    ...current,
                    includePullRequestLinks: checked,
                  }))
                }
              />
            </SettingsRow>
          </SettingsSection>

          <SettingsSection
            description="Choose when Cooee checks for merged pull requests and publishes approved updates."
            id="settings-schedule"
            title="Publishing schedule"
          >
            <SettingsRow
              description="Pick the cadence that matches how often your users expect product news."
              title="Schedule frequency"
            >
              <SelectField
                label="Schedule frequency"
                labelClassName="sr-only"
                onValueChange={(scheduleFrequency) =>
                  setSettings((current) => ({
                    ...current,
                    scheduleFrequency:
                      scheduleFrequency as SettingsState["scheduleFrequency"],
                  }))
                }
                options={scheduleFrequencyOptions}
                value={settings.scheduleFrequency}
              />
            </SettingsRow>

            {settings.scheduleFrequency === "weekly" ? (
              <SettingsRow
                description="Choose which day of the week Cooee runs."
                title="Run day"
              >
                <SelectField
                  label="Run day"
                  labelClassName="sr-only"
                  onValueChange={(scheduleWeekday) =>
                    setSettings((current) => ({
                      ...current,
                      scheduleWeekday: Number(scheduleWeekday),
                    }))
                  }
                  options={scheduleWeekdayOptions}
                  value={String(settings.scheduleWeekday)}
                />
              </SettingsRow>
            ) : null}

            {settings.scheduleFrequency === "monthly" ? (
              <SettingsRow
                description="For shorter months, the run falls on the month's last day."
                title="Run day"
              >
                <SelectField
                  label="Run day"
                  labelClassName="sr-only"
                  onValueChange={(scheduleMonthDay) =>
                    setSettings((current) => ({
                      ...current,
                      scheduleMonthDay: Number(scheduleMonthDay),
                    }))
                  }
                  options={scheduleMonthDayOptions}
                  value={String(settings.scheduleMonthDay)}
                />
              </SettingsRow>
            ) : null}

            {settings.scheduleFrequency !== "on-merge" ? (
              <SettingsRow
                description="Cooee waits until this local time before publishing a due update."
                htmlFor="settings-publish-time"
                title="Run time"
              >
                <TimePickerInput
                  id="settings-publish-time"
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      publishTime: event.target.value,
                    }))
                  }
                  value={settings.publishTime}
                />
              </SettingsRow>
            ) : null}

            <SettingsRow
              description="Used for scheduled run times and grouping updates by date."
              title="Timezone"
            >
              <SelectField
                label="Timezone"
                labelClassName="sr-only"
                onValueChange={(timeZone) =>
                  setSettings((current) => ({
                    ...current,
                    timeZone,
                  }))
                }
                options={timeZoneOptions}
                value={settings.timeZone}
              />
            </SettingsRow>
          </SettingsSection>

          <SettingsSection
            description="Tune how Cooee writes draft changelog entries before review."
            id="settings-ai"
            title="AI configuration"
          >
            <SettingsRow
              description="Choose how product-focused or technical the generated copy should sound."
              title="Writing style"
            >
              <SelectField
                label="Writing style"
                labelClassName="sr-only"
                onValueChange={(value) => {
                  const aiPersonality = value as SettingsState["aiPersonality"];

                  setSettings((current) => ({
                    ...current,
                    aiAudience:
                      aiPersonality === "technical"
                        ? "technical-users"
                        : "product-users",
                    aiPersonality,
                  }));
                }}
                options={aiPersonalityOptions}
                value={settings.aiPersonality}
              />
            </SettingsRow>

            <SettingsRow
              description="Higher confidence means Cooee holds more drafts for review instead of publishing automatically."
              title="Review threshold"
            >
              <SelectField
                label="Review threshold"
                labelClassName="sr-only"
                onValueChange={(aiMinimumConfidence) =>
                  setSettings((current) => ({
                    ...current,
                    aiMinimumConfidence,
                  }))
                }
                options={aiMinimumConfidenceOptions}
                triggerClassName="font-mono"
                value={settings.aiMinimumConfidence}
              />
            </SettingsRow>

            <SettingsRow
              description="Tell the writer who will read the changelog."
              title="Reader"
            >
              <SelectField
                label="Reader"
                labelClassName="sr-only"
                onValueChange={(aiAudience) =>
                  setSettings((current) => ({
                    ...current,
                    aiAudience: aiAudience as SettingsState["aiAudience"],
                  }))
                }
                options={aiAudienceOptions}
                value={settings.aiAudience}
              />
            </SettingsRow>

            <SettingsRow
              description="Generate a public image for Post-style updates when image generation is configured."
              title="Create images for Post updates"
            >
              <SettingsSwitch
                checked={settings.createImagesPerUpdate}
                label="Create images for Post updates"
                onCheckedChange={(checked) =>
                  setSettings((current) => ({
                    ...current,
                    createImagesPerUpdate: checked,
                  }))
                }
              />
            </SettingsRow>

            <SettingsRow
              description="Recommended. Sensitive, invalid, or low-confidence drafts stay private until you review them."
              title="Hold uncertain drafts for review"
            >
              <SettingsSwitch
                checked={settings.aiFailClosed}
                label="Hold uncertain drafts for review"
                onCheckedChange={(checked) =>
                  setSettings((current) => ({
                    ...current,
                    aiFailClosed: checked,
                  }))
                }
              />
            </SettingsRow>
          </SettingsSection>

          <SettingsSection
            description="Use your own subdomain after the default public URL is working."
            id="settings-domain"
            title="Custom domain"
          >
            <SettingsRow
              description="Use a subdomain you own, like changelog.example.com. Apex domains like example.com are not supported."
              htmlFor="custom-domain"
              title="Domain"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  className="min-w-0 flex-1 font-mono"
                  id="custom-domain"
                  onChange={(event) =>
                    setSettings(
                      (current) => ({
                        ...current,
                        customDomain: event.target.value,
                      }),
                      { autosave: false },
                    )
                  }
                  placeholder="changelog.example.com"
                  value={settings.customDomain}
                />
                <Button
                  className="w-full sm:w-auto"
                  disabled={customDomainActionInFlight}
                  onClick={onSaveCustomDomain}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {customDomainActionStatus === "saving" ? "Saving" : "Save"}
                </Button>
              </div>
            </SettingsRow>

            <SettingsRow
              description="After saving the domain, create this CNAME record at your DNS host, then refresh the status."
              title="DNS setup"
            >
              <div className="grid gap-3">
                <div className="flex min-w-0 flex-col gap-2 xl:flex-row xl:items-center">
                  <span className="text-sm font-normal leading-6 text-muted-foreground xl:shrink-0">
                    CNAME
                  </span>
                  <code className="block min-w-0 flex-1 break-all rounded-xl border border-border/70 bg-background px-3 py-2 font-mono text-sm leading-6 text-foreground">
                    {cnameTarget}
                  </code>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button
                      className="sm:w-auto"
                      onClick={copyCnameTarget}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <ClipboardCopyIcon data-icon="inline-start" />
                      Copy
                    </Button>
                    <Button
                      className="sm:w-auto"
                      disabled={
                        customDomainActionInFlight ||
                        !settings.customDomain.trim()
                      }
                      onClick={onRefreshCustomDomainStatus}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <RefreshCwIcon data-icon="inline-start" />
                      {customDomainActionStatus === "checking"
                        ? "Checking"
                        : "Refresh"}
                    </Button>
                  </div>
                </div>
                <dl className="flex flex-wrap gap-2">
                  <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3 py-1.5">
                    <dt className={settingsFieldLabelClassName}>Domain</dt>
                    <dd className="text-sm font-medium">{domainStatusLabel}</dd>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/70 px-3 py-1.5">
                    <dt className={settingsFieldLabelClassName}>SSL</dt>
                    <dd className="text-sm font-medium">{sslStatusLabel}</dd>
                  </div>
                </dl>
              </div>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection
            description="Decide how each category should appear on the public changelog."
            id="settings-categories"
            title="Categories"
          >
            <SettingsRow
              description="Show grouped category headings, such as Fixes or Improvements, within each changelog date."
              title="Group category sections"
            >
              <SettingsSwitch
                checked={settings.groupEntriesByCategory}
                label="Group category sections"
                onCheckedChange={(checked) =>
                  setSettings((current) => ({
                    ...current,
                    groupEntriesByCategory: checked,
                  }))
                }
              />
            </SettingsRow>

            <SettingsRow
              description="Post is best for major features, Callout for short improvements, and Text for simple fixes."
              title="Category display"
            >
              <div className="grid gap-3">
                <div className="flex justify-start">
                  <Button
                    onClick={addCategoryDefinition}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Add category
                  </Button>
                </div>
                <div className="grid gap-3">
                  {categoryDefinitions.map((category, index) => (
                    <div
                      className="grid gap-3 rounded-2xl border border-border/70 bg-muted/25 p-4"
                      key={`${category.id}-${index}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-balance text-sm font-medium leading-6 text-foreground">
                            {category.label || "Untitled category"}
                          </div>
                          <p className="text-balance text-xs leading-5 text-muted-foreground">
                            {formatCategoryDisplayTypeBadge(
                              category.displayType,
                            )}
                          </p>
                        </div>
                        <Button
                          aria-label={`Remove ${category.label}`}
                          disabled={categoryDefinitions.length <= 1}
                          onClick={() => removeCategoryDefinition(index)}
                          size="icon-sm"
                          type="button"
                          variant="outline"
                        >
                          <XIcon aria-hidden />
                        </Button>
                      </div>

                      <label className="grid gap-1.5">
                        <span className={settingsFieldLabelClassName}>
                          Category
                        </span>
                        <Input
                          onChange={(event) =>
                            updateCategoryDefinition(index, {
                              label: event.target.value,
                            })
                          }
                          value={category.label}
                        />
                      </label>
                      <SelectField
                        className="grid gap-1.5"
                        label="Display type"
                        labelClassName={settingsFieldLabelClassName}
                        onValueChange={(displayType) =>
                          updateCategoryDefinition(index, {
                            displayType: displayType as ChangelogDisplayType,
                          })
                        }
                        options={changelogDisplayTypeOptions}
                        value={category.displayType}
                      />
                      {category.displayType === "post" ? (
                        <label className="flex min-h-10 items-center justify-between gap-3 rounded-xl bg-background/70 px-3 py-2">
                          <span>
                            <span className={settingsFieldLabelClassName}>
                              Marketing post
                            </span>
                            <span className="mt-0.5 block text-balance text-xs leading-5 text-muted-foreground">
                              Write fuller, benefit-led copy.
                            </span>
                          </span>
                          <Switch
                            aria-label={`Use marketing copy for ${category.label}`}
                            checked={category.marketingCopy === true}
                            onCheckedChange={(checked) =>
                              updateCategoryDefinition(index, {
                                marketingCopy: checked,
                              })
                            }
                          />
                        </label>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection
            description="Tell Cooee which pull requests should stay private or be held for review."
            id="settings-privacy"
            title="Privacy"
          >
            <SettingsRow
              description="One label per line. Pull requests with these labels are held or skipped before anything is published."
              htmlFor="settings-privacy-labels"
              title="Privacy labels"
            >
              <Textarea
                className="min-h-28 resize-y font-mono leading-6"
                id="settings-privacy-labels"
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    privacyLabels: event.target.value,
                  }))
                }
                value={settings.privacyLabels}
              />
            </SettingsRow>
          </SettingsSection>
        </div>
      </div>
    </section>
  );
}

function SettingsSwitch({
  checked,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex justify-start lg:justify-end">
      <Switch
        aria-label={label}
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

function SettingsSection({
  children,
  description,
  id,
  title,
}: {
  children: ReactNode;
  description: string;
  id: string;
  title: string;
}) {
  return (
    <section className="scroll-mt-24" id={id}>
      <div className="grid gap-4 2xl:grid-cols-[minmax(10rem,14rem)_minmax(0,1fr)]">
        <div className="min-w-0">
          <h3 className="text-balance text-base font-semibold tracking-normal text-foreground">
            {title}
          </h3>
          <p className="mt-1 text-balance text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
        <div className="min-w-0 divide-y divide-border/70 overflow-hidden rounded-[1.5rem] border border-border/70 bg-card/70">
          {children}
        </div>
      </div>
    </section>
  );
}

function SettingsRow({
  children,
  description,
  htmlFor,
  title,
}: {
  children: ReactNode;
  description: string;
  htmlFor?: string;
  title: string;
}) {
  const titleClassName =
    "text-balance text-sm font-medium leading-6 text-foreground";

  return (
    <div className="grid gap-4 p-5 sm:p-6 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] lg:items-start">
      <div className="min-w-0">
        {htmlFor ? (
          <label className={titleClassName} htmlFor={htmlFor}>
            {title}
          </label>
        ) : (
          <div className={titleClassName}>{title}</div>
        )}
        <p className="mt-1 text-balance text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function PublishedEntriesList({
  categoryDefinitions,
  dateFrom,
  dateTo,
  entries,
  isLoading,
  onBulkDeleteEntries,
  onClearFilters,
  onDeleteEntry,
  onDateRangeChange,
  onEditEntry,
  onMergeEntries,
  onOpenHeldEntryReview,
  onMarkEntryNotRelevant,
  onRegenerateHeldEntry,
  onRegenerateEntry,
  onPageChange,
  onPageSizeChange,
  onSearchChange,
  onToggleAllEntriesSelected,
  onToggleEntrySelected,
  page,
  pageSize,
  regeneratingHeldEntryIds,
  regeneratingEntryIds,
  search,
  selectedEntryKeys,
  total,
  totalPages,
  publicTheme,
}: {
  categoryDefinitions: ChangelogCategoryDefinition[];
  dateFrom: string;
  dateTo: string;
  entries: PublishedEntry[];
  isLoading: boolean;
  onBulkDeleteEntries: () => void;
  onClearFilters: () => void;
  onDeleteEntry: (entry: PublishedEntry) => void;
  onDateRangeChange: (range: { from: string; to: string }) => void;
  onEditEntry: (entry: PublishedEntry) => void;
  onMergeEntries: () => void;
  onOpenHeldEntryReview: (entry: HeldEntry) => void;
  onMarkEntryNotRelevant: (entry: PublishedEntry) => void;
  onRegenerateHeldEntry: (entry: HeldEntry) => void;
  onRegenerateEntry: (entry: PublishedEntry) => void;
  onPageChange: Dispatch<SetStateAction<number>>;
  onPageSizeChange: (pageSize: number) => void;
  onSearchChange: (query: string) => void;
  onToggleAllEntriesSelected: () => void;
  onToggleEntrySelected: (entry: PublishedEntry) => void;
  page: number;
  pageSize: number;
  regeneratingHeldEntryIds: Set<string>;
  regeneratingEntryIds: Set<string>;
  search: string;
  selectedEntryKeys: Set<string>;
  total: number;
  totalPages: number;
  publicTheme: ThemeMode;
}) {
  const selectableEntries = entries.filter(
    (entry) => !isHeldPublishedEntry(entry),
  );
  const selectedCount = selectableEntries.filter((entry) =>
    selectedEntryKeys.has(getPublishedEntryKey(entry)),
  ).length;
  const allSelected =
    selectableEntries.length > 0 && selectedCount === selectableEntries.length;
  const firstVisiblePost = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastVisiblePost = Math.min(page * pageSize, total);
  const hasFilters = Boolean(search || dateFrom || dateTo);
  const selectedDateRange = toDateRange(dateFrom, dateTo);
  const [isDateRangeOpen, setIsDateRangeOpen] = useState(false);
  const [draftDateRange, setDraftDateRange] = useState<DateRange | undefined>(
    selectedDateRange,
  );

  useEffect(() => {
    setDraftDateRange(toDateRange(dateFrom, dateTo));
  }, [dateFrom, dateTo]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_16rem_auto] lg:items-end">
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">Search posts</span>
          <span className="relative">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              className="pl-9"
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Title or summary"
              value={search}
            />
          </span>
        </label>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Date range</span>
          <Popover open={isDateRangeOpen} onOpenChange={setIsDateRangeOpen}>
            <PopoverTrigger
              render={
                <Button
                  className={cn(
                    "justify-start overflow-hidden border-border bg-background text-left font-normal",
                    !selectedDateRange && "text-muted-foreground",
                  )}
                  size="sm"
                  type="button"
                  variant="outline"
                />
              }
            >
              <CalendarIcon data-icon="inline-start" aria-hidden />
              <span className="truncate">
                {formatDateRangeLabel(selectedDateRange)}
              </span>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-0">
              <Calendar
                mode="range"
                numberOfMonths={2}
                onSelect={setDraftDateRange}
                selected={draftDateRange}
              />
              <div className="flex items-center justify-end gap-2 border-t p-2">
                <Button
                  onClick={() => setDraftDateRange(undefined)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Clear dates
                </Button>
                <Button
                  onClick={() => {
                    onDateRangeChange({
                      from: formatDateFilterValue(draftDateRange?.from),
                      to: formatDateFilterValue(
                        draftDateRange?.to ?? draftDateRange?.from,
                      ),
                    });
                    setIsDateRangeOpen(false);
                  }}
                  size="sm"
                  type="button"
                >
                  Apply
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <Button
          disabled={!hasFilters}
          onClick={onClearFilters}
          size="sm"
          type="button"
          variant="outline"
        >
          <XIcon data-icon="inline-start" aria-hidden />
          Clear
        </Button>
      </div>

      <div className="flex flex-col gap-3 border-y py-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox
            aria-label="Select all posts on this page"
            checked={allSelected}
            disabled={selectableEntries.length === 0}
            onCheckedChange={() => onToggleAllEntriesSelected()}
          />
          Select all posts on page
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {formatCount(selectedCount, "selected post")}
          </span>
          <Button
            disabled={selectedCount < 2}
            onClick={onMergeEntries}
            size="sm"
            type="button"
            variant="outline"
          >
            <SparklesIcon data-icon="inline-start" aria-hidden />
            Merge with AI
          </Button>
          <Button
            disabled={selectedCount === 0}
            onClick={onBulkDeleteEntries}
            size="sm"
            type="button"
            variant="outline"
          >
            <Trash2Icon data-icon="inline-start" aria-hidden />
            Bulk delete
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto scrollbar-thin rounded-[1.5rem] border border-border/70 bg-card/60">
        <Table className="w-full min-w-[58rem] table-fixed border-collapse text-sm">
          <TableHeader className="bg-muted/50 text-left text-xs font-semibold uppercase text-muted-foreground">
            <TableRow>
              <TableHead className="w-12 px-4 py-3">Select</TableHead>
              <TableHead className="w-32 px-4 py-3">Date</TableHead>
              <TableHead className="px-4 py-3">Post</TableHead>
              <TableHead className="w-36 px-4 py-3">Category</TableHead>
              <TableHead className="w-72 px-4 py-3 text-right">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y">
            {entries.map((entry) => {
              const key = getPublishedEntryKey(entry);
              const heldEntry = isHeldPublishedEntry(entry)
                ? toHeldEntryFromPublishedEntry(entry)
                : null;
              const heldDraftPreview = heldEntry
                ? getHeldEntryDraftPreview(entry)
                : null;
              const isRegenerating = isPersistedPublishedEntry(entry)
                ? regeneratingEntryIds.has(entry.id)
                : false;
              const isRegeneratingHeld = heldEntry
                ? regeneratingHeldEntryIds.has(heldEntry.id)
                : false;

              return (
                <TableRow
                  className={cn("align-top", heldEntry && "bg-muted/20")}
                  key={key}
                >
                  <TableCell className="px-4 py-4">
                    <Checkbox
                      aria-label={
                        heldEntry
                          ? `${entry.title} is held for review`
                          : `Select ${entry.title}`
                      }
                      checked={!heldEntry && selectedEntryKeys.has(key)}
                      disabled={Boolean(heldEntry)}
                      onCheckedChange={() => {
                        if (!heldEntry) {
                          onToggleEntrySelected(entry);
                        }
                      }}
                    />
                  </TableCell>
                  <TableCell className="px-4 py-4 font-mono text-xs text-muted-foreground">
                    {entry.time}
                  </TableCell>
                  <TableCell className="px-4 py-4">
                    {heldEntry ? (
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-balance text-sm font-semibold tracking-normal">
                            {entry.title}
                          </h2>
                          <Badge variant="destructive">
                            Draft held for review
                          </Badge>
                        </div>
                        <p className="mt-1 text-balance text-sm leading-6 text-muted-foreground">
                          Review the source PR and draft before publishing.
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Badge variant="outline">
                            {heldEntry.reason.title}
                          </Badge>
                          {heldEntry.sourcePullRequests.map((pullRequest) => (
                            <a
                              className={cn(
                                buttonVariants({
                                  size: "sm",
                                  variant: "outline",
                                }),
                                "h-7 rounded-md px-2 text-xs",
                              )}
                              href={pullRequest.url}
                              key={`${key}:review:${pullRequest.number}:${pullRequest.url}`}
                              rel="noreferrer"
                              target="_blank"
                            >
                              <ExternalLinkIcon
                                data-icon="inline-start"
                                aria-hidden
                              />
                              Review PR #{pullRequest.number}
                            </a>
                          ))}
                        </div>
                        {heldDraftPreview ? (
                          <div className="mt-3 rounded-md border bg-background p-3">
                            <div className="text-xs font-medium uppercase text-muted-foreground">
                              Draft copy
                            </div>
                            <MarkdownSummary
                              className="mt-1 line-clamp-3 text-sm leading-6 text-muted-foreground"
                              markdown={heldDraftPreview}
                            />
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <>
                        <h2 className="text-balance text-sm font-semibold tracking-normal">
                          {entry.title}
                        </h2>
                        <MarkdownSummary
                          className="mt-1 line-clamp-3 text-sm leading-6 text-muted-foreground"
                          markdown={entry.summary}
                        />
                        {entry.items && entry.items.length > 0 ? (
                          <div className="mt-3 grid gap-2">
                            {entry.items.map((item) => (
                              <section
                                className="border-l pl-3"
                                key={`${key}:${item.category}:${item.title}`}
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <h3 className="text-sm font-medium tracking-normal">
                                    {item.title}
                                  </h3>
                                  <Badge variant="outline">
                                    {item.category}
                                  </Badge>
                                </div>
                                <MarkdownSummary
                                  className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground"
                                  markdown={item.summary}
                                />
                              </section>
                            ))}
                          </div>
                        ) : null}
                      </>
                    )}
                  </TableCell>
                  <TableCell className="px-4 py-4">
                    <div className="grid gap-2">
                      <PublicChangelogCategoryBadge
                        category={entry.category}
                        categoryDefinitions={categoryDefinitions}
                        publicTheme={publicTheme}
                      />
                      {heldEntry ? (
                        <Badge className="w-fit" variant="secondary">
                          Not published
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-4">
                    {heldEntry ? (
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          onClick={() => onOpenHeldEntryReview(heldEntry)}
                          size="sm"
                          type="button"
                        >
                          <PencilIcon data-icon="inline-start" aria-hidden />
                          Review draft
                        </Button>
                        <Button
                          disabled={isRegeneratingHeld}
                          onClick={() => onRegenerateHeldEntry(heldEntry)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          {isRegeneratingHeld ? (
                            <LoaderCircleIcon
                              className="animate-spin"
                              data-icon="inline-start"
                              aria-hidden
                            />
                          ) : (
                            <RefreshCwIcon
                              data-icon="inline-start"
                              aria-hidden
                            />
                          )}
                          {isRegeneratingHeld ? "Regenerating" : "Regenerate"}
                        </Button>
                        <Button
                          onClick={() => onDeleteEntry(entry)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          <Trash2Icon data-icon="inline-start" aria-hidden />
                          Delete
                        </Button>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-2">
                        <Button
                          aria-label={`Edit ${entry.title}`}
                          className="size-8"
                          onClick={() => onEditEntry(entry)}
                          size="sm"
                          title="Edit post"
                          type="button"
                          variant="outline"
                        >
                          <PencilIcon aria-hidden />
                        </Button>
                        <Button
                          aria-label={`Rewrite ${entry.title}`}
                          className="size-8"
                          disabled={isRegenerating}
                          onClick={() => onRegenerateEntry(entry)}
                          size="sm"
                          title="Rewrite post"
                          type="button"
                          variant="outline"
                        >
                          {isRegenerating ? (
                            <LoaderCircleIcon
                              className="animate-spin"
                              aria-hidden
                            />
                          ) : (
                            <SparklesIcon aria-hidden />
                          )}
                        </Button>
                        <Button
                          aria-label={`Dismiss ${entry.title}`}
                          className="size-8"
                          onClick={() => onMarkEntryNotRelevant(entry)}
                          size="sm"
                          title="Dismiss post"
                          type="button"
                          variant="outline"
                        >
                          <XIcon aria-hidden />
                        </Button>
                        <Button
                          aria-label={`Delete ${entry.title}`}
                          className="size-8"
                          onClick={() => onDeleteEntry(entry)}
                          size="sm"
                          title="Delete post"
                          type="button"
                          variant="outline"
                        >
                          <Trash2Icon aria-hidden />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {entries.length === 0 ? (
              <TableRow>
                <TableCell
                  className="px-4 py-10 text-center text-sm text-muted-foreground"
                  colSpan={5}
                >
                  {isLoading
                    ? "Loading changelog posts"
                    : "No changelog posts found"}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>
          Showing {firstVisiblePost}-{lastVisiblePost} of{" "}
          {formatCount(total, "post")}
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            <span>Posts per page</span>
            <Select
              items={publishedEntriesPageSizeOptions.map((size) => ({
                label: String(size),
                value: String(size),
              }))}
              modal={false}
              onValueChange={(value) => {
                if (typeof value === "string") {
                  onPageSizeChange(Number(value));
                }
              }}
              value={String(pageSize)}
            >
              <SelectTrigger aria-label="Posts per page" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end" alignItemWithTrigger={false}>
                <SelectGroup>
                  {publishedEntriesPageSizeOptions.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </label>
          <Button
            aria-label="Previous page"
            className="size-8"
            disabled={page <= 1 || isLoading}
            onClick={() => onPageChange((current) => Math.max(1, current - 1))}
            size="sm"
            type="button"
            variant="outline"
          >
            <ChevronLeftIcon aria-hidden />
          </Button>
          <span className="min-w-24 text-center">
            Page {page} of {totalPages}
          </span>
          <Button
            aria-label="Next page"
            className="size-8"
            disabled={page >= totalPages || isLoading}
            onClick={() =>
              onPageChange((current) => Math.min(totalPages, current + 1))
            }
            size="sm"
            type="button"
            variant="outline"
          >
            <ChevronRightIcon aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}
function MarkdownSummary({
  className,
  markdown,
}: {
  className: string;
  markdown: string;
}) {
  return (
    <div
      className={`markdown-summary ${className}`}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
    />
  );
}

function RepositoryRow({
  changelogSlug,
  description,
  label,
  name,
  onSelectRepository,
  onShowGitHubRepositoryChange,
  selected,
  showGitHubRepository,
}: {
  changelogSlug?: string | null;
  description: string;
  label: string;
  name: string;
  onSelectRepository?: () => void;
  onShowGitHubRepositoryChange?: (checked: boolean) => void;
  selected?: boolean;
  showGitHubRepository?: boolean;
}) {
  return (
    <div
      className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
      data-repository-row
    >
      <div>
        <div className="text-balance font-mono text-sm font-medium">{name}</div>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
        {selected && changelogSlug ? (
          <p className="mt-1 font-mono text-xs leading-5 text-muted-foreground">
            Changelog {changelogSlug}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {selected ? <Badge>Selected</Badge> : null}
        {!selected && onSelectRepository ? (
          <Button
            onClick={onSelectRepository}
            size="sm"
            type="button"
            variant="outline"
          >
            Use repo
          </Button>
        ) : null}
        {onShowGitHubRepositoryChange ? (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={showGitHubRepository}
              onCheckedChange={(checked) =>
                onShowGitHubRepositoryChange(checked)
              }
            />
            <span>Show GitHub repo</span>
          </label>
        ) : null}
        <Badge variant="secondary">{label}</Badge>
      </div>
    </div>
  );
}

function formatCount(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function orderRepositoriesForDisplay(
  repositories: GitHubConnectionRepository[],
): GitHubConnectionRepository[] {
  return [...repositories].sort((left, right) => {
    if (left.selected !== right.selected) {
      return left.selected ? -1 : 1;
    }

    return left.fullName.localeCompare(right.fullName);
  });
}

function getDefaultActiveRepositoryId(
  repositories: ReadonlyArray<{
    id: string;
    selected: boolean;
    changelogSlug?: string | null;
  }>,
): string | null {
  return (
    repositories.find(isConnectedChangelogRepository)?.id ??
    repositories.find((repository) => repository.changelogSlug)?.id ??
    repositories[0]?.id ??
    null
  );
}

export function getInitialActiveRepositoryId(
  repositories: ReadonlyArray<{
    id: string;
    selected: boolean;
    changelogSlug?: string | null;
  }>,
): string | null {
  return (
    getStoredActiveRepositoryId(repositories) ??
    getDefaultActiveRepositoryId(repositories)
  );
}

export function getAdminRepositoriesFromConnection(
  connection: Pick<GitHubConnectionState, "repositories">,
): GitHubConnectionRepository[] {
  return connection.repositories;
}

function isConnectedChangelogRepository(repository: {
  selected: boolean;
  changelogSlug?: string | null;
}): boolean {
  return repository.selected && Boolean(repository.changelogSlug);
}

function filterRepositories(
  repositories: GitHubConnectionRepository[],
  search: string,
): GitHubConnectionRepository[] {
  const query = search.trim().toLowerCase();
  if (!query) {
    return repositories;
  }

  return repositories.filter((repository) =>
    [
      repository.fullName,
      repository.name,
      repository.owner,
      repository.accountLogin,
    ]
      .filter(Boolean)
      .some((value) => value?.toLowerCase().includes(query)),
  );
}

function getPublishedEntryKey(entry: PublishedEntry): string {
  return entry.id ?? `${entry.time}:${entry.title}`;
}

function isHeldPublishedEntry(entry: PublishedEntry): boolean {
  return entry.status === "held";
}

function toHeldEntryFromPublishedEntry(entry: PublishedEntry): HeldEntry {
  const sourcePullRequests = entry.sourcePullRequests ?? [];

  return {
    id: entry.id ?? getPublishedEntryKey(entry),
    title: entry.title,
    reason: formatHoldReasonDetails(entry.holdReason),
    source: getHeldEntrySource(sourcePullRequests, entry.id),
    copy: getHeldEntryDraftCopy(entry.summary),
    category: entry.category,
    processedAt: entry.processedAt ?? null,
    windowEndedAt: entry.windowEndedAt ?? null,
    sourcePullRequests,
  };
}

function getHeldEntrySource(
  sourcePullRequests: HeldEntry["sourcePullRequests"],
  fallbackId: string | undefined,
): string {
  return (
    sourcePullRequests
      .map((pullRequest) => `#${pullRequest.number}`)
      .join(", ") ||
    fallbackId ||
    "held-draft"
  );
}

function getHeldEntryDraftPreview(entry: PublishedEntry): string | null {
  const summary = getHeldEntryDraftCopy(entry.summary);
  if (!summary) {
    return null;
  }

  return summary;
}

function getHeldEntryDraftCopy(summary: string): string {
  const trimmed = summary.trim();
  return internalHeldDraftSummaries.has(trimmed) ? "" : trimmed;
}

const internalHeldDraftSummaries = new Set([
  "Draft held for review. Review the source PR and draft before publishing.",
  "Cooee generated a draft, but this pull request needs review before it can be published.",
  "Cooee generated a draft that needs review.",
  "This pull request matched privacy controls and needs review before publishing.",
  "One or more pull requests matched privacy controls and need review before publishing.",
]);

function replacePublishedEntry(
  entries: PublishedEntry[],
  targetKey: string,
  replacement: PublishedEntry,
): PublishedEntry[] {
  return entries.map((entry) =>
    getPublishedEntryKey(entry) === targetKey ? replacement : entry,
  );
}

function isPersistedPublishedEntry(
  entry: PublishedEntry,
): entry is PublishedEntry & { id: string } {
  return Boolean(
    entry.id &&
    !entry.id.startsWith("manual_") &&
    !entry.id.startsWith("held_"),
  );
}

function formatCategoryDisplayTypeBadge(
  displayType: ChangelogDisplayType,
): string {
  switch (displayType) {
    case "callout":
      return "Callout display";
    case "text":
      return "Text display";
    case "post":
    default:
      return "Post display";
  }
}

function toApiCategory(
  category: PublishedEntry["category"],
): ApiChangelogCategory {
  return normalizeChangelogCategoryId(category);
}

function toUiCategory(
  category: ApiChangelogCategory,
): PublishedEntry["category"] {
  return normalizeChangelogCategoryId(category) || "maintenance";
}

function toUiChangeItems(
  items: ApiChangelogEntry["items"],
): PublishedEntry["items"] {
  return items
    ? [...items]
        .sort((left, right) =>
          compareChangelogCategories(
            left.category,
            right.category,
            defaultChangelogCategoryDefinitions,
          ),
        )
        .map((item) => ({
          title: item.title,
          summary: item.summary,
          category: toUiCategory(item.category),
        }))
    : undefined;
}

function toPublishedEntry(entry: ApiChangelogEntry): PublishedEntry {
  return {
    id: entry.id,
    title: entry.title,
    summary: entry.summary,
    category: toUiCategory(entry.category),
    status: entry.status,
    holdReason: entry.holdReason ?? null,
    processedAt: entry.processedAt ?? null,
    windowEndedAt: entry.windowEndedAt ?? null,
    imageUrl: entry.imageUrl ?? null,
    items: toUiChangeItems(entry.items),
    publishedAt: entry.publishedAt,
    sourcePullRequests: entry.sourcePullRequests ?? [],
    time: formatPublishedEntryTime(entry.publishedAt ?? entry.windowEndedAt),
  };
}

function toHeldEntry(entry: ApiChangelogEntry): HeldEntry {
  const sourcePullRequests = entry.sourcePullRequests ?? [];

  return {
    id: entry.id,
    title: entry.title,
    reason: formatHoldReasonDetails(entry.holdReason),
    source: getHeldEntrySource(sourcePullRequests, entry.id),
    copy: getHeldEntryDraftCopy(entry.summary),
    category: toUiCategory(entry.category),
    processedAt: entry.processedAt ?? null,
    windowEndedAt: entry.windowEndedAt ?? null,
    sourcePullRequests,
  };
}

function formatHoldReasonDetails(
  value: string | null | undefined,
): HeldReasonDetails {
  if (!value) {
    return {
      title: "Held for review",
      detail:
        "Cooee paused this draft before publishing. Review the source PRs and draft copy before creating a post.",
      pullRequestReason: "Held for review",
    };
  }

  const [reason, detail] = value.split(":");
  if (reason === "skip-label" && detail) {
    return {
      title: "Skipped label",
      detail: `Matched the ${detail} label, which is configured to skip automatic changelog generation.`,
      pullRequestReason: `Matched ${detail}`,
    };
  }

  if (reason === "sensitive-label" && detail) {
    return {
      title: "Sensitive label",
      detail: `Matched the ${detail} label, which is configured as sensitive and requires review before publishing.`,
      pullRequestReason: `Matched ${detail}`,
    };
  }

  if (reason === "sensitive-content") {
    return {
      title: "Privacy-sensitive content",
      detail:
        "The PR title or body matched privacy or confidential-content controls, such as addresses, contact details, credentials, security wording, or other personally identifiable details.",
      pullRequestReason: "Privacy-sensitive content",
    };
  }

  if (reason === "sensitive-output") {
    return {
      title: "Sensitive generated draft",
      detail:
        "The AI-generated draft was marked sensitive or still contained privacy-sensitive details after generation.",
      pullRequestReason: "Sensitive generated draft",
    };
  }

  if (reason === "low-confidence") {
    return {
      title: "Low confidence",
      detail:
        "The AI confidence score was below the automatic publishing threshold, so Cooee held the draft for review instead of publishing it.",
      pullRequestReason: "Low confidence",
    };
  }

  if (reason === "openai-not-configured") {
    return {
      title: "OpenAI not configured",
      detail:
        "The local API is missing OPENAI_API_KEY, so Cooee created a placeholder held draft instead of generating customer-facing copy.",
      pullRequestReason: "OpenAI not configured",
    };
  }

  if (reason === "invalid-output") {
    return {
      title: "Invalid generated draft",
      detail:
        "The AI response did not match the changelog format Cooee expects, so it was held instead of published.",
      pullRequestReason: "Invalid generated draft",
    };
  }

  if (reason === "privacy-hold") {
    return {
      title: "Privacy hold",
      detail:
        "One or more source PRs matched privacy controls and need review before a public changelog post is created.",
      pullRequestReason: "Privacy hold",
    };
  }

  const title = value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");

  return {
    title,
    detail:
      "Cooee paused this draft before publishing. Review the source PRs and draft copy before creating a post.",
    pullRequestReason: title,
  };
}

function toDateRange(from: string, to: string): DateRange | undefined {
  const fromDate = parseDateFilterValue(from);
  const toDate = parseDateFilterValue(to);

  if (!fromDate && !toDate) {
    return undefined;
  }

  return { from: fromDate, to: toDate };
}

function getDefaultBackfillDateRange(): DateRange {
  const now = new Date();
  return { from: subDays(now, 1), to: now };
}

function parseDateFilterValue(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return undefined;
  }

  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function formatDateFilterValue(date: Date | undefined): string {
  return date ? format(date, "yyyy-MM-dd") : "";
}

function formatDateRangeLabel(range: DateRange | undefined): string {
  if (!range?.from) {
    return "Any date";
  }

  if (!range.to) {
    return format(range.from, "MMM d, yyyy");
  }

  return `${format(range.from, "MMM d, yyyy")} - ${format(range.to, "MMM d, yyyy")}`;
}

function formatPublishedEntryTime(
  publishedAt: string | null | undefined,
): string {
  if (!publishedAt) {
    return "Today";
  }

  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) {
    return "Today";
  }

  const today = new Date();
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();
  const startOfEntryDay = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
  const dayDelta = Math.round(
    (startOfToday - startOfEntryDay) / (24 * 60 * 60 * 1000),
  );

  if (dayDelta === 0) {
    return "Today";
  }

  if (dayDelta === 1) {
    return "Yesterday";
  }

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  }).format(date);
}

function formatActivityDate(value: string | null | undefined): string {
  if (!value) return "unavailable";

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "unavailable"
    : format(date, "MMM d, yyyy");
}

function normalizePublishedEntryDraftDate(
  value: string | null | undefined,
): string | null {
  const date = parsePublishedEntryDraftDate(value);
  return date ? date.toISOString() : null;
}

function getPublishedAtInputParts(value: string | null | undefined): {
  date: string;
  time: string;
} {
  const date = parsePublishedEntryDraftDate(value) ?? new Date();

  return {
    date: format(date, "yyyy-MM-dd"),
    time: format(date, "HH:mm"),
  };
}

function mergePublishedAtInput(
  dateValue: string,
  timeValue: string,
  fallbackValue: string | null | undefined,
): string {
  const fallbackDate =
    parsePublishedEntryDraftDate(fallbackValue) ?? new Date();
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  const timeMatch = /^(\d{2}):(\d{2})/.exec(timeValue);

  if (!dateMatch) {
    return fallbackDate.toISOString();
  }

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]) - 1;
  const day = Number(dateMatch[3]);
  const hour = timeMatch ? Number(timeMatch[1]) : fallbackDate.getHours();
  const minute = timeMatch ? Number(timeMatch[2]) : fallbackDate.getMinutes();

  if (hour > 23 || minute > 59) {
    return fallbackDate.toISOString();
  }

  const nextDate = new Date(year, month, day, hour, minute, 0, 0);
  if (
    Number.isNaN(nextDate.getTime()) ||
    nextDate.getFullYear() !== year ||
    nextDate.getMonth() !== month ||
    nextDate.getDate() !== day
  ) {
    return fallbackDate.toISOString();
  }

  return nextDate.toISOString();
}

function parsePublishedEntryDraftDate(
  value: string | null | undefined,
): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getOriginalPullRequestMergedAt(
  sourcePullRequests: NonNullable<PublishedEntry["sourcePullRequests"]>,
): string | null {
  const latest = sourcePullRequests
    .map((pullRequest) => parsePublishedEntryDraftDate(pullRequest.mergedAt))
    .filter((mergedAt): mergedAt is Date => Boolean(mergedAt))
    .sort((left, right) => right.getTime() - left.getTime())[0];

  return latest ? latest.toISOString() : null;
}

function formatOriginalPullRequestMergedAt(value: string): string {
  const date = parsePublishedEntryDraftDate(value);

  if (!date) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function clampOnboardingStep(step: number): number {
  if (!Number.isFinite(step)) {
    return 0;
  }

  return Math.min(Math.max(Math.trunc(step), 0), 3);
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(Math.max(Math.round(value), min), max);
}

function getInitialSurface(deploymentMode: DeploymentMode): SurfaceId {
  if (typeof window === "undefined") {
    return "app";
  }

  return getSurfaceFromPathname(
    window.location?.pathname ?? "/",
    isCustomChangelogRootLocation(window.location),
    deploymentMode,
  );
}

export function getSurfaceFromPathname(
  pathname: string,
  isCustomChangelogRoot = false,
  _deploymentMode: DeploymentMode = "admin",
): SurfaceId {
  if (pathname === "/login" || pathname === "/login/") {
    return "login";
  }

  if (getAppViewFromPathname(pathname)) {
    return "app";
  }

  if (getPublicChangelogSlugFromPathname(pathname) || isCustomChangelogRoot) {
    return "publicChangelog";
  }

  return pathname === "/" ? "app" : "notFound";
}

export function shouldShowAdminSessionLoadingPage({
  authSessionStatus,
  deploymentMode,
  surface,
}: {
  authSessionStatus: "loading" | "ready";
  deploymentMode: DeploymentMode;
  surface: SurfaceId;
}): boolean {
  return (
    deploymentMode === "admin" &&
    surface !== "login" &&
    authSessionStatus === "loading"
  );
}

function getCurrentPublicChangelogSlug(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return getPublicChangelogSlugFromPathname(window.location?.pathname ?? "");
}

export function getPublicChangelogPath(slug: string): string {
  return `/changelog/${encodeURIComponent(slug)}`;
}

export function getPublicChangelogUrl(
  path: string,
  settings: { customDomain?: string },
  publicSiteUrl?: string,
): string {
  const customDomain = settings.customDomain?.trim();
  return customDomain
    ? `https://${customDomain.replace(/^https?:\/\//, "").replace(/\/.*$/, "")}`
    : publicSiteUrl
      ? `${publicSiteUrl}${path}`
      : path;
}

function getDeploymentMode(): DeploymentMode {
  return "admin";
}

function getPublicSiteUrl(): string {
  return getConfiguredOrigin(
    import.meta.env.VITE_PUBLIC_SITE_URL,
    "https://cooee.sh",
  );
}

function getConfiguredOrigin(
  value: string | undefined,
  fallback: string,
): string {
  const candidate = value?.trim();
  if (!candidate) {
    return fallback;
  }

  try {
    const url = new URL(candidate);
    if (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname))
    ) {
      return url.origin;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

function normalizePublicChangelogPagination(
  pagination: ApiPublicChangelogFeed["pagination"],
): PublicChangelogPaginationState {
  const nextBefore =
    typeof pagination?.nextBefore === "string" &&
    pagination.nextBefore.trim().length > 0
      ? pagination.nextBefore
      : null;

  return {
    hasMore: Boolean(pagination?.hasMore && nextBefore),
    nextBefore,
  };
}

function mergePublicChangelogEntries(
  currentEntries: PublishedEntry[],
  nextEntries: PublishedEntry[],
): PublishedEntry[] {
  const seenKeys = new Set<string>();
  return [...currentEntries, ...nextEntries].filter((entry) => {
    const key = entry.id ?? `${entry.publishedAt ?? entry.time}:${entry.title}`;

    if (seenKeys.has(key)) {
      return false;
    }

    seenKeys.add(key);
    return true;
  });
}

export function getPublicChangelogFeedPath(
  slug: string | null,
  before?: string | null,
): string {
  const path = slug
    ? `/api/public/changelogs/${encodeURIComponent(slug)}/feed.json`
    : "/api/public/changelog/feed.json";

  return before ? `${path}?before=${encodeURIComponent(before)}` : path;
}

export function isCustomChangelogRootLocation(location: {
  hostname?: string;
  pathname?: string;
}): boolean {
  if (location.pathname !== "/") {
    return false;
  }

  const hostname = (location.hostname ?? "").toLowerCase();
  if (!hostname) {
    return false;
  }

  return !isCooeeFirstPartyHost(hostname);
}

function isCooeeFirstPartyHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    isIpAddressHost(hostname) ||
    hostname === "cooee.test" ||
    hostname === "cooee.up.railway.app" ||
    hostname === "cooee.sh" ||
    hostname.endsWith(".cooee.sh")
  );
}

function isIpAddressHost(hostname: string): boolean {
  return (
    /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(
      hostname,
    ) || hostname.includes(":")
  );
}

function formatCustomHostnameStatus(value: string, fallback: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return fallback;
  }

  if (normalized.startsWith("cname ")) {
    return "Needs CNAME";
  }

  return normalized
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

export function getPublicChangelogSlugFromPathname(
  pathname: string,
): string | null {
  const [, changelogSegment, slugSegment, extraSegment] = pathname.split("/");
  if (changelogSegment !== "changelog" || !slugSegment || extraSegment) {
    return null;
  }

  try {
    return decodeURIComponent(slugSegment);
  } catch {
    return null;
  }
}

function getInitialActiveView(): ViewId {
  if (typeof window === "undefined") {
    return "dashboard";
  }

  const routeView = getAppViewFromPathname(window.location?.pathname ?? "");
  if (routeView) {
    return routeView;
  }

  try {
    const storedView = window.localStorage.getItem(activeViewStorageKey);
    if (isAvailableViewId(storedView)) {
      return storedView;
    }
  } catch {
    // Ignore storage failures; the dashboard is still a valid fallback.
  }

  return "dashboard";
}

function getAppViewFromPathname(pathname: string): ViewId | null {
  const [, appSegment, viewSegment = "", extraSegment] = pathname.split("/");
  if (!["app", "changelog"].includes(appSegment) || extraSegment) {
    return null;
  }

  if (!viewSegment) {
    return "dashboard";
  }

  return isAvailableViewId(viewSegment) ? viewSegment : null;
}

function isAvailableViewId(value: string | null | undefined): value is ViewId {
  return availableViewIds.includes(value as ViewId);
}

function getAppViewPath(viewId: ViewId): string {
  return viewId === "dashboard" ? "/changelog" : `/changelog/${viewId}`;
}

function pushAppViewHistory(viewId: ViewId) {
  writeAppViewHistory(viewId, "push");
}

function replaceAppViewHistory(viewId: ViewId) {
  writeAppViewHistory(viewId, "replace");
}

function writeAppViewHistory(viewId: ViewId, mode: "push" | "replace") {
  if (typeof window === "undefined") {
    return;
  }

  const path = getAppViewPath(viewId);
  const state = { cooeeView: viewId };

  if (
    mode === "push" &&
    window.location?.pathname !== path &&
    window.history?.pushState
  ) {
    window.history.pushState(state, "", path);
    return;
  }

  if (window.history?.replaceState) {
    window.history.replaceState(state, "", path);
  }
}

function persistActiveView(viewId: ViewId) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(activeViewStorageKey, viewId);
  } catch {
    // Ignore storage failures; URL history still preserves the current view.
  }
}

function getStoredActiveRepositoryId(
  repositories: ReadonlyArray<{
    id: string;
    selected: boolean;
    changelogSlug?: string | null;
  }>,
): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const repositoryId = window.localStorage.getItem(
      activeRepositoryStorageKey,
    );
    const repository = repositories.find((item) => item.id === repositoryId);
    return repository && isConnectedChangelogRepository(repository)
      ? repository.id
      : null;
  } catch {
    return null;
  }
}

function persistActiveRepositoryId(repositoryId: string | null) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (repositoryId) {
      window.localStorage.setItem(activeRepositoryStorageKey, repositoryId);
      return;
    }

    window.localStorage.removeItem(activeRepositoryStorageKey);
  } catch {
    // Ignore storage failures; the first connected repository remains usable.
  }
}

function getStoredActiveRepositoryDisplayName(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const displayName = window.localStorage.getItem(
      activeRepositoryDisplayNameStorageKey,
    );
    return displayName?.trim() || null;
  } catch {
    return null;
  }
}

function persistActiveRepositoryDisplayName(displayName: string | null) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (displayName) {
      window.localStorage.setItem(
        activeRepositoryDisplayNameStorageKey,
        displayName,
      );
      return;
    }

    window.localStorage.removeItem(activeRepositoryDisplayNameStorageKey);
  } catch {
    // Ignore storage failures; the repository id still preserves selection.
  }
}

function getHistoryStateView(state: unknown): ViewId | null {
  if (!state || typeof state !== "object" || !("cooeeView" in state)) {
    return null;
  }

  const viewId = state.cooeeView;
  return typeof viewId === "string" && isAvailableViewId(viewId)
    ? viewId
    : null;
}

function getInitialOnboardingOpen(showOnboarding: boolean): boolean {
  if (!showOnboarding) {
    return false;
  }

  return !getStoredOnboardingCompleted();
}

function getStoredOnboardingCompleted(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return (
      window.localStorage.getItem(onboardingCompletedStorageKey) === "true"
    );
  } catch {
    return false;
  }
}

function markOnboardingCompleted() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(onboardingCompletedStorageKey, "true");
  } catch {
    // Ignore storage failures; closing should still work in private/locked-down browsers.
  }
}

async function persistOnboardingCompleted() {
  try {
    await fetch("/api/admin/onboarding/complete", {
      method: "POST",
    });
  } catch {
    // Local storage still prevents the current browser from reopening the wizard.
  }
}

export function shouldShowOnboardingAfterSettingsLoaded({
  localCompleted,
  settingsCompleted,
  showOnboarding,
}: {
  localCompleted: boolean;
  settingsCompleted: boolean;
  showOnboarding: boolean;
}): boolean {
  return showOnboarding && !localCompleted && !settingsCompleted;
}

export function buildPublicChangelogPreview({
  appName,
  categoryDefinitions,
  description,
  entries,
  faviconUrl,
  groupEntriesByCategory = true,
  lightLogoDataUrl,
  logoDataUrl,
  publicTheme = "light",
  publicLogoAlignment = "left",
  publicAppLabel = defaultPublicAppLabel,
  publicAppUrl,
  publicUrl,
  visibleRepositories: _visibleRepositories,
}: {
  appName: string;
  categoryDefinitions?: ChangelogCategoryDefinition[];
  description?: string | null;
  entries: PublishedEntry[];
  faviconUrl?: string | null;
  groupEntriesByCategory?: boolean;
  lightLogoDataUrl?: string | null;
  logoDataUrl: string | null;
  publicTheme?: ThemeMode;
  publicLogoAlignment?: PublicLogoAlignment;
  publicAppLabel?: string;
  publicAppUrl: string;
  publicUrl?: string | null;
  slug: string;
  timeZone: string;
  visibleRepositories: PublicPreviewRepository[];
}) {
  const resolvedCategoryDefinitions =
    normalizeChangelogCategoryDefinitions(categoryDefinitions);
  const currentPublicTheme = normalizeThemeMode(publicTheme);
  const nextPublicTheme = currentPublicTheme === "dark" ? "light" : "dark";
  const publicThemeToggleLabel = `Switch to ${nextPublicTheme} mode`;
  const pageBackground = currentPublicTheme === "dark" ? "#1c1917" : "#fafaf9";
  const pageTextColor = currentPublicTheme === "dark" ? "#fafaf9" : "#1c1917";
  const escapedAppName = escapeHtml(appName.trim() || "Cooee");
  const escapedSeoTitle = escapeHtml(getPublicChangelogSeoTitle(appName));
  const escapedSeoDescription = escapeHtml(
    getPublicChangelogSeoDescription(appName, description),
  );
  const canonicalUrl = normalizePublicChangelogSeoUrl(publicUrl);
  const socialImageUrl = getCooeeSocialImageUrl(canonicalUrl);
  const canonicalMarkup = canonicalUrl
    ? `<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`
    : "";
  const faviconMarkup = faviconUrl
    ? `<link rel="icon" href="${escapeHtml(faviconUrl)}" />`
    : "";
  const openGraphUrlMarkup = canonicalUrl
    ? `<meta property="og:url" content="${escapeHtml(canonicalUrl)}" />`
    : "";
  const socialImageMarkup = socialImageUrl
    ? `<meta property="og:image" content="${escapeHtml(socialImageUrl)}" />
        <meta property="og:image:type" content="image/png" />
        <meta property="og:image:width" content="512" />
        <meta property="og:image:height" content="512" />
        <meta property="og:image:alt" content="Cooee logo" />
        <meta name="twitter:image" content="${escapeHtml(socialImageUrl)}" />
        <meta name="twitter:image:alt" content="Cooee logo" />`
    : "";
  const logoAlignment = normalizePublicLogoAlignment(publicLogoAlignment);
  const logoMarkup = [
    lightLogoDataUrl
      ? `<img class="public-logo public-logo-light" src="${escapeHtml(lightLogoDataUrl)}" alt="${escapedAppName} logo" />`
      : "",
    logoDataUrl
      ? `<img class="public-logo public-logo-default" src="${escapeHtml(logoDataUrl)}" alt="${escapedAppName} logo" />`
      : "",
  ]
    .filter(Boolean)
    .join("");
  const headerLogoMarkup = logoMarkup
    ? `<div class="header-logo header-logo-${logoAlignment}" data-public-logo-alignment="${logoAlignment}">${logoMarkup}</div>`
    : "";
  const appUrl = publicAppUrl.trim();
  const appLabel = escapeHtml(normalizePublicAppLabel(publicAppLabel));
  const appLinkMarkup = appUrl
    ? `<a class="public-link" data-public-app-link href="${escapeHtml(appUrl)}" target="_blank" rel="noreferrer">${appLabel}</a>`
    : "";
  const filterToggleMarkup = `<a class="filter-toggle" href="#public-filters" aria-label="Filter changelog updates" data-public-filter-toggle>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5h20"></path><path d="M6 12h12"></path><path d="M9 19h6"></path></svg>
              </a>`;
  const dateGroups = groupPublicEntriesByDate(
    entries,
    resolvedCategoryDefinitions,
  );
  const filterControlsMarkup = renderPublicFilterControls(
    resolvedCategoryDefinitions,
  );
  const entryMarkup = renderPublicDateGroups(
    dateGroups,
    resolvedCategoryDefinitions,
    groupEntriesByCategory,
  );
  const paginationMarkup = renderPublicPagination(dateGroups);

  return `<!doctype html>
    <html lang="en" data-theme="${currentPublicTheme}">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${escapedSeoTitle}</title>
        ${faviconMarkup}
        <meta name="description" content="${escapedSeoDescription}" />
        ${canonicalMarkup}
        <meta property="og:locale" content="en_AU" />
        <meta property="og:site_name" content="Cooee" />
        <meta property="og:type" content="website" />
        <meta property="og:title" content="${escapedSeoTitle}" />
        <meta property="og:description" content="${escapedSeoDescription}" />
        ${openGraphUrlMarkup}
        ${socialImageMarkup}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="${escapedSeoTitle}" />
        <meta name="twitter:description" content="${escapedSeoDescription}" />
	        <style>
	          :root,
	          html[data-theme="light"] {
	            color-scheme: light;
	            --public-bg: #fafaf9;
	            --public-text: #1c1917;
	            --public-heading: #292524;
	            --public-subtle: #57534e;
	            --public-muted: #78716c;
	            --public-panel: #ffffff;
	            --public-panel-muted: #f5f5f4;
	            --public-border: #e7e5e4;
	            --public-border-strong: #d6d3d1;
	            --public-active-bg: #292524;
	            --public-active-text: #fafaf9;
	            --public-code-bg: #f5f5f4;
	            --public-code-border: #e7e5e4;
	            --public-code-block-bg: #292524;
	            --public-code-block-text: #fafaf9;
	            --public-focus: #a8a29e;
	            --public-shadow: 0 1px 2px rgb(28 25 23 / 0.05), 0 10px 28px rgb(28 25 23 / 0.04);
	          }
	          html[data-theme="dark"] {
	            color-scheme: dark;
	            --public-bg: #1c1917;
	            --public-text: #fafaf9;
	            --public-heading: #fafaf9;
	            --public-subtle: #d6d3d1;
	            --public-muted: #a8a29e;
	            --public-panel: #292524;
	            --public-panel-muted: #1c1917;
	            --public-border: #44403c;
	            --public-border-strong: #57534e;
	            --public-active-bg: #fafaf9;
	            --public-active-text: #1c1917;
	            --public-code-bg: #44403c;
	            --public-code-border: #57534e;
	            --public-code-block-bg: #1c1917;
	            --public-code-block-text: #fafaf9;
	            --public-focus: #a8a29e;
	            --public-shadow: 0 1px 2px rgb(0 0 0 / 0.28), 0 12px 32px rgb(0 0 0 / 0.2);
	          }
	          body {
	            margin: 0;
	            background: ${pageBackground};
	            color: ${pageTextColor};
	            background: var(--public-bg);
	            color: var(--public-text);
	            font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	            text-wrap: balance;
	          }
          main {
            max-width: 840px;
            margin: 0 auto;
            padding: 64px 24px 40px;
          }
	          header {
	            border-bottom: 1px solid var(--public-border);
	            margin-bottom: 36px;
	            padding-bottom: 24px;
	          }
	          .header-title-row {
	            align-items: center;
	            display: flex;
	            gap: 16px;
	            justify-content: space-between;
	          }
	          .theme-toggle {
	            align-items: center;
	            background: var(--public-panel);
	            border: 1px solid var(--public-border-strong);
	            border-radius: 12px;
	            color: var(--public-heading);
	            display: inline-flex;
	            flex: none;
	            height: 36px;
	            justify-content: center;
	            width: 36px;
	          }
	          .theme-toggle svg {
	            height: 16px;
	            width: 16px;
	          }
	          html[data-theme="light"] [data-theme-toggle-icon="light"],
	          html[data-theme="dark"] [data-theme-toggle-icon="dark"] {
	            display: none;
	          }
	          h1 {
	            font-size: 32px;
	            line-height: 1.15;
	            margin: 0;
	            color: var(--public-heading);
	          }
          h2 {
            font-size: 20px;
            line-height: 1.25;
            margin: 0;
          }
          p {
            line-height: 1.65;
            margin: 0;
            text-wrap: balance;
          }
          .markdown-summary p {
            line-height: 1.65;
            margin: 0;
            max-width: 68ch;
            text-wrap: balance;
          }
          .markdown-summary p + p,
          .markdown-summary ul,
          .markdown-summary ol {
            margin-top: 14px;
          }
	          .markdown-summary a {
	            color: var(--public-heading);
	            font-weight: 600;
	          }
          .markdown-summary code {
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
            font-size: 0.92em;
            text-wrap: initial;
          }
          .markdown-summary code[data-code="inline"] {
            background: var(--public-code-bg);
            border: 1px solid var(--public-code-border);
            border-radius: 6px;
            color: var(--public-heading);
            padding: 1px 5px;
          }
          .markdown-summary pre {
            background: var(--public-code-block-bg);
            border: 1px solid var(--public-border-strong);
            border-radius: 14px;
            color: var(--public-code-block-text);
            margin: 14px 0 0;
            max-width: 100%;
            overflow-x: auto;
            padding: 14px;
            text-wrap: initial;
          }
          .markdown-summary code[data-code="block"] {
            background: transparent;
            border: 0;
            color: inherit;
            display: block;
            font-size: 13px;
            line-height: 1.6;
            min-width: max-content;
            padding: 0;
            white-space: pre;
          }
	          article {
	            background: var(--public-panel);
	            border: 1px solid #e7e5e4;
	            border: 1px solid var(--public-border);
            border-radius: 20px;
            padding: 18px;
          }
          article + article {
            margin-top: 12px;
          }
	          article[data-display-type="callout"] {
	            background: var(--public-panel-muted);
            border-radius: 18px;
            padding: 20px;
          }
          article[data-display-type="callout"] .markdown-summary {
            max-height: 120px;
            overflow: hidden;
          }
          article[data-display-type="callout"][data-callout-expanded="true"] .markdown-summary {
            max-height: none;
          }
          .callout-expand[hidden] {
            display: none;
          }
          .callout-expand {
            align-items: center;
            background: transparent;
            border: 0;
            border-radius: 10px;
            color: var(--public-muted);
            cursor: pointer;
            display: inline-flex;
            height: 28px;
            justify-content: center;
            margin: 12px 0 0 -4px;
            padding: 0;
            transition: background 150ms ease, color 150ms ease;
            width: 28px;
          }
          .callout-expand:hover {
            background: var(--public-panel);
            color: var(--public-heading);
          }
          .callout-expand:focus-visible {
            outline: 2px solid var(--public-heading);
            outline-offset: 2px;
          }
          .callout-expand svg {
            height: 16px;
            transition: transform 150ms ease;
            width: 16px;
          }
          article[data-display-type="callout"][data-callout-expanded="true"] .callout-expand svg {
            transform: rotate(180deg);
          }
          article[data-display-type="post"] {
            background: var(--public-panel);
            border-radius: 24px;
            box-shadow: var(--public-shadow);
            padding: 36px;
          }
	          .entry-image {
            aspect-ratio: 3 / 2;
	            border: 1px solid var(--public-border);
            border-radius: 18px;
            display: block;
            margin: 0 0 20px;
            object-fit: cover;
            width: 100%;
          }
          article[data-display-type="post"] .entry-header {
            margin-bottom: 16px;
          }
          article[data-display-type="post"] .entry-header h3 {
            font-size: 24px;
            line-height: 1.2;
          }
          article[data-display-type="text"] {
            background: transparent;
            border: 0;
            border-radius: 0;
            padding: 6px 0 6px 16px;
          }
          article[data-display-type="text"] + article[data-display-type="text"] {
            margin-top: 6px;
          }
	          article[data-display-type="text"] summary {
	            align-items: center;
	            color: var(--public-heading);
            cursor: pointer;
            display: inline-flex;
            font-size: 14px;
            gap: 8px;
            list-style: none;
          }
          article[data-display-type="text"] summary::-webkit-details-marker {
            display: none;
          }
          .text-entry-title {
            font-size: 14px;
            font-weight: 400;
            line-height: 1.6;
          }
	          .text-entry-chevron {
	            color: var(--public-muted);
            flex: none;
            height: 14px;
            transition: transform 150ms ease;
            width: 14px;
          }
          details[open] .text-entry-chevron {
            transform: rotate(180deg);
          }
          .text-change-items {
            display: grid;
            gap: 10px;
            margin-top: 12px;
          }
          .text-change-item h4 {
            font-size: 14px;
            font-weight: 400;
            line-height: 1.35;
            margin: 0;
          }
	          .text-change-item .markdown-summary {
	            color: var(--public-subtle);
            font-size: 14px;
            margin-top: 4px;
          }
          .entry-header {
            align-items: flex-start;
            display: flex;
            gap: 12px;
            justify-content: space-between;
            margin-bottom: 10px;
          }
          .entry-header h3 {
            font-size: 18px;
            line-height: 1.3;
            margin: 0;
          }
          .change-items {
            display: grid;
            gap: 12px;
            margin-top: 16px;
          }
	          .change-item {
	            background: var(--public-panel-muted);
	            border: 1px solid var(--public-border);
            border-radius: 16px;
            padding: 16px;
          }
          .change-item-header {
            align-items: flex-start;
            display: flex;
            gap: 12px;
            justify-content: space-between;
          }
          .change-item h3 {
            font-size: 15px;
            line-height: 1.3;
            margin: 0;
          }
	          .change-item p {
	            color: var(--public-subtle);
            font-size: 14px;
            margin-top: 8px;
          }
          .badge {
            align-items: center;
            border: 1px solid transparent;
            border-radius: 999px;
            display: inline-flex;
            flex: none;
            font-size: 12px;
            font-weight: 600;
            justify-content: center;
            line-height: 1;
            padding: 5px 9px;
            white-space: nowrap;
            width: fit-content;
          }
          .badge-feature {
            background: #ecfdf5;
            border-color: #a7f3d0;
            color: #065f46;
          }
          .badge-improvement {
            background: #eff6ff;
            border-color: #bfdbfe;
            color: #1d4ed8;
          }
          .badge-fix {
            background: #fffbeb;
            border-color: #fde68a;
            color: #92400e;
          }
	          .badge-maintenance {
	            background: var(--public-panel-muted);
	            border-color: var(--public-border-strong);
	            color: var(--public-subtle);
	          }
	          html[data-theme="dark"] .badge-feature {
	            background: #064e3b;
	            border-color: #047857;
	            color: #d1fae5;
	          }
	          html[data-theme="dark"] .badge-improvement {
	            background: #172554;
	            border-color: #2563eb;
	            color: #dbeafe;
	          }
	          html[data-theme="dark"] .badge-fix {
	            background: #451a03;
	            border-color: #b45309;
	            color: #fef3c7;
	          }
          .header-row {
            align-items: center;
            display: flex;
            gap: 16px;
            justify-content: space-between;
          }
          .header-actions {
            align-items: center;
            display: flex;
            flex: none;
            flex-wrap: wrap;
            gap: 8px;
            justify-content: flex-end;
          }
          .header-logo {
            display: flex;
            margin-bottom: 28px;
          }
          .header-logo-left {
            justify-content: flex-start;
          }
          .header-logo-center {
            justify-content: center;
          }
          .header-logo-right {
            justify-content: flex-end;
          }
          .public-logo {
            display: block;
            height: 36px;
            max-width: 180px;
            object-fit: contain;
            width: auto;
          }
          .public-logo-light {
            display: none;
          }
          html[data-theme="light"] .public-logo-light {
            display: block;
          }
          html[data-theme="light"] .public-logo-light + .public-logo-default {
            display: none;
          }
          .filter-toggle,
          .public-link {
            align-items: center;
	            background: var(--public-panel);
	            border: 1px solid var(--public-border-strong);
	            border-radius: 12px;
	            color: var(--public-heading);
            display: inline-flex;
	            font-size: 13px;
            justify-content: center;
	            padding: 6px 10px;
	            text-decoration: none;
	          }
          .filter-toggle {
            height: 36px;
            padding: 0;
            width: 36px;
          }
          .filter-toggle svg {
            height: 16px;
            width: 16px;
          }
	          .filters {
	            background: var(--public-panel);
	            border: 1px solid var(--public-border);
            border-radius: 20px;
            box-shadow: var(--public-shadow);
            display: grid;
            gap: 12px;
            margin-bottom: 32px;
            padding: 16px;
          }
          .filter-fields {
            display: grid;
            gap: 12px;
            grid-template-columns: minmax(0, 1fr) 140px 140px auto;
          }
          .filter-field {
            display: flex;
            flex-direction: column;
            gap: 6px;
          }
	          .filter-field span {
	            color: var(--public-muted);
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
          }
	          .filter-field input {
	            background: var(--public-panel);
	            border: 1px solid var(--public-border-strong);
	            border-radius: 12px;
	            color: var(--public-heading);
            font: inherit;
            font-size: 14px;
            height: 36px;
            padding: 0 10px;
          }
	          .filter-clear,
	          .filter-category {
	            background: var(--public-panel);
	            border: 1px solid var(--public-border-strong);
	            border-radius: 12px;
	            color: var(--public-heading);
            font: inherit;
            font-size: 13px;
            font-weight: 600;
            height: 36px;
            padding: 0 10px;
          }
          .filter-categories {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
          }
          .filter-category {
            height: auto;
            padding: 6px 10px;
          }
	          .filter-category[aria-pressed="true"][data-category-filter="all"] {
	            background: var(--public-active-bg);
	            border-color: var(--public-active-bg);
	            color: var(--public-active-text);
          }
          .filter-category[aria-pressed="false"]:not([data-category-filter="all"]) {
            opacity: 0.4;
          }
          .date-group {
            margin: 0;
            padding: 0 0 30px 34px;
            position: relative;
          }
	          .date-group::before {
	            background: var(--public-border-strong);
            bottom: -6px;
            content: "";
            left: 8px;
            position: absolute;
            top: 12px;
            width: 1px;
          }
          .date-group:last-child::before {
            bottom: 30px;
          }
          .timeline-date {
            align-items: center;
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            margin-bottom: 14px;
            min-height: 26px;
            position: relative;
          }
	          .timeline-dot {
	            background: var(--public-bg);
	            border: 2px solid var(--public-muted);
            border-radius: 999px;
            height: 17px;
            left: -34px;
            position: absolute;
            top: 4px;
            width: 17px;
            z-index: 1;
          }
	          .timeline-date h2 {
	            color: var(--public-heading);
            font-size: 18px;
          }
	          .date-category-summary {
	            align-items: center;
	            color: var(--public-muted);
            display: flex;
            flex-wrap: wrap;
            font-size: 13px;
            row-gap: 4px;
          }
          .date-category-separator {
            margin-right: 6px;
          }
          .date-category-summary a {
            border-radius: 8px;
            color: inherit;
            text-decoration: none;
            text-underline-offset: 4px;
          }
	          .date-category-summary a:hover {
	            color: var(--public-heading);
            text-decoration: underline;
          }
	          .date-category-summary a:focus-visible {
	            outline: 2px solid var(--public-focus);
            outline-offset: 2px;
          }
          .category-entry-group {
            position: relative;
            scroll-margin-top: 96px;
          }
	          .category-entry-group::before {
	            background: var(--public-border-strong);
            content: "";
            height: 1px;
            left: -26px;
            position: absolute;
            top: 12px;
            width: 18px;
          }
          .date-group:last-child .category-entry-group:last-child::after {
            background: var(--public-bg);
            bottom: -30px;
            content: "";
            left: -26px;
            position: absolute;
            top: 13px;
            width: 1px;
          }
          .timeline-entries > .category-entry-group:not(:first-child) {
            margin-top: 24px;
          }
          .category-entry-heading {
            margin: 0 0 12px;
            text-wrap: balance;
          }
	          .timeline-date span:last-child {
	            color: var(--public-muted);
            font-size: 13px;
          }
	          .pagination {
	            align-items: center;
	            border-top: 1px solid var(--public-border);
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            justify-content: space-between;
            margin-top: 4px;
            padding-top: 20px;
          }
	          .pagination-status {
	            color: var(--public-muted);
            font-size: 13px;
          }
          .pagination-buttons {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
          }
	          .pagination button {
	            background: var(--public-panel);
	            border: 1px solid var(--public-border-strong);
	            border-radius: 12px;
	            color: var(--public-heading);
            font: inherit;
            font-size: 13px;
            padding: 6px 10px;
          }
	          .pagination button[aria-current="page"] {
	            background: var(--public-active-bg);
	            border-color: var(--public-active-bg);
	            color: var(--public-active-text);
          }
	          .empty-state {
	            border: 1px dashed var(--public-border-strong);
	            border-radius: 20px;
	            background: color-mix(in oklab, var(--public-panel) 54%, transparent);
	            box-shadow: var(--public-shadow);
	            color: var(--public-subtle);
            padding: 24px;
            text-align: center;
          }
          @media (max-width: 720px) {
            .filter-fields {
              grid-template-columns: 1fr;
            }
          }
	          footer {
	            align-items: center;
	            border-top: 1px solid var(--public-border);
            display: flex;
            justify-content: center;
            margin-top: 32px;
            padding-top: 24px;
          }
	          .powered-by {
	            align-items: center;
	            color: var(--public-muted);
            display: inline-flex;
            gap: 8px;
            font-size: 13px;
            text-decoration: none;
          }
          .powered-by-logo {
            align-items: center;
            display: inline-flex;
            height: 15px;
            overflow: visible;
            transition: filter 150ms ease;
            width: 113px;
          }
          html[data-theme="dark"] .powered-by-logo {
            filter: invert(1);
          }
          .powered-by-logo svg,
          .powered-by-logo-fallback {
            display: block;
            height: 100%;
            overflow: visible;
            width: 100%;
          }
        </style>
      </head>
      <body>
        <main>
          <header>
            ${headerLogoMarkup}
            <div class="header-row">
              <h1>${escapedAppName} changelog</h1>
              <div class="header-actions">
                <button class="theme-toggle" type="button" aria-label="${publicThemeToggleLabel}" data-public-theme-toggle>
                  <svg data-theme-toggle-icon="dark" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.9 13.2A8 8 0 0 1 10.8 3.1 7 7 0 1 0 20.9 13.2Z"></path></svg>
                  <svg data-theme-toggle-icon="light" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path></svg>
                </button>
                ${filterToggleMarkup}
                ${appLinkMarkup}
              </div>
            </div>
          </header>
          ${filterControlsMarkup}
          ${entryMarkup}
          ${paginationMarkup}
          <footer>
            <a class="powered-by home-logo-link" href="https://cooee.sh" target="_blank" rel="noreferrer">
              <span>Powered by</span>
              <span class="powered-by-logo animated-cooee-logo-asset" data-powered-by-logo aria-label="cooee">
                <img class="powered-by-logo-fallback" src="/cooee-logo.svg" alt="cooee" />
              </span>
            </a>
          </footer>
        </main>
        ${renderPublicPaginationScript(resolvedCategoryDefinitions)}
      </body>
    </html>`;
}

type PublicDateGroup = {
  date: string;
  dateKey: string | null;
  entries: PublishedEntry[];
  pageIndex: number;
};

type PublicCategoryEntryGroup = {
  kind: "category";
  category: string;
  label: string;
  entries: PublishedEntry[];
};

type PublicDateCategorySummary = {
  category: string;
  label: string;
  anchorId: string;
};

type PublicEntrySegment =
  | {
      kind: "entry";
      entry: PublishedEntry;
    }
  | PublicCategoryEntryGroup;

const publicDateGroupsPerPage = 14;

function filterPublicEntries(
  entries: PublishedEntry[],
  filters: {
    categories: Set<PublishedEntry["category"]>;
    categoryDefinitions: ChangelogCategoryDefinition[];
    dateFrom: string;
    dateTo: string;
    search: string;
  },
): PublishedEntry[] {
  const publicChangelogCategories = filters.categoryDefinitions.map(
    (category) => category.id,
  );
  const query = filters.search.trim().toLowerCase();
  const selectedCategories =
    filters.categories.size === 0
      ? new Set(publicChangelogCategories)
      : filters.categories;

  return entries.filter((entry) => {
    if (!publicEntryMatchesCategory(entry, selectedCategories)) {
      return false;
    }

    if (!publicEntryMatchesDateRange(entry, filters.dateFrom, filters.dateTo)) {
      return false;
    }

    if (!query) {
      return true;
    }

    return publicEntrySearchText(entry).includes(query);
  });
}

function publicEntryMatchesCategory(
  entry: PublishedEntry,
  categories: Set<PublishedEntry["category"]>,
): boolean {
  return getPublicEntryCategoryIds(entry).some((category) =>
    categories.has(category),
  );
}

function getPublicEntryCategoryIds(entry: PublishedEntry): string[] {
  return [entry.category, ...(entry.items ?? []).map((item) => item.category)]
    .map(normalizeChangelogCategoryId)
    .filter(Boolean);
}

function publicEntryMatchesDateRange(
  entry: PublishedEntry,
  dateFrom: string,
  dateTo: string,
): boolean {
  if (!dateFrom && !dateTo) {
    return true;
  }

  const dateKey = getPublicEntryDateKey(entry);
  if (!dateKey) {
    return false;
  }

  return (!dateFrom || dateKey >= dateFrom) && (!dateTo || dateKey <= dateTo);
}

function publicEntrySearchText(entry: PublishedEntry): string {
  return [
    entry.title,
    entry.summary,
    entry.category,
    ...(entry.items ?? []).flatMap((item) => [
      item.title,
      item.summary,
      item.category,
    ]),
  ]
    .map(stripMarkdownSearchSyntax)
    .join(" ")
    .toLowerCase();
}

function stripMarkdownSearchSyntax(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_~#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getPublicCategoryFilterKey(
  categories: Set<PublishedEntry["category"]>,
  publicChangelogCategories: PublishedEntry["category"][] = defaultChangelogCategoryDefinitions.map(
    (category) => category.id,
  ),
): string {
  return publicChangelogCategories
    .filter((category) => categories.has(category))
    .join("|");
}

function getPublicEntryDateKey(entry: PublishedEntry): string | null {
  const publishedDate = getDateKeyFromPublishedAt(entry.publishedAt);
  if (publishedDate) {
    return publishedDate;
  }

  return getDateKeyFromDisplayTime(entry.time);
}

function getDateKeyFromPublishedAt(
  publishedAt: string | null | undefined,
): string | null {
  if (!publishedAt) {
    return null;
  }

  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return format(date, "yyyy-MM-dd");
}

function getDateKeyFromDisplayTime(time: string): string | null {
  const today = new Date();
  const normalizedTime = time.trim().toLowerCase();

  if (normalizedTime === "today") {
    return format(today, "yyyy-MM-dd");
  }

  if (normalizedTime === "yesterday") {
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    return format(yesterday, "yyyy-MM-dd");
  }

  const parsed = new Date(`${time} ${today.getFullYear()}`);
  return Number.isNaN(parsed.getTime()) ? null : format(parsed, "yyyy-MM-dd");
}

function groupPublicEntriesByDate(
  entries: PublishedEntry[],
  categoryDefinitions: ChangelogCategoryDefinition[] = defaultChangelogCategoryDefinitions,
): PublicDateGroup[] {
  const dateGroups: Array<{
    date: string;
    dateKey: string | null;
    entries: PublishedEntry[];
  }> = [];

  for (const entry of entries) {
    const existingGroup = dateGroups.find((group) => group.date === entry.time);
    if (existingGroup) {
      existingGroup.entries.push(entry);
      continue;
    }

    dateGroups.push({
      date: entry.time,
      dateKey: getPublicEntryDateKey(entry),
      entries: [entry],
    });
  }

  return dateGroups.map((group, index) => ({
    ...group,
    entries: [...group.entries].sort((left, right) =>
      compareChangelogCategories(
        toApiCategory(left.category),
        toApiCategory(right.category),
        categoryDefinitions,
      ),
    ),
    pageIndex: Math.floor(index / publicDateGroupsPerPage),
  }));
}

function groupPublicEntrySegments(
  entries: PublishedEntry[],
  categoryDefinitions: ChangelogCategoryDefinition[],
  groupEntriesByCategory: boolean,
): PublicEntrySegment[] {
  const definitions =
    normalizeChangelogCategoryDefinitions(categoryDefinitions);

  if (!groupEntriesByCategory) {
    return entries.map((entry) => ({ kind: "entry", entry }));
  }

  const segments: PublicEntrySegment[] = [];

  for (const entry of entries) {
    const category = normalizeChangelogCategoryId(entry.category);
    if (!category) {
      segments.push({ kind: "entry", entry });
      continue;
    }

    const previous = segments.at(-1);
    if (previous?.kind === "category" && previous.category === category) {
      previous.entries.push(entry);
      continue;
    }

    segments.push({
      kind: "category",
      category,
      label: getChangelogCategoryLabel(category, definitions),
      entries: [entry],
    });
  }

  return segments.map((segment) =>
    segment.kind === "category"
      ? {
          ...segment,
          label: getPublicCategoryCountLabel(
            segment.category,
            segment.entries.length,
            definitions,
          ),
        }
      : segment,
  );
}

function getPublicDateCategorySummaries(
  group: PublicDateGroup,
  categoryDefinitions: ChangelogCategoryDefinition[],
): PublicDateCategorySummary[] {
  const definitions =
    normalizeChangelogCategoryDefinitions(categoryDefinitions);
  const counts = new Map<string, number>();

  for (const entry of group.entries) {
    const category = normalizeChangelogCategoryId(entry.category);
    if (!category) {
      continue;
    }

    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort(([left], [right]) =>
      compareChangelogCategories(
        toApiCategory(left),
        toApiCategory(right),
        definitions,
      ),
    )
    .map(([category, count]) => ({
      category,
      label: `${count} ${getPublicCategoryCountLabel(
        category,
        count,
        definitions,
      )}`,
      anchorId: getPublicDateCategoryAnchorId(group, category),
    }));
}

function getPublicCategoryCountLabel(
  category: string,
  count: number,
  categoryDefinitions: ChangelogCategoryDefinition[],
): string {
  const label = getChangelogCategoryLabel(
    toApiCategory(category),
    categoryDefinitions,
  );

  return count === 1 ? label : pluralizePublicCategoryHeading(label);
}

function getPublicDateCategoryAnchorId(
  group: PublicDateGroup,
  category: string,
): string {
  return `changelog-${getPublicAnchorSlug(group.date)}-${getPublicAnchorSlug(
    category,
  )}`;
}

function getPublicAnchorSlug(value: string): string {
  return normalizeChangelogCategoryId(value) || "section";
}

function consumePublicCategoryAnchorId(
  category: string,
  summariesByCategory: Map<string, PublicDateCategorySummary>,
  anchoredCategories: Set<string>,
): string | undefined {
  const normalizedCategory = normalizeChangelogCategoryId(category);
  if (!normalizedCategory || anchoredCategories.has(normalizedCategory)) {
    return undefined;
  }

  const summary = summariesByCategory.get(normalizedCategory);
  if (!summary) {
    return undefined;
  }

  anchoredCategories.add(normalizedCategory);
  return summary.anchorId;
}

function pluralizePublicCategoryHeading(label: string): string {
  const trimmed = label.trim();
  const lower = trimmed.toLowerCase();
  const irregular: Record<string, string> = {
    fix: "Fixes",
    improvement: "Improvements",
    maintenance: "Maintenance",
    security: "Security",
  };

  if (!trimmed) {
    return label;
  }

  if (irregular[lower]) {
    return irregular[lower];
  }

  if (/[sxz]$/i.test(trimmed) || /(ch|sh)$/i.test(trimmed)) {
    return `${trimmed}es`;
  }

  if (/[^aeiou]y$/i.test(trimmed)) {
    return `${trimmed.slice(0, -1)}ies`;
  }

  return trimmed.endsWith("s") ? trimmed : `${trimmed}s`;
}

function renderPublicDateGroups(
  groups: PublicDateGroup[],
  categoryDefinitions: ChangelogCategoryDefinition[],
  groupEntriesByCategory: boolean,
): string {
  if (groups.length === 0) {
    return `<section class="empty-state" data-empty-state>No updates published yet.</section>`;
  }

  return `<section class="public-updates" data-public-updates aria-label="Changelog updates">${groups.map((group) => renderPublicDateGroup(group, categoryDefinitions, groupEntriesByCategory)).join("")}</section><section class="empty-state" data-filter-empty-state hidden>No updates match your filters.</section>`;
}

function renderPublicDateGroup(
  group: PublicDateGroup,
  categoryDefinitions: ChangelogCategoryDefinition[],
  groupEntriesByCategory: boolean,
): string {
  const entrySegments = groupPublicEntrySegments(
    group.entries,
    categoryDefinitions,
    groupEntriesByCategory,
  );
  const entriesMarkup = renderPublicEntrySegments(
    entrySegments,
    categoryDefinitions,
    getPublicDateCategorySummaries(group, categoryDefinitions),
  );
  const categorySummaryMarkup = renderPublicDateCategorySummaryLinks(
    group,
    categoryDefinitions,
  );
  const headerMarkup = `
    <div class="timeline-date">
      <span class="timeline-dot" aria-hidden="true"></span>
      <h2>${escapeHtml(group.date)}</h2>
      ${categorySummaryMarkup}
    </div>
  `;

  return `
    <section class="date-group" data-date-key="${escapeHtml(group.dateKey ?? "")}">
      ${headerMarkup}
      <div class="timeline-entries">${entriesMarkup}</div>
    </section>
  `;
}

function renderPublicEntrySegments(
  segments: PublicEntrySegment[],
  categoryDefinitions: ChangelogCategoryDefinition[],
  categorySummaries: PublicDateCategorySummary[],
): string {
  const categorySummariesByCategory = new Map(
    categorySummaries.map((summary) => [summary.category, summary]),
  );
  const anchoredCategories = new Set<string>();
  const consumeAnchorId = (category: string): string | undefined =>
    consumePublicCategoryAnchorId(
      category,
      categorySummariesByCategory,
      anchoredCategories,
    );

  return segments
    .map((segment) => {
      if (segment.kind === "entry") {
        return renderPublicEntry(
          segment.entry,
          categoryDefinitions,
          consumeAnchorId(segment.entry.category),
        );
      }

      const anchorId = consumeAnchorId(segment.category);
      const anchorAttribute = anchorId ? ` id="${escapeHtml(anchorId)}"` : "";

      return `
        <section class="category-entry-group" data-category-section="${escapeHtml(segment.category)}" data-timeline-branch${anchorAttribute}>
          <h3 class="category-entry-heading ${getPublicCategoryBadgeClass(segment.category)}">${escapeHtml(segment.label)}</h3>
          ${segment.entries.map((entry) => renderPublicEntry(entry, categoryDefinitions)).join("")}
        </section>
      `;
    })
    .join("");
}

function renderPublicDateCategorySummaryLinks(
  group: PublicDateGroup,
  categoryDefinitions: ChangelogCategoryDefinition[],
): string {
  const summaries = getPublicDateCategorySummaries(group, categoryDefinitions);

  return `
    <nav class="date-category-summary" aria-label="${escapeHtml(group.date)} categories">
      ${summaries
        .map(
          (summary, index) =>
            `${index > 0 ? '<span class="date-category-separator" aria-hidden="true">,</span>' : ""}<a href="#${escapeHtml(summary.anchorId)}">${escapeHtml(summary.label)}</a>`,
        )
        .join("")}
    </nav>
  `;
}

function renderPublicEntry(
  entry: PublishedEntry,
  categoryDefinitions: ChangelogCategoryDefinition[],
  anchorId?: string,
): string {
  const categories = getPublicEntryCategoryIds(entry).join(" ");
  const displayType = getChangelogCategoryDisplayType(
    entry.category,
    categoryDefinitions,
  );
  const summaryMarkup = renderMarkdown(entry.summary);
  const commonAttributes = [
    anchorId ? `id="${escapeHtml(anchorId)}"` : "",
    "data-public-entry",
    `data-categories="${escapeHtml(categories)}"`,
    `data-display-type="${escapeHtml(displayType)}"`,
    `data-search="${escapeHtml(publicEntrySearchText(entry))}"`,
  ]
    .filter(Boolean)
    .join(" ");

  if (displayType === "text") {
    return `
      <article ${commonAttributes}>
        <details>
          <summary><span class="text-entry-title">${escapeHtml(entry.title)}</span><svg class="text-entry-chevron" data-icon="text-entry-chevron" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"></path></svg></summary>
          <div class="markdown-summary">${summaryMarkup}</div>
          ${renderPublicPreviewItems(entry.items, categoryDefinitions, "plain")}
        </details>
      </article>
    `;
  }

  return `
    <article ${commonAttributes}>
      ${displayType === "post" ? renderPublicEntryImage(entry) : ""}
      <div class="entry-header">
        <h3>${escapeHtml(entry.title)}</h3>
      </div>
      <div class="markdown-summary">${summaryMarkup}</div>
      ${displayType === "callout" ? '<button class="callout-expand" data-callout-expand type="button" aria-expanded="false" aria-label="Expand callout text" hidden><svg data-icon="callout-entry-chevron" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"></path></svg></button>' : ""}
      ${renderPublicPreviewItems(entry.items, categoryDefinitions)}
    </article>
  `;
}

function renderPublicEntryImage(entry: PublishedEntry): string {
  if (!entry.imageUrl) {
    return "";
  }

  return `<img class="entry-image" src="${escapeHtml(entry.imageUrl)}" alt="" loading="lazy" />`;
}

function renderPublicPreviewItems(
  items: PublishedEntry["items"],
  categoryDefinitions: ChangelogCategoryDefinition[],
  variant: "card" | "plain" = "card",
): string {
  if (!items || items.length === 0) {
    return "";
  }

  const sortedItems = [...items].sort((left, right) =>
    compareChangelogCategories(
      toApiCategory(left.category),
      toApiCategory(right.category),
      categoryDefinitions,
    ),
  );

  if (variant === "plain") {
    return `
      <div class="text-change-items">
        ${sortedItems
          .map(
            (item) => `
              <section class="text-change-item">
                <h4>${escapeHtml(item.title)}</h4>
                <div class="markdown-summary">${renderMarkdown(item.summary)}</div>
              </section>
            `,
          )
          .join("")}
      </div>
    `;
  }

  return `
    <div class="change-items">
      ${sortedItems
        .map(
          (item) => `
            <section class="change-item">
              <div class="change-item-header">
                <h3>${escapeHtml(item.title)}</h3>
                ${renderPublicCategoryBadge(item.category, categoryDefinitions)}
              </div>
              <div class="markdown-summary">${renderMarkdown(item.summary)}</div>
            </section>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderPublicCategoryBadge(
  category: PublishedEntry["category"],
  categoryDefinitions: ChangelogCategoryDefinition[],
): string {
  return `<span class="${getPublicCategoryBadgeClass(category)}">${escapeHtml(getChangelogCategoryLabel(category, categoryDefinitions))}</span>`;
}

function renderPublicFilterControls(
  categoryDefinitions: ChangelogCategoryDefinition[],
): string {
  return `
    <section class="filters" id="public-filters" aria-label="Filter changelog updates">
      <div class="filter-fields">
        <label class="filter-field">
          <span>Search</span>
          <input data-public-search type="search" placeholder="Title or summary" />
        </label>
        <label class="filter-field">
          <span>From</span>
          <input data-public-date-from type="date" />
        </label>
        <label class="filter-field">
          <span>To</span>
          <input data-public-date-to type="date" />
        </label>
        <button class="filter-clear" data-public-clear type="button">Clear</button>
      </div>
      <div class="filter-categories">
        <button class="filter-category" data-category-filter="all" type="button" aria-pressed="true">All types</button>
        ${categoryDefinitions
          .map(
            (category) =>
              `<button class="filter-category ${getPublicCategoryBadgeClass(category.id)}" data-category-filter="${escapeHtml(category.id)}" type="button" aria-pressed="true">${escapeHtml(category.label)}</button>`,
          )
          .join("")}
      </div>
    </section>
  `;
}

function getPublicCategoryBadgeClass(
  category: PublishedEntry["category"],
): string {
  const categoryClass = normalizeChangelogCategoryId(category);
  return `badge badge-${categoryClass || "custom"}`;
}

function renderPublicPagination(groups: PublicDateGroup[]): string {
  const pageCount = (groups.at(-1)?.pageIndex ?? 0) + 1;
  if (pageCount <= 1) {
    return "";
  }

  const buttons = Array.from(
    { length: pageCount },
    (_, index) =>
      `<button type="button" data-page-button="${index}"${index === 0 ? ' aria-current="page"' : ""}>${index + 1}</button>`,
  ).join("");

  return `
    <nav class="pagination" aria-label="Changelog pages">
      <span class="pagination-status" data-pagination-status>Page 1 of ${pageCount}</span>
      <div class="pagination-buttons">${buttons}</div>
    </nav>
  `;
}

function renderPublicPaginationScript(
  categoryDefinitions: ChangelogCategoryDefinition[],
): string {
  const categoryIds = categoryDefinitions.map((category) => category.id);
  return `
    <script>
      (() => {
        const logoHost = document.querySelector("[data-powered-by-logo]");
	        if (logoHost) {
	          fetch("/cooee-logo.svg")
            .then((response) => response.ok ? response.text() : "")
            .then((svg) => {
              if (!svg) {
                return;
              }

              logoHost.innerHTML = svg;
              const logoSvg = logoHost.querySelector("svg");
              if (logoSvg) {
                logoSvg.setAttribute("class", "powered-by-logo-inline");
                logoSvg.setAttribute("role", "img");
                logoSvg.setAttribute("aria-label", "cooee");
              }
            })
            .catch(() => {});
        }

        const themeToggle = document.querySelector("[data-public-theme-toggle]");
        const publicThemeStorageKey = "${publicChangelogThemeStorageKey}";
        const publicThemeCookieName = "${publicChangelogThemeCookieName}";
        function getRememberedPublicTheme() {
          try {
            const storedTheme = window.localStorage.getItem(publicThemeStorageKey);
            return storedTheme === "dark" || storedTheme === "light" ? storedTheme : null;
          } catch {
            return null;
          }
        }
        function persistPublicTheme(theme) {
          try {
            window.localStorage.setItem(publicThemeStorageKey, theme);
          } catch {}
          try {
            document.cookie = publicThemeCookieName + "=" + theme + "; Max-Age=31536000; Path=/; SameSite=Lax";
          } catch {}
        }
        function getPublicTheme() {
          return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
        }
        function updateThemeToggle() {
          if (!themeToggle) {
            return;
          }

          const nextTheme = getPublicTheme() === "dark" ? "light" : "dark";
          themeToggle.setAttribute("aria-label", "Switch to " + nextTheme + " mode");
        }
        const rememberedPublicTheme = getRememberedPublicTheme();
        if (rememberedPublicTheme) {
          document.documentElement.dataset.theme = rememberedPublicTheme;
        }
        if (themeToggle) {
          themeToggle.addEventListener("click", () => {
            const nextTheme = getPublicTheme() === "dark" ? "light" : "dark";
            document.documentElement.dataset.theme = nextTheme;
            persistPublicTheme(nextTheme);
            updateThemeToggle();
          });
          updateThemeToggle();
        }

        const groups = Array.from(document.querySelectorAll(".date-group"));
        const buttons = Array.from(document.querySelectorAll("[data-page-button]"));
        const status = document.querySelector("[data-pagination-status]");
        const searchInput = document.querySelector("[data-public-search]");
        const dateFromInput = document.querySelector("[data-public-date-from]");
        const dateToInput = document.querySelector("[data-public-date-to]");
        const clearButton = document.querySelector("[data-public-clear]");
        const categoryButtons = Array.from(document.querySelectorAll("[data-category-filter]"));
        const filterEmptyState = document.querySelector("[data-filter-empty-state]");
        const categories = ${JSON.stringify(categoryIds)};
        const selectedCategories = new Set(categories);
        const calloutCollapsedHeight = 120;
        const calloutExpandButtons = Array.from(document.querySelectorAll("[data-callout-expand]"));
        let currentPage = 0;

        function isAllCategoriesSelected() {
          return categories.every((category) => selectedCategories.has(category));
        }

        function matchesDate(group) {
          const dateKey = group.dataset.dateKey || "";
          const from = dateFromInput ? dateFromInput.value : "";
          const to = dateToInput ? dateToInput.value : "";

          if (!from && !to) {
            return true;
          }

          return Boolean(dateKey) && (!from || dateKey >= from) && (!to || dateKey <= to);
        }

        function matchesEntry(entry) {
          const query = searchInput ? searchInput.value.trim().toLowerCase() : "";
          const entryCategories = (entry.dataset.categories || "").split(" ").filter(Boolean);
          const categoryMatch = entryCategories.some((category) => selectedCategories.has(category));
          const searchMatch = !query || (entry.dataset.search || "").includes(query);
          return categoryMatch && searchMatch;
        }

        function getVisibleGroups() {
          return groups.filter((group) => group.dataset.filterMatch === "true");
        }

        function updateCategoryButtons() {
          const allSelected = isAllCategoriesSelected();
          categoryButtons.forEach((button) => {
            const category = button.dataset.categoryFilter || "";
            button.setAttribute(
              "aria-pressed",
              category === "all" ? String(allSelected) : String(selectedCategories.has(category)),
            );
          });
        }

        function showPage(pageIndex) {
          const visibleGroups = getVisibleGroups();
          const pageCount = Math.max(1, Math.ceil(visibleGroups.length / ${publicDateGroupsPerPage}));
          currentPage = Math.min(Math.max(pageIndex, 0), pageCount - 1);
          const firstGroup = currentPage * ${publicDateGroupsPerPage};
          const lastGroup = firstGroup + ${publicDateGroupsPerPage};

          groups.forEach((group) => {
            const visibleIndex = visibleGroups.indexOf(group);
            group.hidden = visibleIndex < firstGroup || visibleIndex >= lastGroup;
          });
          buttons.forEach((button, index) => {
            button.hidden = index >= pageCount;
            if (index === currentPage) {
              button.setAttribute("aria-current", "page");
            } else {
              button.removeAttribute("aria-current");
            }
          });
          if (status) {
            status.textContent = "Page " + (currentPage + 1) + " of " + pageCount;
          }
          if (filterEmptyState) {
            filterEmptyState.hidden = visibleGroups.length > 0;
          }
        }

        function applyFilters() {
          groups.forEach((group) => {
            const entries = Array.from(group.querySelectorAll("[data-public-entry]"));
            const dateMatch = matchesDate(group);
            let hasVisibleEntry = false;

            entries.forEach((entry) => {
              const visible = dateMatch && matchesEntry(entry);
              entry.hidden = !visible;
              hasVisibleEntry = hasVisibleEntry || visible;
            });

            group.dataset.filterMatch = String(dateMatch && hasVisibleEntry);
          });

          updateCategoryButtons();
          showPage(0);
        }

        function getPublicPreviewScrollBehavior() {
          return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth";
        }

        function updateCalloutExpandButton(button) {
          const article = button.closest('article[data-display-type="callout"]');
          const summary = article ? article.querySelector(".markdown-summary") : null;
          const canExpand = Boolean(summary && summary.scrollHeight > calloutCollapsedHeight + 1);
          button.hidden = !canExpand;

          if (!article || canExpand) {
            return;
          }

          delete article.dataset.calloutExpanded;
          button.setAttribute("aria-expanded", "false");
          button.setAttribute("aria-label", "Expand callout text");
        }

        function updateCalloutExpandButtons() {
          calloutExpandButtons.forEach(updateCalloutExpandButton);
        }

        buttons.forEach((button) => {
          button.addEventListener("click", () => {
            showPage(Number(button.dataset.pageButton || 0));
          });
        });
        [searchInput, dateFromInput, dateToInput].forEach((input) => {
          if (input) {
            input.addEventListener("input", applyFilters);
          }
        });
        if (clearButton) {
          clearButton.addEventListener("click", () => {
            if (searchInput) searchInput.value = "";
            if (dateFromInput) dateFromInput.value = "";
            if (dateToInput) dateToInput.value = "";
            selectedCategories.clear();
            categories.forEach((category) => selectedCategories.add(category));
            applyFilters();
          });
        }
        categoryButtons.forEach((button) => {
          button.addEventListener("click", () => {
            const category = button.dataset.categoryFilter || "";
            if (category === "all") {
              selectedCategories.clear();
              categories.forEach((item) => selectedCategories.add(item));
              applyFilters();
              return;
            }

            if (isAllCategoriesSelected()) {
              selectedCategories.clear();
            }

            if (selectedCategories.has(category)) {
              selectedCategories.delete(category);
            } else {
              selectedCategories.add(category);
            }

            if (selectedCategories.size === 0) {
              categories.forEach((item) => selectedCategories.add(item));
            }

            applyFilters();
          });
        });
        document.querySelectorAll(".date-category-summary a").forEach((anchor) => {
          anchor.addEventListener("click", (event) => {
            const href = anchor.getAttribute("href") || "";
            if (!href.startsWith("#")) {
              return;
            }

            const target = document.getElementById(decodeURIComponent(href.slice(1)));
            if (!target) {
              return;
            }

            event.preventDefault();
            event.stopPropagation();
            target.scrollIntoView({ behavior: getPublicPreviewScrollBehavior(), block: "start" });
            window.history.pushState(null, "", href);
          });
        });
        calloutExpandButtons.forEach((button) => {
          updateCalloutExpandButton(button);
          button.addEventListener("click", () => {
            const article = button.closest('article[data-display-type="callout"]');
            if (!article) {
              return;
            }

            const isExpanded = article.dataset.calloutExpanded === "true";
            const nextExpanded = !isExpanded;
            article.dataset.calloutExpanded = String(nextExpanded);
            button.setAttribute("aria-expanded", String(nextExpanded));
            button.setAttribute(
              "aria-label",
              nextExpanded ? "Collapse callout text" : "Expand callout text",
            );
          });
        });
        if (window.addEventListener) {
          window.addEventListener("resize", updateCalloutExpandButtons);
        }
        applyFilters();
      })();
    </script>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getInitialTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "light";
  }

  const storedTheme = window.localStorage.getItem("cooee:theme");
  if (storedTheme === "light" || storedTheme === "dark") {
    return storedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}
