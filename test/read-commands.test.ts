import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { writeCredentials } from '../src/credentials.ts'
import { runPricing } from '../src/pricing.ts'
import { runUploadSessionList } from '../src/uploads.ts'
import { runUsage } from '../src/usage.ts'
import { browserCommand, runWeb } from '../src/web.ts'

const temporaryDirectories: string[] = []

async function authenticatedPaths() {
  const directory = await mkdtemp(join(tmpdir(), 'rawback-read-commands-'))
  temporaryDirectories.push(directory)
  const credentialsPath = join(directory, 'credentials.json')
  const configPath = join(directory, 'config.yml')
  await writeCredentials({ token: 'token', refreshToken: 'refresh' }, credentialsPath)
  return { configPath, credentialsPath }
}

function graphqlFetch(
  handler: (body: Record<string, unknown>) => Response,
): typeof globalThis.fetch {
  return (async (_input, init) =>
    handler(JSON.parse(String(init?.body)) as Record<string, unknown>)) as typeof fetch
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('upload sessions', () => {
  test('filters, paginates, and emits named JSON', async () => {
    const paths = await authenticatedPaths()
    const lines: string[] = []
    await runUploadSessionList(
      { json: true, page: 3, pageSize: 5, status: 'failed' },
      {
        ...paths,
        fetch: graphqlFetch((body) => {
          expect(body.operationName).toBe('UploadSessions')
          expect(body.variables).toEqual({
            status: 'failed',
            pagination: { page: 3, pageSize: 5 },
          })
          return Response.json({
            data: {
              uploads: {
                edges: [
                  {
                    id: 4,
                    sessionId: 'session-4',
                    sftpSessionId: null,
                    sourceIP: '127.0.0.1',
                    sourceKind: 'sftp',
                    status: 'failed',
                    closedReason: 'timeout',
                    clientBanner: null,
                    geoCountry: null,
                    geoCity: null,
                    serverIP: null,
                    serverVersion: null,
                    serverCommit: null,
                    serverHostname: null,
                    serverOS: null,
                    totalFiles: 3,
                    processedFiles: 2,
                    failedFiles: 1,
                    totalBytes: 1024,
                    processingProgress: 0.67,
                    processingImageCount: 3,
                    processedImageCount: 2,
                    failedImageCount: 1,
                    completedAt: 120,
                    createdAt: 100,
                    updatedAt: 120,
                    credential: { id: 8, name: 'Camera' },
                  },
                ],
                pageInfo: {
                  page: 3,
                  pageSize: 5,
                  totalCount: 11,
                  totalPages: 3,
                  hasNextPage: false,
                  hasPreviousPage: true,
                },
              },
            },
          })
        }),
        stdout: (message) => lines.push(message),
      },
    )
    expect(JSON.parse(lines.join('\n'))).toMatchObject({
      uploads: [{ id: 4, credential: { name: 'Camera' } }],
      pageInfo: { page: 3, totalCount: 11 },
    })
  })
})

const usageData = {
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
        dailySeries: [{ day: 1_704_067_200, value: 512 }],
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
      },
      aiCredits: {
        balance: 80,
        monthlyAllowance: 100,
        resetAt: 1_704_153_600,
        tier: 'pro',
        dailySeries: [{ day: 1_704_067_200, value: 3 }],
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
            createdAt: 1_704_067_200,
            metadata: null,
          },
        ],
      },
      faceRecognition: {
        remaining: 90,
        monthlyAllowance: 100,
        resetAt: 1_704_153_600,
        facesCount: 12,
        dailySeries: [{ day: 1_704_067_200, value: 2 }],
        topFaces: [{ id: 3, name: 'Ada', faceCount: 8, coverImageUrl: null }],
      },
    },
  },
  creditCosts: [
    { operation: 'caption', cost: 3, description: 'Create a caption', quotaType: 'credits' },
  ],
}

describe('usage', () => {
  test('returns all web usage sections in human and JSON forms', async () => {
    const paths = await authenticatedPaths()
    const fetch = graphqlFetch((body) => {
      expect(body.operationName).toBe('FullUsage')
      return Response.json({ data: usageData })
    })
    const human: string[] = []
    await runUsage({}, { ...paths, fetch, stdout: (message) => human.push(message) })
    expect(human[0]).toContain('Storage · last 30 days')
    expect(human[0]).toContain('Recent AI operations')
    expect(human[0]).toContain('Top face matches')

    const json: string[] = []
    await runUsage({ json: true }, { ...paths, fetch, stdout: (message) => json.push(message) })
    expect(JSON.parse(json.join('\n'))).toMatchObject({
      usage: {
        userId: 2,
        storage: { topImages: [{ id: 9 }] },
        aiCredits: { recentOperations: [{ id: 5 }] },
        faceRecognition: { topFaces: [{ name: 'Ada' }] },
      },
    })
  })
})

describe('pricing', () => {
  test('is public and filters yearly plans while retaining free and add-ons', async () => {
    const lines: string[] = []
    await runPricing(
      { interval: 'year', json: true },
      {
        configPath: join(tmpdir(), 'rawback-missing-config.yml'),
        fetch: graphqlFetch((body) => {
          expect(body.operationName).toBe('CliPricing')
          return Response.json({
            data: {
              pricing: {
                tiers: [
                  {
                    id: 'free',
                    name: 'Free',
                    price: 0,
                    billingInterval: 'month',
                    storageGB: 5,
                    creditsPerMonth: 10,
                    faceRecPerMonth: 10,
                    sharingPublic: true,
                    sharingRestricted: false,
                    sharingUnlimited: false,
                    priorityProcessing: false,
                  },
                  {
                    id: 'pro',
                    name: 'Pro',
                    price: 1000,
                    billingInterval: 'month',
                    storageGB: 100,
                    creditsPerMonth: 100,
                    faceRecPerMonth: 100,
                    sharingPublic: true,
                    sharingRestricted: true,
                    sharingUnlimited: false,
                    priorityProcessing: true,
                  },
                  {
                    id: 'pro_yearly',
                    name: 'Pro',
                    price: 10000,
                    billingInterval: 'year',
                    storageGB: 100,
                    creditsPerMonth: 100,
                    faceRecPerMonth: 100,
                    sharingPublic: true,
                    sharingRestricted: true,
                    sharingUnlimited: false,
                    priorityProcessing: true,
                  },
                ],
                addOns: [
                  {
                    id: 'storage-100',
                    name: 'Storage',
                    price: 500,
                    kind: 'storage',
                    amount: 100,
                    description: '100 GB',
                  },
                ],
              },
            },
          })
        }),
        stdout: (message) => lines.push(message),
      },
    )
    const pricing = JSON.parse(lines.join('\n')).pricing
    expect(pricing.tiers.map((tier: { id: string }) => tier.id)).toEqual(['free', 'pro_yearly'])
    expect(pricing.addOns).toHaveLength(1)
  })
})

describe('web', () => {
  test('opens the configured authenticated profile without shell interpolation', async () => {
    const paths = await authenticatedPaths()
    await Bun.write(paths.configPath, 'webHost: https://staging.rawback.app/\n')
    const opened: Array<{ command: string; args: string[] }> = []
    const lines: string[] = []
    await runWeb({
      ...paths,
      platform: 'linux',
      fetch: graphqlFetch(() =>
        Response.json({
          data: {
            me: {
              id: 1,
              name: 'Ada',
              email: 'ada@example.com',
              slug: 'ada lovelace',
              tier: 'pro',
              subscriptionStatus: 'active',
              accountStatus: 'active',
            },
          },
        }),
      ),
      async open(command, args) {
        opened.push({ command, args })
        return 0
      },
      stdout: (message) => lines.push(message),
    })
    expect(opened).toEqual([
      {
        command: 'xdg-open',
        args: ['https://staging.rawback.app/users/ada%20lovelace'],
      },
    ])
    expect(lines[0]).toContain('Opened https://staging.rawback.app/users/ada%20lovelace')
  })

  test('selects platform-specific browser commands', () => {
    expect(browserCommand('darwin', 'https://rawback.app')).toEqual([
      'open',
      ['https://rawback.app'],
    ])
    expect(browserCommand('win32', 'https://rawback.app')).toEqual([
      'cmd',
      ['/c', 'start', '', 'https://rawback.app'],
    ])
  })
})
