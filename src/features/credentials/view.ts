import { type CreateSftpCredentialMutation, type SftpCredentialsQuery } from '@rawback/sdk'

import { formatTimestamp, sanitizeCell } from '../../ui/format.ts'
import { cell, statusCell, type UiDocument } from '../../ui/model.ts'

type Credential = SftpCredentialsQuery['sftpCredentials'][number]
type CreatedCredential = CreateSftpCredentialMutation['createSFTPCredential']

export function credentialListDocument(credentials: Credential[]): UiDocument {
  return {
    title: 'SFTP credentials',
    blocks: [
      {
        type: 'table',
        emptyMessage: 'No SFTP credentials found.',
        columns: [
          { key: 'id', label: 'ID', required: true },
          { key: 'name', label: 'Name', required: true, minWidth: 12 },
          { key: 'status', label: 'Status', priority: 1 },
          { key: 'created', label: 'Created', priority: 2, minWidth: 10 },
          { key: 'lastUsed', label: 'Last used', priority: 3, minWidth: 10 },
        ],
        rows: credentials.map((credential) => ({
          id: credential.id,
          name: sanitizeCell(credential.name),
          status: statusCell(credential.enabled),
          created: formatTimestamp(credential.createdAt).slice(0, 10),
          lastUsed:
            credential.lastUsedAt === null || credential.lastUsedAt === undefined
              ? cell('never', { dim: true })
              : formatTimestamp(credential.lastUsedAt).slice(0, 10),
        })),
      },
    ],
  }
}

export function createdCredentialDocument(credential: CreatedCredential): UiDocument {
  return {
    title: 'SFTP credential created',
    blocks: [
      {
        type: 'notice',
        message: 'Credential ' + String(credential.id) + ' is ready',
        tone: 'success',
      },
      {
        type: 'fields',
        fields: [
          { label: 'Name', value: credential.name },
          { label: 'Password', value: credential.password },
          { label: 'Created', value: formatTimestamp(credential.createdAt) },
        ],
      },
    ],
  }
}
