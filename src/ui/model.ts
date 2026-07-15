export type UiTone = "neutral" | "info" | "success" | "warning" | "error";

export interface UiCell {
  text: string;
  tone?: UiTone;
  dim?: boolean;
}

export type UiCellValue = string | number | UiCell;

export interface UiTableColumn {
  key: string;
  label: string;
  priority?: number;
  required?: boolean;
  minWidth?: number;
  maxWidth?: number;
}

export type UiTableRow = Record<string, UiCellValue>;

export interface UiField {
  label: string;
  value: UiCellValue;
}

export interface UiNoticeBlock {
  type: "notice";
  message: string;
  tone?: UiTone;
}

export interface UiFieldsBlock {
  type: "fields";
  fields: UiField[];
}

export interface UiTableBlock {
  type: "table";
  columns: UiTableColumn[];
  rows: UiTableRow[];
  emptyMessage?: string;
}

export interface UiTextBlock {
  type: "text";
  text: string;
  dim?: boolean;
  bold?: boolean;
}

export interface UiHelpSection {
  title: string;
  entries: Array<{ term: string; description: string }>;
}

export interface UiHelpBlock {
  type: "help";
  usage?: string;
  description?: string;
  sections: UiHelpSection[];
}

export interface UiPaginationBlock {
  type: "pagination";
  page: number;
  pageSize: number;
  count: number;
  totalCount?: number;
  totalPages?: number;
}

export type UiBlock =
  | UiNoticeBlock
  | UiFieldsBlock
  | UiTableBlock
  | UiTextBlock
  | UiHelpBlock
  | UiPaginationBlock;

export interface UiDocument {
  title?: string;
  blocks: UiBlock[];
}

export function cell(text: string, options: Omit<UiCell, "text"> = {}): UiCell {
  return { text, ...options };
}

export function statusCell(enabled: boolean, enabledText = "enabled"): UiCell {
  return enabled ? { text: enabledText, tone: "success" } : { text: "disabled", tone: "warning" };
}
