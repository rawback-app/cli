import { type FullUsageQuery } from '@rawback/sdk'

const DAY = 86_400
/** 2024-01-01T00:00:00Z. */
const START = 1_704_067_200

type Overview = FullUsageQuery['me']['usageOverview']

function series(values: number[]): Array<{ day: number; value: number }> {
  return values.map((value, index) => ({ day: START + index * DAY, value }))
}

export interface UsageFixtureOverrides {
  storage?: Partial<Overview['storage']>
  aiCredits?: Partial<Overview['aiCredits']>
  faceRecognition?: Partial<Overview['faceRecognition']>
}

/**
 * A complete `FullUsage` payload. Amounts are small and exact so assertions can
 * name them, and every series spans several days so charts and bucketing are
 * actually exercised.
 */
export function usageFixture(overrides: UsageFixtureOverrides = {}): FullUsageQuery {
  return {
    me: {
      id: 2,
      tier: 'pro',
      usageOverview: {
        storage: {
          usedBytes: 1024,
          quotaBytes: 4096,
          remainingBytes: 3072,
          originalsBytes: 800,
          othersBytes: 224,
          dailySeries: series([512, 0, 128, 0, 384]),
          topImages: [
            {
              id: 9,
              displayName: 'Large photo',
              originalFilename: 'large.raf',
              sizeBytes: 800,
              thumbnailUrl: null,
              mimeType: 'image/x-fuji-raf',
            },
          ],
          ...overrides.storage,
        },
        aiCredits: {
          // The API reports the balance that is LEFT, not the amount spent.
          balance: 80,
          monthlyAllowance: 100,
          resetAt: 1_704_153_600,
          tier: 'pro',
          dailySeries: series([3, 0, 7, 0, 10]),
          recentOperations: [
            {
              id: 5,
              operationType: 'caption',
              quotaType: 'credits',
              creditsUsed: 3,
              creditsBefore: 83,
              creditsAfter: 80,
              referenceType: 'image',
              referenceId: 9,
              status: 'completed',
              createdAt: START,
              metadata: null,
            },
          ],
          ...overrides.aiCredits,
        },
        faceRecognition: {
          remaining: 90,
          monthlyAllowance: 100,
          resetAt: 1_704_153_600,
          facesCount: 12,
          dailySeries: series([2, 0, 4, 0, 4]),
          topFaces: [{ id: 3, name: 'Ada', faceCount: 8, coverImageUrl: null }],
          ...overrides.faceRecognition,
        },
      },
    },
    creditCosts: [
      { operation: 'caption', cost: 3, description: 'Create a caption', quotaType: 'credits' },
    ],
  }
}
