import { type CliArticleFieldsFragment } from '../../gql/graphql.ts'
import { formatTimestamp, sanitizeCell } from '../../ui/format.ts'
import { cell, type UiDocument } from '../../ui/model.ts'

interface PageInfo {
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
}

export function articleListDocument(
  articles: CliArticleFieldsFragment[],
  pageInfo: PageInfo,
): UiDocument {
  return {
    title: 'Articles',
    blocks: [
      {
        type: 'table',
        emptyMessage: 'No articles found.',
        columns: [
          { key: 'id', label: 'ID', required: true, priority: 1 },
          { key: 'albumId', label: 'Album ID', priority: 4 },
          { key: 'album', label: 'Album', required: true, priority: 1, minWidth: 10 },
          { key: 'status', label: 'Status', priority: 2 },
          { key: 'title', label: 'Title', priority: 2, minWidth: 12 },
          { key: 'updated', label: 'Updated', priority: 3, minWidth: 10 },
        ],
        rows: articles.map((article) => ({
          id: article.id,
          albumId: article.album.id,
          album: sanitizeCell(article.album.name),
          status: article.status,
          title: sanitizeCell(article.title) || cell('—', { dim: true }),
          updated: formatTimestamp(article.updatedAt).slice(0, 10),
        })),
      },
      {
        type: 'pagination',
        page: pageInfo.page,
        pageSize: pageInfo.pageSize,
        count: articles.length,
        totalCount: pageInfo.totalCount,
        totalPages: pageInfo.totalPages,
      },
    ],
  }
}

export function articleViewDocument(article: CliArticleFieldsFragment): UiDocument {
  return {
    title: article.title || 'Article ' + String(article.id),
    blocks: [
      {
        type: 'fields',
        fields: [
          { label: 'ID', value: article.id },
          { label: 'Album ID', value: article.album.id },
          { label: 'Album', value: sanitizeCell(article.album.name) },
          { label: 'Status', value: article.status },
          { label: 'Images', value: article.images.length },
          { label: 'Created', value: formatTimestamp(article.createdAt) },
          { label: 'Updated', value: formatTimestamp(article.updatedAt) },
        ],
      },
      {
        type: 'text',
        text: article.content || 'No article content.',
        dim: article.content.length === 0,
      },
    ],
  }
}
