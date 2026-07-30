import { commandOutput, createCommandClient, type ReadCommandDependencies } from "./command.ts";
import { usageDocument } from "./features/usage/view.ts";
import { FullUsageDocument, type FullUsageQuery } from "@rawback/sdk";

export interface UsageOptions {
  json?: boolean;
}

export type UsageDependencies = ReadCommandDependencies;

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

export async function runUsage(
  options: UsageOptions = {},
  dependencies: UsageDependencies = {},
): Promise<void> {
  const ui = commandOutput(dependencies);
  const result = await ui.withActivity(
    "Loading usage…",
    async () => {
      const client = await createCommandClient(dependencies);
      return client.graphql.query({ query: FullUsageDocument });
    },
    !options.json,
  );
  if (result.error) throw result.error;
  if (!result.data?.me) throw new Error("The usage response did not include account usage data");
  if (options.json) {
    ui.json({ usage: serializeUsage(result.data) });
    return;
  }
  ui.document(usageDocument(result.data));
}
