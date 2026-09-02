import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { writeCredentials } from '../src/credentials.ts'
import { runMemory } from '../src/memory.ts'
import { runPricing } from '../src/pricing.ts'
import { runUploadSessionList } from '../src/uploads.ts'
import { runUsage } from '../src/usage.ts'
import { browserCommand, runWeb } from '../src/web.ts'
import { usageFixture } from './usage-fixture.ts'

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

describe('usage', () => {
  test('summarizes quotas and hides the detail sections by default', async () => {
    const paths = await authenticatedPaths()
    const fetch = graphqlFetch((body) => {
      expect(body.operationName).toBe('FullUsage')
      return Response.json({ data: usageFixture() })
    })
    const human: string[] = []
    await runUsage({}, { ...paths, fetch, stdout: (message) => human.push(message) })
    const output = human.join('\n')

    expect(output).toContain('Storage')
    expect(output).toContain('AI credits')
    expect(output).toContain('Face recognition')
    expect(output).toContain('━')
    expect(output).toContain('--detail')
    for (const section of [
      'last 30 days',
      'Recent AI operations',
      'Largest photos',
      'Top face matches',
      'AI operation costs',
    ]) {
      expect(output).not.toContain(section)
    }
  })

  test('adds charts, recent operations, and top lists with --detail', async () => {
    const paths = await authenticatedPaths()
    const fetch = graphqlFetch(() => Response.json({ data: usageFixture() }))
    const human: string[] = []
    await runUsage({ detail: true }, { ...paths, fetch, stdout: (message) => human.push(message) })
    const output = human.join('\n')

    for (const section of [
      'Storage · last 30 days',
      'Recent AI operations',
      'Largest photos',
      'Top face matches',
      'AI operation costs',
    ]) {
      expect(output).toContain(section)
    }
    // The chart baseline: proof the series rendered as a chart, not a table.
    expect(output).toContain('└')
    expect(output).not.toContain('--detail for daily charts')
  })

  test('keeps JSON complete and identical whether or not --detail is set', async () => {
    const paths = await authenticatedPaths()
    const fetch = graphqlFetch(() => Response.json({ data: usageFixture() }))

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

    const detailed: string[] = []
    await runUsage(
      { json: true, detail: true },
      { ...paths, fetch, stdout: (message) => detailed.push(message) },
    )
    expect(detailed.join('\n')).toBe(json.join('\n'))
  })
})

describe('memory', () => {
  test('renders the profile and its provenance, and emits JSON', async () => {
    const paths = await authenticatedPaths()
    const fetch = graphqlFetch((body) => {
      expect(body.operationName).toBe('UserMemory')
      return Response.json({
        data: {
          me: {
            id: 2,
            memory: {
              id: 7,
              content: 'Shoots wading birds at dawn around Kushiro.',
              generatedAt: 1_760_000_000,
              sourceImageCount: 100,
            },
          },
        },
      })
    })

    const human: string[] = []
    await runMemory({}, { ...paths, fetch, stdout: (message) => human.push(message) })
    expect(human[0]).toContain('Shoots wading birds at dawn around Kushiro.')
    expect(human[0]).toContain('Photos used')

    const json: string[] = []
    await runMemory({ json: true }, { ...paths, fetch, stdout: (message) => json.push(message) })
    expect(JSON.parse(json.join('\n'))).toMatchObject({
      memory: { id: 7, sourceImageCount: 100 },
    })
  })

  test('explains the empty state instead of printing nothing', async () => {
    const paths = await authenticatedPaths()
    const fetch = graphqlFetch(() => Response.json({ data: { me: { id: 2, memory: null } } }))

    const human: string[] = []
    await runMemory({}, { ...paths, fetch, stdout: (message) => human.push(message) })
    expect(human[0]).toContain('No memory yet')

    // `null` rather than an omitted key, so a script can branch on it.
    const json: string[] = []
    await runMemory({ json: true }, { ...paths, fetch, stdout: (message) => json.push(message) })
    expect(JSON.parse(json.join('\n'))).toEqual({ memory: null })
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
