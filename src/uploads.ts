import {
  createCommandClient,
  commandOutput,
  type ReadCommandDependencies,
  validatePagination,
} from './command.ts'
import { uploadSessionListDocument } from './features/uploads/view.ts'
import { UploadSessionsDocument, type UploadSessionsQuery, UploadStatus } from './gql/graphql.ts'

const UPLOAD_STATUSES = new Set<string>(Object.values(UploadStatus))

export interface UploadSessionListOptions {
  json?: boolean
  page: number
  pageSize: number
  status?: string
}

export type UploadSessionListDependencies = ReadCommandDependencies
type UploadSession = UploadSessionsQuery['uploads']['edges'][number]

function serializeUpload(upload: UploadSession) {
  return {
    id: upload.id,
    sessionId: upload.sessionId,
    sftpSessionId: upload.sftpSessionId ?? null,
    sourceIP: upload.sourceIP ?? null,
    sourceKind: upload.sourceKind,
    status: upload.status,
    closedReason: upload.closedReason ?? null,
    clientBanner: upload.clientBanner ?? null,
    geoCountry: upload.geoCountry ?? null,
    geoCity: upload.geoCity ?? null,
    serverIP: upload.serverIP ?? null,
    serverVersion: upload.serverVersion ?? null,
    serverCommit: upload.serverCommit ?? null,
    serverHostname: upload.serverHostname ?? null,
    serverOS: upload.serverOS ?? null,
    totalFiles: upload.totalFiles,
    processedFiles: upload.processedFiles,
    failedFiles: upload.failedFiles,
    totalBytes: upload.totalBytes,
    processingProgress: upload.processingProgress,
    processingImageCount: upload.processingImageCount,
    processedImageCount: upload.processedImageCount,
    failedImageCount: upload.failedImageCount,
    completedAt: upload.completedAt ?? null,
    createdAt: upload.createdAt,
    updatedAt: upload.updatedAt,
    credential: upload.credential
      ? { id: upload.credential.id, name: upload.credential.name }
      : null,
  }
}

export async function runUploadSessionList(
  options: UploadSessionListOptions,
  dependencies: UploadSessionListDependencies = {},
): Promise<void> {
  validatePagination(options.page, options.pageSize)
  if (options.status !== undefined && !UPLOAD_STATUSES.has(options.status)) {
    throw new Error(`--status must be one of: ${[...UPLOAD_STATUSES].join(', ')}`)
  }

  const ui = commandOutput(dependencies)
  const result = await ui.withActivity(
    'Loading upload sessions…',
    async () => {
      const client = await createCommandClient(dependencies)
      return client.graphql.query({
        query: UploadSessionsDocument,
        variables: {
          pagination: { page: options.page, pageSize: options.pageSize },
          ...(options.status !== undefined ? { status: options.status as UploadStatus } : {}),
        },
      })
    },
    !options.json,
  )
  if (result.error) throw result.error
  if (!result.data) throw new Error('The upload sessions response did not include upload data')

  const { edges, pageInfo } = result.data.uploads
  const serializedPageInfo = {
    page: pageInfo.page,
    pageSize: pageInfo.pageSize,
    totalCount: pageInfo.totalCount,
    totalPages: pageInfo.totalPages,
    hasNextPage: pageInfo.hasNextPage,
    hasPreviousPage: pageInfo.hasPreviousPage,
  }
  if (options.json) {
    ui.json({ uploads: edges.map(serializeUpload), pageInfo: serializedPageInfo })
    return
  }
  ui.document(uploadSessionListDocument(edges, pageInfo))
}
