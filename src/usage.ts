import { createCommandClient, output, type ReadCommandDependencies } from "./command.ts";
import { FullUsageDocument, type FullUsageQuery } from "./gql/graphql.ts";
import { formatBytes, formatJson, formatTable, formatTimestamp } from "./output.ts";

export interface UsageOptions {
  json?: boolean;
}

export type UsageDependencies = ReadCommandDependencies;
type UsageOverview = FullUsageQuery["me"]["usageOverview"];

function day(value: number): string {
  const formatted = formatTimestamp(value);
  return formatted === "—" ? formatted : formatted.slice(0, 10);
}

function section(title: string, headers: string[], rows: string[][], empty: string): string {
  return `${title}\n${rows.length > 0 ? formatTable(headers, rows) : empty}`;
}

function serializeUsage(data: FullUsageQuery) {
  const overview = data.me.usageOverview;
  return {
    userId: data.me.id,
    tier: data.me.tier,
    storage: {
      usedBytes: overview.storage.usedBytes,
      quotaBytes: overview.storage.quotaBytes,
      remainingBytes: overview.storage.remainingBytes,
      originalsBytes: overview.storage.originalsBytes,
      othersBytes: overview.storage.othersBytes,
      dailySeries: overview.storage.dailySeries.map(({ day, value }) => ({ day, value })),
      topImages: overview.storage.topImages.map((image) => ({
        id: image.id,
        displayName: image.displayName,
        originalFilename: image.originalFilename,
        sizeBytes: image.sizeBytes,
        thumbnailUrl: image.thumbnailUrl ?? null,
        mimeType: image.mimeType,
      })),
    },
    aiCredits: {
      balance: overview.aiCredits.balance,
      monthlyAllowance: overview.aiCredits.monthlyAllowance,
      resetAt: overview.aiCredits.resetAt ?? null,
      tier: overview.aiCredits.tier,
      dailySeries: overview.aiCredits.dailySeries.map(({ day, value }) => ({ day, value })),
      recentOperations: overview.aiCredits.recentOperations.map((operation) => ({
        id: operation.id,
        operationType: operation.operationType,
        quotaType: operation.quotaType,
        creditsUsed: operation.creditsUsed,
        creditsBefore: operation.creditsBefore,
        creditsAfter: operation.creditsAfter,
        referenceType: operation.referenceType ?? null,
        referenceId: operation.referenceId ?? null,
        status: operation.status,
        createdAt: operation.createdAt,
        metadata: operation.metadata ?? null,
      })),
    },
    faceRecognition: {
      remaining: overview.faceRecognition.remaining,
      monthlyAllowance: overview.faceRecognition.monthlyAllowance,
      resetAt: overview.faceRecognition.resetAt ?? null,
      facesCount: overview.faceRecognition.facesCount,
      dailySeries: overview.faceRecognition.dailySeries.map(({ day, value }) => ({ day, value })),
      topFaces: overview.faceRecognition.topFaces.map((person) => ({
        id: person.id,
        name: person.name,
        faceCount: person.faceCount,
        coverImageUrl: person.coverImageUrl ?? null,
      })),
    },
    creditCosts: data.creditCosts.map((cost) => ({
      operation: cost.operation,
      cost: cost.cost,
      description: cost.description,
      quotaType: cost.quotaType,
    })),
  };
}

function humanUsage(data: FullUsageQuery): string {
  const overview: UsageOverview = data.me.usageOverview;
  const storage = overview.storage;
  const credits = overview.aiCredits;
  const faces = overview.faceRecognition;
  return [
    section(
      "ACCOUNT",
      ["TIER", "USER ID"],
      [[data.me.tier, String(data.me.id)]],
      "No account usage found.",
    ),
    section(
      "STORAGE",
      ["USED", "QUOTA", "REMAINING", "ORIGINALS", "OTHERS"],
      [
        [
          formatBytes(storage.usedBytes),
          formatBytes(storage.quotaBytes),
          formatBytes(storage.remainingBytes),
          formatBytes(storage.originalsBytes),
          formatBytes(storage.othersBytes),
        ],
      ],
      "No storage usage found.",
    ),
    section(
      "STORAGE — LAST 30 DAYS",
      ["DAY", "UPLOADED"],
      storage.dailySeries.map((point) => [day(point.day), formatBytes(point.value)]),
      "No storage activity in the last 30 days.",
    ),
    section(
      "LARGEST PHOTOS",
      ["ID", "NAME", "SIZE", "TYPE"],
      storage.topImages.map((image) => [
        String(image.id),
        image.displayName || image.originalFilename,
        formatBytes(image.sizeBytes),
        image.mimeType,
      ]),
      "No photos found.",
    ),
    section(
      "AI CREDITS",
      ["BALANCE", "MONTHLY", "RESET", "TIER"],
      [
        [
          String(credits.balance),
          String(credits.monthlyAllowance),
          formatTimestamp(credits.resetAt),
          credits.tier,
        ],
      ],
      "No AI credit usage found.",
    ),
    section(
      "AI CREDITS — LAST 30 DAYS",
      ["DAY", "SPENT"],
      credits.dailySeries.map((point) => [day(point.day), String(point.value)]),
      "No AI credit usage in the last 30 days.",
    ),
    section(
      "RECENT AI OPERATIONS",
      ["ID", "OPERATION", "QUOTA", "USED", "BEFORE", "AFTER", "STATUS", "CREATED", "REFERENCE"],
      credits.recentOperations.map((operation) => [
        String(operation.id),
        operation.operationType,
        operation.quotaType,
        String(operation.creditsUsed),
        String(operation.creditsBefore),
        String(operation.creditsAfter),
        operation.status,
        formatTimestamp(operation.createdAt),
        operation.referenceType &&
        operation.referenceId !== null &&
        operation.referenceId !== undefined
          ? `${operation.referenceType}:${operation.referenceId}`
          : "—",
      ]),
      "No recent AI operations.",
    ),
    section(
      "AI OPERATION COSTS",
      ["OPERATION", "COST", "QUOTA", "DESCRIPTION"],
      data.creditCosts.map((cost) => [
        cost.operation,
        String(cost.cost),
        cost.quotaType,
        cost.description,
      ]),
      "No AI operation costs found.",
    ),
    section(
      "FACE RECOGNITION",
      ["REMAINING", "MONTHLY", "RESET", "FACES"],
      [
        [
          String(faces.remaining),
          String(faces.monthlyAllowance),
          formatTimestamp(faces.resetAt),
          String(faces.facesCount),
        ],
      ],
      "No face recognition usage found.",
    ),
    section(
      "FACE RECOGNITION — LAST 30 DAYS",
      ["DAY", "PHOTOS ANALYSED"],
      faces.dailySeries.map((point) => [day(point.day), String(point.value)]),
      "No face recognition activity in the last 30 days.",
    ),
    section(
      "TOP FACE MATCHES",
      ["ID", "NAME", "MATCHES"],
      faces.topFaces.map((person) => [
        String(person.id),
        person.name || `#${person.id}`,
        String(person.faceCount),
      ]),
      "No face matches found.",
    ),
  ].join("\n\n");
}

export async function runUsage(
  options: UsageOptions = {},
  dependencies: UsageDependencies = {},
): Promise<void> {
  const client = await createCommandClient(dependencies);
  const result = await client.graphql.query({ query: FullUsageDocument });
  if (result.error) throw result.error;
  if (!result.data?.me) throw new Error("The usage response did not include account usage data");
  output(
    dependencies,
    options.json ? formatJson({ usage: serializeUsage(result.data) }) : humanUsage(result.data),
  );
}
