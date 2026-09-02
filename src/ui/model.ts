export type UiTone = 'neutral' | 'info' | 'success' | 'warning' | 'error'

export interface UiCell {
  text: string
  tone?: UiTone
  dim?: boolean
}

export type UiCellValue = string | number | UiCell

export interface UiTableColumn {
  key: string
  label: string
  priority?: number
  required?: boolean
  minWidth?: number
  maxWidth?: number
}

export type UiTableRow = Record<string, UiCellValue>

export interface UiField {
  label: string
  value: UiCellValue
}

export interface UiNoticeBlock {
  type: 'notice'
  message: string
  tone?: UiTone
}

export interface UiFieldsBlock {
  type: 'fields'
  fields: UiField[]
}

export interface UiTableBlock {
  type: 'table'
  columns: UiTableColumn[]
  rows: UiTableRow[]
  emptyMessage?: string
}

export interface UiChartPoint {
  /** Pre-formatted x label, e.g. '01-14'. */
  label: string
  /** Raw magnitude; the renderer scales it against the series peak. */
  value: number
}

export interface UiChartBlock {
  type: 'chart'
  title?: string
  points: UiChartPoint[]
  /** Pre-formatted peak, shown against the top of the y-axis. */
  maxLabel: string
  minLabel?: string
  height?: number
  caption?: string
  emptyMessage?: string
  tone?: UiTone
}

export interface UiMeter {
  label: string
  used: number
  /** A total of zero or less renders as an unmeasured quota. */
  total: number
  /** Pre-formatted amounts, e.g. '1.9 GB / 4 GB'. */
  value: string
  caption?: string
  /** Optional trailing series rendered as a sparkline beside the caption. */
  spark?: number[]
  tone?: UiTone
}

/**
 * Several meters in one block: `DocumentView` puts a blank line between blocks,
 * so grouping them is what keeps the overview compact.
 */
export interface UiMetersBlock {
  type: 'meters'
  meters: UiMeter[]
}

export interface UiTextBlock {
  type: 'text'
  text: string
  dim?: boolean
  bold?: boolean
}

export interface UiHelpSection {
  title: string
  entries: Array<{ term: string; description: string }>
}

export interface UiHelpBlock {
  type: 'help'
  usage?: string
  description?: string
  sections: UiHelpSection[]
}

export interface UiPaginationBlock {
  type: 'pagination'
  page: number
  pageSize: number
  count: number
  totalCount?: number
  totalPages?: number
}

export type UiBlock =
  | UiNoticeBlock
  | UiFieldsBlock
  | UiTableBlock
  | UiChartBlock
  | UiMetersBlock
  | UiTextBlock
  | UiHelpBlock
  | UiPaginationBlock

export interface UiDocument {
  title?: string
  blocks: UiBlock[]
}

export function cell(text: string, options: Omit<UiCell, 'text'> = {}): UiCell {
  return { text, ...options }
}

export function statusCell(enabled: boolean, enabledText = 'enabled'): UiCell {
  return enabled ? { text: enabledText, tone: 'success' } : { text: 'disabled', tone: 'warning' }
}
