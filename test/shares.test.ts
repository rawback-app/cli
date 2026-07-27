import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { writeCredentials } from '../src/credentials.ts'
import {
  clipboardCommand,
  type ShareCommandDependencies,
  runShareArchive,
  runShareDelete,
  runShareDisable,
  runShareEnable,
  runShareGet,
  runShareLink,
  runShareList,
  runShareRecipients,
  validateShareListOptions,
} from '../src/shares.ts'

const temporaryDirectories: string[] = []

async function temporaryDependencies(
  handler: (body: Record<string, unknown>) => Response | Promise<Response>,
  overrides: Partial<ShareCommandDependencies> = {},
): Promise<ShareCommandDependencies> {
  const directory = await mkdtemp(join(tmpdir(), 'rawback-shares-'))
  temporaryDirectories.push(directory)
  const credentialsPath = join(directory, 'credentials.json')
  await writeCredentials({ token: 'access-token', refreshToken: 'refresh-token' }, credentialsPath)
  return {
    configPath: join(directory, 'config.yml'),
    credentialsPath,
    fetch: (async (_input, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer access-token')
      return handler(JSON.parse(String(init?.body)) as Record<string, unknown>)
    }) as typeof fetch,
    ...overrides,
  }
}

function pagination(page = 1, pageSize = 20, totalCount = 1, totalPages = 1) {
  return {
    page,
    pageSize,
    totalCount,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
  }
}

const recipient = {
  id: 17,
  email: 'friend@example.com',
  lastAccessedAt: 1_704_153_600,
  createdAt: 1_704_067_200,
}

const image = {
  id: 11,
  filename: 'waterfall.jpg',
  displayName: 'Waterfall',
  thumbnailUrl: 'https://cdn.example/waterfall-thumb.jpg',
}

const album = {
  id: 12,
  name: 'Iceland',
  imageCount: 8,
  coverImage: { id: 11, thumbnailUrl: 'https://cdn.example/cover.jpg' },
}

const dream = {
  id: 13,
  title: 'A winter day',
  dreamDate: '2024-01-03',
  photoCount: 5,
  imageUrl: 'https://cdn.example/dream.jpg',
}

const share = {
  id: 7,
  code: 'abc123',
  shareType: 'image',
  accessType: 'restricted',
  title: 'Waterfall for friends',
  description: 'A favorite photo',
  frameKind: 'none',
  showExif: true,
  minRating: null,
  permission: { allowDownload: true, allowOriginalDownload: false },
  expiresAt: null,
  isExpired: false,
  viewCount: 4,
  enabled: true,
  status: 'active',
  url: 'https://rawback.app/s/abc123',
  image,
  album: null,
  recipients: [recipient],
  createdAt: 1_704_067_200,
  updatedAt: 1_704_153_600,
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

describe('share commands', () => {
  test('validates filters and date-only boundaries', () => {
    expect(
      validateShareListOptions({
        scope: 'by-me',
        type: 'photo',
        after: '2024-01-01',
        before: '2024-01-31',
        page: 1,
        pageSize: 20,
      }),
    ).toMatchObject({
      scope: 'by-me',
      resourceType: 'image',
      status: 'active',
      after: 1_704_067_200,
      before: 1_706_745_599.999,
    })
    expect(() =>
      validateShareListOptions({
        scope: 'with-me',
        status: 'archived',
        page: 1,
        pageSize: 20,
      }),
    ).toThrow('only apply to --scope by-me')
    expect(() =>
      validateShareListOptions({
        type: 'dream',
        kind: 'link',
        page: 1,
        pageSize: 20,
      }),
    ).toThrow('Dreams can only be shared directly')
    expect(() =>
      validateShareListOptions({
        kind: 'direct',
        enabled: false,
        page: 1,
        pageSize: 20,
      }),
    ).toThrow('do not apply to direct shares')
    expect(() =>
      validateShareListOptions({
        after: '2024-02-01',
        before: '2024-01-01',
        page: 1,
        pageSize: 20,
      }),
    ).toThrow('must not be later')
  })

  test('lists active outgoing links with stable JSON', async () => {
    const output: string[] = []
    const dependencies = await temporaryDependencies(
      (body) => {
        expect(body.operationName).toBe('CliSharedByMe')
        expect(body.variables).toEqual({
          resourceType: 'image',
          pagination: { page: 2, pageSize: 20 },
        })
        return Response.json({
          data: {
            sharedByMe: {
              edges: [
                {
                  id: 'link:7',
                  kind: 'link',
                  resourceType: 'image',
                  createdAt: share.createdAt,
                  recipientCount: 0,
                  recipients: [],
                  image,
                  album: null,
                  dream: null,
                  link: share,
                },
              ],
              pageInfo: pagination(2, 20, 21, 2),
            },
          },
        })
      },
      { stdout: (message) => output.push(message) },
    )

    await runShareList(
      { scope: 'by-me', type: 'photo', page: 2, pageSize: 20, json: true },
      dependencies,
    )

    expect(JSON.parse(output[0] ?? '')).toMatchObject({
      scope: 'by-me',
      shares: [
        {
          id: 'link:7',
          kind: 'link',
          shareId: 7,
          resourceType: 'image',
          resourceId: 11,
          recipientCount: 1,
          link: { url: share.url, accessType: 'restricted', enabled: true },
        },
      ],
      pageInfo: { page: 2, totalCount: 21 },
    })
  })

  test('walks pages before applying incoming date filters and pagination', async () => {
    const output: string[] = []
    const requestedPages: number[] = []
    const dependencies = await temporaryDependencies(
      (body) => {
        expect(body.operationName).toBe('CliSharedWithMe')
        const variables = body.variables as { pagination: { page: number; pageSize: number } }
        requestedPages.push(variables.pagination.page)
        expect(variables.pagination.pageSize).toBe(100)
        const currentPage = variables.pagination.page
        const edge = {
          id: currentPage,
          resourceType: currentPage === 1 ? 'album' : 'dream',
          resourceId: currentPage === 1 ? album.id : dream.id,
          createdAt: currentPage === 1 ? 1_704_067_200 : 1_704_240_000,
          owner: { id: 31, name: 'Alex', avatar: null, slug: 'alex' },
          image: null,
          album: currentPage === 1 ? album : null,
          dream: currentPage === 2 ? dream : null,
        }
        return Response.json({
          data: {
            sharedWithMe: {
              edges: [edge],
              pageInfo: pagination(currentPage, 100, 2, 2),
            },
          },
        })
      },
      { stdout: (message) => output.push(message) },
    )

    await runShareList(
      {
        scope: 'with-me',
        after: '2024-01-02',
        page: 1,
        pageSize: 1,
        json: true,
      },
      dependencies,
    )

    expect(requestedPages).toEqual([1, 2])
    expect(JSON.parse(output[0] ?? '')).toMatchObject({
      shares: [{ grantId: 2, resourceType: 'dream', owner: { slug: 'alex' } }],
      pageInfo: { pageSize: 1, totalCount: 1, totalPages: 1 },
    })
  })

  test('filters archived link shares locally', async () => {
    const output: string[] = []
    const archivedAlbumShare = {
      ...share,
      id: 8,
      code: 'album123',
      shareType: 'album',
      title: null,
      accessType: 'public',
      status: 'archived',
      enabled: false,
      url: 'https://rawback.app/s/album123',
      image: null,
      album,
      recipients: [],
    }
    const dependencies = await temporaryDependencies(
      (body) => {
        expect(body.operationName).toBe('CliShares')
        expect(body.variables).toEqual({
          status: 'archived',
          pagination: { page: 1, pageSize: 100 },
        })
        return Response.json({
          data: {
            shares: {
              edges: [archivedAlbumShare, { ...share, status: 'archived' }],
              pageInfo: pagination(1, 100, 2),
            },
          },
        })
      },
      { stdout: (message) => output.push(message), now: () => 1_800_000_000 },
    )

    await runShareList(
      {
        status: 'archived',
        type: 'album',
        enabled: false,
        access: 'public',
        expiry: 'never',
        page: 1,
        pageSize: 20,
        json: true,
      },
      dependencies,
    )

    expect(JSON.parse(output[0] ?? '')).toMatchObject({
      shares: [{ shareId: 8, resourceType: 'album', link: { enabled: false } }],
      pageInfo: { totalCount: 1 },
    })
  })

  test('gets details, recipients, and raw or copied links', async () => {
    const output: string[] = []
    const copied: string[] = []
    const dependencies = await temporaryDependencies(
      (body) => {
        expect(body.operationName).toBe('CliShare')
        expect(body.variables).toEqual({ id: 7 })
        return Response.json({ data: { share } })
      },
      {
        stdout: (message) => output.push(message),
        copy: async (value) => {
          copied.push(value)
        },
      },
    )

    await runShareGet({ id: 7, json: true }, dependencies)
    await runShareRecipients({ id: 7, json: true }, dependencies)
    await runShareLink({ id: 7 }, dependencies)
    await runShareLink({ id: 7, copy: true, json: true }, dependencies)

    expect(JSON.parse(output[0] ?? '')).toMatchObject({
      share: { id: 7, resource: { id: 11 }, recipients: [{ email: recipient.email }] },
    })
    expect(JSON.parse(output[1] ?? '')).toEqual({ shareId: 7, recipients: [recipient] })
    expect(output[2]).toBe(share.url)
    expect(JSON.parse(output[3] ?? '')).toEqual({ id: 7, url: share.url, copied: true })
    expect(copied).toEqual([share.url])
  })

  test('updates link states and rejects enabling expired shares', async () => {
    const inputs: unknown[] = []
    const output: string[] = []
    const dependencies = await temporaryDependencies(
      (body) => {
        if (body.operationName === 'CliShare') return Response.json({ data: { share } })
        expect(body.operationName).toBe('CliUpdateShare')
        const variables = body.variables as { input: Record<string, unknown> }
        inputs.push(variables.input)
        return Response.json({
          data: { updateShare: { ...share, ...variables.input, id: 7 } },
        })
      },
      { stdout: (message) => output.push(message) },
    )

    await runShareArchive({ id: 7, json: true }, dependencies)
    await runShareDisable({ id: 7 }, dependencies)
    await runShareEnable({ id: 7 }, dependencies)
    expect(inputs).toEqual([
      { id: 7, status: 'archived' },
      { id: 7, enabled: false },
      { id: 7, enabled: true },
    ])
    expect(JSON.parse(output[0] ?? '')).toMatchObject({ share: { id: 7, status: 'archived' } })
    expect(output[1]).toBe('✓ Disabled share 7.')
    expect(output[2]).toBe('✓ Enabled share 7.')

    let mutations = 0
    const expiredDependencies = await temporaryDependencies((body) => {
      if (body.operationName === 'CliShare') {
        return Response.json({ data: { share: { ...share, isExpired: true } } })
      }
      mutations += 1
      return Response.json({ data: { updateShare: share } })
    })
    await expect(runShareEnable({ id: 7 }, expiredDependencies)).rejects.toThrow('has expired')
    expect(mutations).toBe(0)
  })

  test('cancels and force-deletes shares safely', async () => {
    const output: string[] = []
    let deletes = 0
    const cancelled = await temporaryDependencies(
      (body) => {
        if (body.operationName === 'CliShare') return Response.json({ data: { share } })
        deletes += 1
        return Response.json({ data: { deleteShare: true } })
      },
      {
        stdout: (message) => output.push(message),
        prompts: { confirm: async () => false },
      },
    )
    await runShareDelete({ id: 7, json: true }, cancelled)
    expect(JSON.parse(output[0] ?? '')).toEqual({ deleted: false, id: 7 })
    expect(deletes).toBe(0)

    const forced = await temporaryDependencies(
      (body) => {
        expect(body.operationName).toBe('CliDeleteShare')
        deletes += 1
        return Response.json({ data: { deleteShare: true } })
      },
      { stdout: (message) => output.push(message) },
    )
    await runShareDelete({ id: 7, force: true, json: true }, forced)
    expect(JSON.parse(output[1] ?? '')).toEqual({ deleted: true, id: 7 })
    expect(deletes).toBe(1)
  })

  test('selects native clipboard commands without adding a dependency', () => {
    expect(clipboardCommand('darwin')).toEqual({ command: 'pbcopy', args: [] })
    expect(clipboardCommand('win32')).toEqual({ command: 'clip.exe', args: [] })
    expect(
      clipboardCommand('linux', (command) => (command === 'wl-copy' ? '/bin/wl-copy' : null)),
    ).toEqual({ command: 'wl-copy', args: [] })
    expect(
      clipboardCommand('linux', (command) => (command === 'xclip' ? '/bin/xclip' : null)),
    ).toEqual({ command: 'xclip', args: ['-selection', 'clipboard'] })
    expect(() => clipboardCommand('linux', () => null)).toThrow('No supported clipboard utility')
  })
})
