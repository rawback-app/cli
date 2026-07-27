import type { RawbackClient } from './client.ts'
import {
  createCommandClient,
  commandOutput,
  type ReadCommandDependencies,
  validatePagination,
} from './command.ts'
import {
  shareDetailDocument,
  shareListDocument,
  shareRecipientsDocument,
} from './features/shares/view.ts'
import { type FragmentType, useFragment } from './gql/fragment-masking.ts'
import {
  type CliLinkShareFieldsFragment,
  CliLinkShareFieldsFragmentDoc,
  type CliShareAlbumFieldsFragment,
  CliShareAlbumFieldsFragmentDoc,
  CliShareDocument,
  type CliShareDreamFieldsFragment,
  CliShareDreamFieldsFragmentDoc,
  type CliShareImageFieldsFragment,
  CliShareImageFieldsFragmentDoc,
  CliSharedByMeDocument,
  type CliSharedByMeQuery,
  CliSharedWithMeDocument,
  type CliSharedWithMeQuery,
  type CliShareRecipientFieldsFragment,
  CliShareRecipientFieldsFragmentDoc,
  CliSharesDocument,
  type CliShareUserFieldsFragment,
  CliShareUserFieldsFragmentDoc,
  CliUpdateShareDocument,
  CliDeleteShareDocument,
  OutgoingShareKind,
  ShareAccessType,
  ShareResourceType,
  ShareStatus,
  type UpdateShareInput,
} from './gql/graphql.ts'

export type ShareScope = 'by-me' | 'with-me'
export type ShareKindFilter = 'link' | 'direct'
export type ShareTypeFilter = 'photo' | 'album' | 'dream'
export type ShareExpiryFilter = 'valid' | 'expired' | 'never'

export interface SharePrompts {
  confirm(message: string): Promise<boolean>
}

export interface ShareCommandDependencies extends ReadCommandDependencies {
  copy?: (value: string) => Promise<void>
  now?: () => number
  prompts?: SharePrompts
}

export interface ShareListOptions {
  access?: 'public' | 'restricted'
  after?: string
  before?: string
  enabled?: boolean
  expiry?: ShareExpiryFilter
  json?: boolean
  kind?: ShareKindFilter
  page: number
  pageSize: number
  scope?: ShareScope
  status?: 'active' | 'archived'
  type?: ShareTypeFilter
}

export interface ShareIdOptions {
  id: number
  json?: boolean
}

export interface ShareDeleteOptions extends ShareIdOptions {
  force?: boolean
}

export interface ShareLinkOptions extends ShareIdOptions {
  copy?: boolean
}

export interface ShareResourceSummary {
  id: number
  imageCount: number | null
  photoCount: number | null
  thumbnailUrl: string | null
  title: string
  type: ShareResourceType
}

export interface SerializedShareUser {
  avatar: string | null
  id: number
  name: string
  slug: string
}

export interface SerializedShareLink {
  accessType: ShareAccessType
  enabled: boolean
  expiresAt: number | null
  id: number
  isExpired: boolean
  status: ShareStatus
  url: string
  viewCount: number
}

export interface ShareListItem {
  createdAt: number
  grantId: number | null
  id: string
  kind: OutgoingShareKind
  link: SerializedShareLink | null
  owner: SerializedShareUser | null
  recipientCount: number
  recipients: SerializedShareUser[]
  resource: ShareResourceSummary
  resourceId: number
  resourceType: ShareResourceType
  shareId: number | null
  title: string
}

export interface SharePageInfo {
  hasNextPage: boolean
  hasPreviousPage: boolean
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
}

export interface SerializedShareRecipient {
  createdAt: number
  email: string
  id: number
  lastAccessedAt: number | null
}

export interface SerializedLinkShare {
  accessType: ShareAccessType
  code: string
  createdAt: number
  description: string | null
  enabled: boolean
  expiresAt: number | null
  frameKind: string
  id: number
  isExpired: boolean
  minRating: number | null
  permission: {
    allowDownload: boolean
    allowOriginalDownload: boolean
  }
  recipients: SerializedShareRecipient[]
  resource: ShareResourceSummary
  shareType: string
  showExif: boolean
  status: ShareStatus
  title: string | null
  updatedAt: number
  url: string
  viewCount: number
}

interface ValidatedShareList {
  access?: ShareAccessType
  after?: number
  before?: number
  enabled?: boolean
  expiry?: ShareExpiryFilter
  kind?: OutgoingShareKind
  page: number
  pageSize: number
  resourceType?: ShareResourceType
  scope: ShareScope
  status?: ShareStatus
}

type OutgoingEdge = CliSharedByMeQuery['sharedByMe']['edges'][number]
type IncomingEdge = CliSharedWithMeQuery['sharedWithMe']['edges'][number]

function validateShareId(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Share ID must be a positive integer')
  }
  return value
}

function parseDateBoundary(value: string, option: string, endOfDay: boolean): number {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    throw new Error(`${option} must be an ISO date/time or Unix timestamp in seconds`)
  }
  const numeric = Number(trimmed)
  if (Number.isFinite(numeric)) return numeric

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (dateOnly) {
    const parsed = Date.parse(`${trimmed}T00:00:00.000Z`)
    if (Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === trimmed) {
      return parsed / 1000 + (endOfDay ? 86_399.999 : 0)
    }
  } else {
    const parsed = Date.parse(trimmed)
    if (Number.isFinite(parsed)) return parsed / 1000
  }
  throw new Error(`${option} must be an ISO date/time or Unix timestamp in seconds`)
}

function resourceType(value: ShareTypeFilter | undefined): ShareResourceType | undefined {
  switch (value) {
    case 'photo':
      return ShareResourceType.Image
    case 'album':
      return ShareResourceType.Album
    case 'dream':
      return ShareResourceType.Dream
    case undefined:
      return undefined
    default:
      throw new Error('--type must be one of: photo, album, dream')
  }
}

export function validateShareListOptions(options: ShareListOptions): ValidatedShareList {
  validatePagination(options.page, options.pageSize)
  const scope = options.scope ?? 'by-me'
  if (scope !== 'by-me' && scope !== 'with-me') {
    throw new Error('--scope must be one of: by-me, with-me')
  }
  const type = resourceType(options.type)
  const after =
    options.after === undefined ? undefined : parseDateBoundary(options.after, '--after', false)
  const before =
    options.before === undefined ? undefined : parseDateBoundary(options.before, '--before', true)
  if (after !== undefined && before !== undefined && after > before) {
    throw new Error('--after must not be later than --before')
  }

  const kind =
    options.kind === undefined
      ? undefined
      : options.kind === 'link'
        ? OutgoingShareKind.Link
        : options.kind === 'direct'
          ? OutgoingShareKind.Direct
          : undefined
  if (options.kind !== undefined && kind === undefined) {
    throw new Error('--kind must be one of: link, direct')
  }
  const status =
    options.status === undefined
      ? scope === 'by-me'
        ? ShareStatus.Active
        : undefined
      : options.status === 'active'
        ? ShareStatus.Active
        : options.status === 'archived'
          ? ShareStatus.Archived
          : undefined
  if (options.status !== undefined && status === undefined) {
    throw new Error('--status must be one of: active, archived')
  }
  const access =
    options.access === undefined
      ? undefined
      : options.access === 'public'
        ? ShareAccessType.Public
        : options.access === 'restricted'
          ? ShareAccessType.Restricted
          : undefined
  if (options.access !== undefined && access === undefined) {
    throw new Error('--access must be one of: public, restricted')
  }
  if (
    options.expiry !== undefined &&
    options.expiry !== 'valid' &&
    options.expiry !== 'expired' &&
    options.expiry !== 'never'
  ) {
    throw new Error('--expiry must be one of: valid, expired, never')
  }

  const hasLinkOnlyFilter =
    options.enabled !== undefined || access !== undefined || options.expiry !== undefined
  if (scope === 'with-me') {
    if (options.status !== undefined || hasLinkOnlyFilter) {
      throw new Error(
        '--status, --enabled, --access, and --expiry only apply to --scope by-me link shares',
      )
    }
    if (kind === OutgoingShareKind.Link) {
      throw new Error('--scope with-me only contains direct shares')
    }
  }
  if (scope === 'by-me' && kind === OutgoingShareKind.Direct) {
    if (status === ShareStatus.Archived || hasLinkOnlyFilter) {
      throw new Error('Archived, enabled, access, and expiry filters do not apply to direct shares')
    }
  }
  if (
    type === ShareResourceType.Dream &&
    (kind === OutgoingShareKind.Link || status === ShareStatus.Archived || hasLinkOnlyFilter)
  ) {
    throw new Error('Dreams can only be shared directly, not through link shares')
  }

  return {
    page: options.page,
    pageSize: options.pageSize,
    scope,
    ...(type !== undefined ? { resourceType: type } : {}),
    ...(kind !== undefined ? { kind } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(access !== undefined ? { access } : {}),
    ...(options.enabled !== undefined ? { enabled: options.enabled } : {}),
    ...(options.expiry !== undefined ? { expiry: options.expiry } : {}),
    ...(after !== undefined ? { after } : {}),
    ...(before !== undefined ? { before } : {}),
  }
}

function pageInfo(value: SharePageInfo): SharePageInfo {
  return {
    page: value.page,
    pageSize: value.pageSize,
    totalCount: value.totalCount,
    totalPages: value.totalPages,
    hasNextPage: value.hasNextPage,
    hasPreviousPage: value.hasPreviousPage,
  }
}

function localPage(items: ShareListItem[], page: number, pageSize: number) {
  const totalCount = items.length
  const totalPages = Math.ceil(totalCount / pageSize)
  const start = (page - 1) * pageSize
  return {
    items: items.slice(start, start + pageSize),
    pageInfo: pageInfo({
      page,
      pageSize,
      totalCount,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    }),
  }
}

function linkFragment(
  value: FragmentType<typeof CliLinkShareFieldsFragmentDoc>,
): CliLinkShareFieldsFragment {
  return useFragment(CliLinkShareFieldsFragmentDoc, value)
}

function userFragment(
  value: FragmentType<typeof CliShareUserFieldsFragmentDoc>,
): CliShareUserFieldsFragment {
  return useFragment(CliShareUserFieldsFragmentDoc, value)
}

function imageFragment(
  value: FragmentType<typeof CliShareImageFieldsFragmentDoc>,
): CliShareImageFieldsFragment {
  return useFragment(CliShareImageFieldsFragmentDoc, value)
}

function albumFragment(
  value: FragmentType<typeof CliShareAlbumFieldsFragmentDoc>,
): CliShareAlbumFieldsFragment {
  return useFragment(CliShareAlbumFieldsFragmentDoc, value)
}

function dreamFragment(
  value: FragmentType<typeof CliShareDreamFieldsFragmentDoc>,
): CliShareDreamFieldsFragment {
  return useFragment(CliShareDreamFieldsFragmentDoc, value)
}

function recipientFragment(
  value: FragmentType<typeof CliShareRecipientFieldsFragmentDoc>,
): CliShareRecipientFieldsFragment {
  return useFragment(CliShareRecipientFieldsFragmentDoc, value)
}

function serializeUser(user: CliShareUserFieldsFragment): SerializedShareUser {
  return {
    id: user.id,
    name: user.name,
    slug: user.slug,
    avatar: user.avatar ?? null,
  }
}

function serializeRecipient(recipient: CliShareRecipientFieldsFragment): SerializedShareRecipient {
  return {
    id: recipient.id,
    email: recipient.email,
    lastAccessedAt: recipient.lastAccessedAt ?? null,
    createdAt: recipient.createdAt,
  }
}

function imageResource(image: CliShareImageFieldsFragment): ShareResourceSummary {
  return {
    id: image.id,
    type: ShareResourceType.Image,
    title: image.displayName || image.filename,
    thumbnailUrl: image.thumbnailUrl ?? null,
    imageCount: null,
    photoCount: null,
  }
}

function albumResource(album: CliShareAlbumFieldsFragment): ShareResourceSummary {
  return {
    id: album.id,
    type: ShareResourceType.Album,
    title: album.name,
    thumbnailUrl: album.coverImage?.thumbnailUrl ?? null,
    imageCount: album.imageCount,
    photoCount: null,
  }
}

function dreamResource(dream: CliShareDreamFieldsFragment): ShareResourceSummary {
  return {
    id: dream.id,
    type: ShareResourceType.Dream,
    title: dream.title || dream.dreamDate,
    thumbnailUrl: dream.imageUrl ?? null,
    imageCount: null,
    photoCount: dream.photoCount,
  }
}

function resourceFromParts(
  type: ShareResourceType,
  values: {
    album?: FragmentType<typeof CliShareAlbumFieldsFragmentDoc> | null
    dream?: FragmentType<typeof CliShareDreamFieldsFragmentDoc> | null
    image?: FragmentType<typeof CliShareImageFieldsFragmentDoc> | null
  },
): ShareResourceSummary {
  if (type === ShareResourceType.Image && values.image) {
    return imageResource(imageFragment(values.image))
  }
  if (type === ShareResourceType.Album && values.album) {
    return albumResource(albumFragment(values.album))
  }
  if (type === ShareResourceType.Dream && values.dream) {
    return dreamResource(dreamFragment(values.dream))
  }
  throw new Error(`The shares response did not include the ${type} resource`)
}

function serializeShareLink(share: CliLinkShareFieldsFragment): SerializedShareLink {
  return {
    id: share.id,
    url: share.url,
    accessType: share.accessType,
    status: share.status,
    enabled: share.enabled,
    expiresAt: share.expiresAt ?? null,
    isExpired: share.isExpired,
    viewCount: share.viewCount,
  }
}

export function serializeLinkShare(share: CliLinkShareFieldsFragment): SerializedLinkShare {
  const type = share.shareType === 'image' ? ShareResourceType.Image : ShareResourceType.Album
  const resource = resourceFromParts(type, share)
  return {
    id: share.id,
    code: share.code,
    shareType: share.shareType,
    accessType: share.accessType,
    title: share.title ?? null,
    description: share.description ?? null,
    frameKind: share.frameKind,
    showExif: share.showExif,
    minRating: share.minRating ?? null,
    permission: {
      allowDownload: share.permission.allowDownload,
      allowOriginalDownload: share.permission.allowOriginalDownload,
    },
    expiresAt: share.expiresAt ?? null,
    isExpired: share.isExpired,
    viewCount: share.viewCount,
    enabled: share.enabled,
    status: share.status,
    url: share.url,
    resource,
    recipients: share.recipients.map((recipient) =>
      serializeRecipient(recipientFragment(recipient)),
    ),
    createdAt: share.createdAt,
    updatedAt: share.updatedAt,
  }
}

function outgoingItem(edge: OutgoingEdge): ShareListItem {
  const resource = resourceFromParts(edge.resourceType, edge)
  if (edge.kind === OutgoingShareKind.Link) {
    if (!edge.link) throw new Error(`Outgoing share ${edge.id} did not include link details`)
    const link = linkFragment(edge.link)
    return {
      id: edge.id,
      kind: edge.kind,
      shareId: link.id,
      grantId: null,
      resourceType: edge.resourceType,
      resourceId: resource.id,
      resource,
      title: link.title || resource.title,
      createdAt: edge.createdAt,
      owner: null,
      recipients: [],
      recipientCount: link.recipients.length,
      link: serializeShareLink(link),
    }
  }
  const recipients = edge.recipients.map((recipient) => serializeUser(userFragment(recipient)))
  return {
    id: edge.id,
    kind: edge.kind,
    shareId: null,
    grantId: null,
    resourceType: edge.resourceType,
    resourceId: resource.id,
    resource,
    title: resource.title,
    createdAt: edge.createdAt,
    owner: null,
    recipients,
    recipientCount: edge.recipientCount,
    link: null,
  }
}

function incomingItem(edge: IncomingEdge): ShareListItem {
  const resource = resourceFromParts(edge.resourceType, edge)
  return {
    id: `direct:${edge.id}`,
    kind: OutgoingShareKind.Direct,
    shareId: null,
    grantId: edge.id,
    resourceType: edge.resourceType,
    resourceId: edge.resourceId,
    resource,
    title: resource.title,
    createdAt: edge.createdAt,
    owner: serializeUser(userFragment(edge.owner)),
    recipients: [],
    recipientCount: 0,
    link: null,
  }
}

function archivedItem(value: FragmentType<typeof CliLinkShareFieldsFragmentDoc>): ShareListItem {
  const share = linkFragment(value)
  const detail = serializeLinkShare(share)
  return {
    id: `link:${share.id}`,
    kind: OutgoingShareKind.Link,
    shareId: share.id,
    grantId: null,
    resourceType: detail.resource.type,
    resourceId: detail.resource.id,
    resource: detail.resource,
    title: share.title || detail.resource.title,
    createdAt: share.createdAt,
    owner: null,
    recipients: [],
    recipientCount: detail.recipients.length,
    link: serializeShareLink(share),
  }
}

function matchesFilters(item: ShareListItem, options: ValidatedShareList, now: number): boolean {
  if (options.resourceType !== undefined && item.resourceType !== options.resourceType) return false
  if (options.kind !== undefined && item.kind !== options.kind) return false
  if (options.after !== undefined && item.createdAt < options.after) return false
  if (options.before !== undefined && item.createdAt > options.before) return false
  if (options.status === ShareStatus.Archived && item.link?.status !== ShareStatus.Archived)
    return false
  if (options.status === ShareStatus.Active && item.link?.status === ShareStatus.Archived)
    return false
  if (options.enabled !== undefined && item.link?.enabled !== options.enabled) return false
  if (options.access !== undefined && item.link?.accessType !== options.access) return false
  if (options.expiry !== undefined) {
    if (!item.link) return false
    const expiration = item.link.expiresAt
    if (options.expiry === 'never' && expiration !== null) return false
    if (options.expiry === 'expired' && (expiration === null || expiration > now)) return false
    if (options.expiry === 'valid' && expiration !== null && expiration <= now) return false
  }
  return true
}

function requiresLocalFiltering(options: ValidatedShareList): boolean {
  if (options.after !== undefined || options.before !== undefined) return true
  if (options.kind !== undefined) return true
  if (
    options.enabled !== undefined ||
    options.access !== undefined ||
    options.expiry !== undefined
  ) {
    return true
  }
  return options.status === ShareStatus.Archived && options.resourceType !== undefined
}

async function queryOutgoing(
  client: RawbackClient,
  options: ValidatedShareList,
  page: number,
  size: number,
) {
  const result = await client.graphql.query({
    query: CliSharedByMeDocument,
    variables: {
      pagination: { page, pageSize: size },
      ...(options.resourceType !== undefined ? { resourceType: options.resourceType } : {}),
    },
  })
  if (result.error) throw result.error
  if (!result.data) throw new Error('The outgoing shares response did not include share data')
  return result.data.sharedByMe
}

async function queryIncoming(
  client: RawbackClient,
  options: ValidatedShareList,
  page: number,
  size: number,
) {
  const result = await client.graphql.query({
    query: CliSharedWithMeDocument,
    variables: {
      pagination: { page, pageSize: size },
      ...(options.resourceType !== undefined ? { resourceType: options.resourceType } : {}),
    },
  })
  if (result.error) throw result.error
  if (!result.data) throw new Error('The incoming shares response did not include share data')
  return result.data.sharedWithMe
}

async function queryArchived(client: RawbackClient, page: number, size: number) {
  const result = await client.graphql.query({
    query: CliSharesDocument,
    variables: {
      status: ShareStatus.Archived,
      pagination: { page, pageSize: size },
    },
  })
  if (result.error) throw result.error
  if (!result.data) throw new Error('The archived shares response did not include share data')
  return result.data.shares
}

async function allPages<T>(
  load: (page: number) => Promise<{ edges: T[]; pageInfo: SharePageInfo }>,
) {
  const values: T[] = []
  let page = 1
  while (true) {
    const result = await load(page)
    values.push(...result.edges)
    if (!result.pageInfo.hasNextPage) return values
    page += 1
  }
}

async function listShares(
  client: RawbackClient,
  options: ValidatedShareList,
  now: number,
): Promise<{ items: ShareListItem[]; pageInfo: SharePageInfo }> {
  const local = requiresLocalFiltering(options)
  if (options.scope === 'with-me') {
    if (!local) {
      const result = await queryIncoming(client, options, options.page, options.pageSize)
      return { items: result.edges.map(incomingItem), pageInfo: pageInfo(result.pageInfo) }
    }
    const edges = await allPages((page) => queryIncoming(client, options, page, 100))
    const items = edges
      .map(incomingItem)
      .filter((item) => matchesFilters(item, options, now))
      .sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id))
    return localPage(items, options.page, options.pageSize)
  }

  if (options.status === ShareStatus.Archived) {
    if (!local) {
      const result = await queryArchived(client, options.page, options.pageSize)
      return { items: result.edges.map(archivedItem), pageInfo: pageInfo(result.pageInfo) }
    }
    const edges = await allPages((page) => queryArchived(client, page, 100))
    const items = edges
      .map(archivedItem)
      .filter((item) => matchesFilters(item, options, now))
      .sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id))
    return localPage(items, options.page, options.pageSize)
  }

  if (!local) {
    const result = await queryOutgoing(client, options, options.page, options.pageSize)
    return { items: result.edges.map(outgoingItem), pageInfo: pageInfo(result.pageInfo) }
  }
  const edges = await allPages((page) => queryOutgoing(client, options, page, 100))
  const items = edges
    .map(outgoingItem)
    .filter((item) => matchesFilters(item, options, now))
    .sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id))
  return localPage(items, options.page, options.pageSize)
}

async function loadShare(client: RawbackClient, id: number): Promise<CliLinkShareFieldsFragment> {
  const result = await client.graphql.query({ query: CliShareDocument, variables: { id } })
  if (result.error) throw result.error
  if (!result.data) throw new Error('The share response did not include share data')
  if (!result.data.share) throw new Error(`Share ${id} not found`)
  return linkFragment(result.data.share)
}

async function confirm(
  dependencies: ShareCommandDependencies,
  message: string,
  nonInteractiveMessage: string,
): Promise<boolean> {
  if (dependencies.prompts) return dependencies.prompts.confirm(message)
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error(nonInteractiveMessage)
  const { confirm: prompt } = await import('@inquirer/prompts')
  return prompt({ default: false, message })
}

export interface ClipboardCommand {
  args: string[]
  command: string
}

export function clipboardCommand(
  platform: NodeJS.Platform,
  which: (command: string) => string | null = Bun.which,
): ClipboardCommand {
  if (platform === 'darwin') return { command: 'pbcopy', args: [] }
  if (platform === 'win32') return { command: 'clip.exe', args: [] }
  if (platform === 'linux') {
    if (which('wl-copy')) return { command: 'wl-copy', args: [] }
    if (which('xclip')) return { command: 'xclip', args: ['-selection', 'clipboard'] }
    if (which('xsel')) return { command: 'xsel', args: ['--clipboard', '--input'] }
    throw new Error(
      'No supported clipboard utility found; install wl-clipboard, xclip, or xsel, or rerun without --copy',
    )
  }
  throw new Error(`Clipboard copying is not supported on ${platform}; rerun without --copy`)
}

export async function copyToClipboard(value: string): Promise<void> {
  const selected = clipboardCommand(process.platform)
  let child: ReturnType<typeof Bun.spawn>
  try {
    child = Bun.spawn([selected.command, ...selected.args], {
      stdin: new Blob([value]),
      stdout: 'ignore',
      stderr: 'ignore',
    })
  } catch (error) {
    throw new Error(`Unable to start ${selected.command}; rerun without --copy`, { cause: error })
  }
  const exitCode = await child.exited
  if (exitCode !== 0) {
    throw new Error(
      `${selected.command} exited with status ${exitCode}; rerun without --copy to print the link`,
    )
  }
}

export async function runShareList(
  options: ShareListOptions,
  dependencies: ShareCommandDependencies = {},
): Promise<void> {
  const validated = validateShareListOptions(options)
  const ui = commandOutput(dependencies)
  const result = await ui.withActivity(
    'Loading shares…',
    async () => {
      const client = await createCommandClient(dependencies)
      return listShares(client, validated, dependencies.now?.() ?? Date.now() / 1000)
    },
    !options.json,
  )
  if (options.json) {
    ui.json({ scope: validated.scope, shares: result.items, pageInfo: result.pageInfo })
    return
  }
  ui.document(shareListDocument(validated.scope, result.items, result.pageInfo))
}

export async function runShareGet(
  options: ShareIdOptions,
  dependencies: ShareCommandDependencies = {},
): Promise<void> {
  const id = validateShareId(options.id)
  const ui = commandOutput(dependencies)
  const share = await ui.withActivity(
    'Loading share…',
    async () => loadShare(await createCommandClient(dependencies), id),
    !options.json,
  )
  const serialized = serializeLinkShare(share)
  if (options.json) {
    ui.json({ share: serialized })
  } else {
    ui.document(shareDetailDocument(serialized))
  }
}

async function updateShareState(
  options: ShareIdOptions,
  input: Omit<UpdateShareInput, 'id'>,
  message: string,
  dependencies: ShareCommandDependencies,
  requireUnexpired = false,
): Promise<void> {
  const id = validateShareId(options.id)
  const client = await createCommandClient(dependencies)
  if (requireUnexpired) {
    const current = await loadShare(client, id)
    if (current.isExpired) {
      throw new Error(`Share ${id} has expired and cannot be enabled`)
    }
  }
  const result = await client.graphql.mutate({
    mutation: CliUpdateShareDocument,
    variables: { input: { id, ...input } },
  })
  if (result.error) throw result.error
  if (!result.data?.updateShare) {
    throw new Error('The update share response did not include the share')
  }
  const share = serializeLinkShare(linkFragment(result.data.updateShare))
  const ui = commandOutput(dependencies)
  if (options.json) ui.json({ share })
  else ui.success(message)
}

export async function runShareArchive(
  options: ShareIdOptions,
  dependencies: ShareCommandDependencies = {},
): Promise<void> {
  await updateShareState(
    options,
    { status: ShareStatus.Archived },
    `Archived share ${options.id}.`,
    dependencies,
  )
}

export async function runShareUnarchive(
  options: ShareIdOptions,
  dependencies: ShareCommandDependencies = {},
): Promise<void> {
  await updateShareState(
    options,
    { status: ShareStatus.Active },
    `Unarchived share ${options.id}.`,
    dependencies,
  )
}

export async function runShareEnable(
  options: ShareIdOptions,
  dependencies: ShareCommandDependencies = {},
): Promise<void> {
  await updateShareState(
    options,
    { enabled: true },
    `Enabled share ${options.id}.`,
    dependencies,
    true,
  )
}

export async function runShareDisable(
  options: ShareIdOptions,
  dependencies: ShareCommandDependencies = {},
): Promise<void> {
  await updateShareState(options, { enabled: false }, `Disabled share ${options.id}.`, dependencies)
}

export async function runShareDelete(
  options: ShareDeleteOptions,
  dependencies: ShareCommandDependencies = {},
): Promise<void> {
  const id = validateShareId(options.id)
  const client = await createCommandClient(dependencies)
  if (!options.force) {
    const share = await loadShare(client, id)
    const detail = serializeLinkShare(share)
    const name = share.title || detail.resource.title
    const confirmed = await confirm(
      dependencies,
      `Delete share "${name}" (ID ${id})?`,
      'Deleting a share requires an interactive terminal unless --force is provided.',
    )
    if (!confirmed) {
      const ui = commandOutput(dependencies)
      if (options.json) ui.json({ deleted: false, id })
      else ui.info('Deletion cancelled.')
      return
    }
  }
  const result = await client.graphql.mutate({
    mutation: CliDeleteShareDocument,
    variables: { id },
  })
  if (result.error) throw result.error
  if (result.data?.deleteShare !== true) {
    throw new Error('The delete share response did not confirm deletion')
  }
  const ui = commandOutput(dependencies)
  if (options.json) ui.json({ deleted: true, id })
  else ui.success(`Deleted share ${id}.`)
}

export async function runShareRecipients(
  options: ShareIdOptions,
  dependencies: ShareCommandDependencies = {},
): Promise<void> {
  const id = validateShareId(options.id)
  const ui = commandOutput(dependencies)
  const share = await ui.withActivity(
    'Loading recipients…',
    async () => loadShare(await createCommandClient(dependencies), id),
    !options.json,
  )
  const recipients = share.recipients.map((recipient) =>
    serializeRecipient(recipientFragment(recipient)),
  )
  if (options.json) {
    ui.json({ shareId: id, recipients })
  } else {
    ui.document(shareRecipientsDocument(id, recipients))
  }
}

export async function runShareLink(
  options: ShareLinkOptions,
  dependencies: ShareCommandDependencies = {},
): Promise<void> {
  const id = validateShareId(options.id)
  const ui = commandOutput(dependencies)
  const share = await ui.withActivity(
    options.copy ? 'Copying share link…' : 'Loading share link…',
    async () => loadShare(await createCommandClient(dependencies), id),
    !options.json,
  )
  if (options.copy) await (dependencies.copy ?? copyToClipboard)(share.url)
  if (options.json) {
    ui.json({ id, url: share.url, copied: options.copy === true })
  } else if (options.copy) {
    ui.success(`Copied share ${id} link to the clipboard.`)
  } else {
    ui.raw(share.url)
  }
}
