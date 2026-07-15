import { Box, Text } from "ink";

import {
  type UiBlock,
  type UiCell,
  type UiCellValue,
  type UiDocument,
  type UiField,
  type UiHelpBlock,
  type UiTableBlock,
  type UiTableColumn,
  type UiTone,
} from "./model.ts";

type ToneColor = "cyan" | "green" | "yellow" | "red" | undefined;

const toneColor: Record<UiTone, ToneColor> = {
  neutral: undefined,
  info: "cyan",
  success: "green",
  warning: "yellow",
  error: "red",
};

const toneIcon: Record<UiTone, string> = {
  neutral: "•",
  info: "ℹ",
  success: "✓",
  warning: "!",
  error: "✗",
};

function normalizedCell(value: UiCellValue | undefined): UiCell {
  if (value === undefined) return { text: "—", dim: true };
  if (typeof value === "object") return value;
  return { text: String(value) };
}

function cellWidth(value: UiCellValue | undefined): number {
  return normalizedCell(value).text.length;
}

function minColumnWidth(column: UiTableColumn): number {
  return Math.max(column.minWidth ?? 3, column.label.length);
}

export function visibleTableColumns(block: UiTableBlock, terminalWidth: number): UiTableColumn[] {
  const gapWidth = 2;
  const ordered = [...block.columns].sort(
    (left, right) => (left.priority ?? 100) - (right.priority ?? 100),
  );
  const visible: UiTableColumn[] = [];
  let used = 0;

  for (const column of ordered) {
    const width = minColumnWidth(column);
    const nextWidth = used + (visible.length > 0 ? gapWidth : 0) + width;
    if (column.required || nextWidth <= terminalWidth || visible.length === 0) {
      visible.push(column);
      used = nextWidth;
    }
  }

  return block.columns.filter((column) => visible.includes(column));
}

function allocateWidths(
  block: UiTableBlock,
  columns: UiTableColumn[],
  terminalWidth: number,
): number[] {
  const gapWidth = Math.max(0, columns.length - 1) * 2;
  const widths = columns.map((column) => {
    const contentWidth = Math.max(
      column.label.length,
      ...block.rows.map((row) => cellWidth(row[column.key])),
    );
    return Math.min(column.maxWidth ?? Number.POSITIVE_INFINITY, contentWidth);
  });
  const minimums = columns.map(minColumnWidth);
  let overflow = widths.reduce((total, width) => total + width, gapWidth) - terminalWidth;

  while (overflow > 0) {
    let changed = false;
    for (let index = widths.length - 1; index >= 0 && overflow > 0; index -= 1) {
      const width = widths[index];
      const minimum = minimums[index];
      if (width !== undefined && minimum !== undefined && width > minimum) {
        widths[index] = width - 1;
        overflow -= 1;
        changed = true;
      }
    }
    if (!changed) break;
  }

  return widths;
}

function CellText({ value }: { value: UiCellValue | undefined }) {
  const rendered = normalizedCell(value);
  const color = toneColor[rendered.tone ?? "neutral"];
  return (
    <Text
      {...(color === undefined ? {} : { color })}
      {...(rendered.dim === undefined ? {} : { dimColor: rendered.dim })}
      wrap="truncate-end"
    >
      {rendered.text}
    </Text>
  );
}

function Fields({ fields }: { fields: UiField[] }) {
  const labelWidth = Math.max(...fields.map((field) => field.label.length), 0);
  return (
    <Box flexDirection="column">
      {fields.map((field) => (
        <Box key={field.label}>
          <Box width={labelWidth + 2}>
            <Text dimColor>{field.label}</Text>
          </Box>
          <CellText value={field.value} />
        </Box>
      ))}
    </Box>
  );
}

function Table({ block, terminalWidth }: { block: UiTableBlock; terminalWidth: number }) {
  if (block.rows.length === 0) {
    return <Text dimColor>{block.emptyMessage ?? "No results."}</Text>;
  }

  const columns = visibleTableColumns(block, terminalWidth);
  const widths = allocateWidths(block, columns, terminalWidth);

  return (
    <Box flexDirection="column">
      <Box columnGap={2}>
        {columns.map((column, index) => (
          <Box key={column.key} width={widths[index] ?? minColumnWidth(column)}>
            <Text bold dimColor wrap="truncate-end">
              {column.label}
            </Text>
          </Box>
        ))}
      </Box>
      {block.rows.map((row, rowIndex) => (
        <Box key={rowIndex} columnGap={2}>
          {columns.map((column, columnIndex) => (
            <Box key={column.key} width={widths[columnIndex] ?? minColumnWidth(column)}>
              <CellText value={row[column.key]} />
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}

function Help({ block }: { block: UiHelpBlock }) {
  return (
    <Box flexDirection="column">
      {block.description ? (
        <Box marginBottom={1}>
          <Text>{block.description}</Text>
        </Box>
      ) : null}
      {block.usage ? (
        <Box marginBottom={1}>
          <Text dimColor>Usage </Text>
          <Text color="cyan">{block.usage}</Text>
        </Box>
      ) : null}
      {block.sections.map((section) => {
        const termWidth = Math.max(...section.entries.map((entry) => entry.term.length), 0);
        return (
          <Box key={section.title} flexDirection="column" marginBottom={1}>
            <Text bold>{section.title}</Text>
            {section.entries.map((entry) => (
              <Box key={entry.term} paddingLeft={2}>
                <Box width={termWidth + 2}>
                  <Text color="cyan">{entry.term}</Text>
                </Box>
                <Text>{entry.description}</Text>
              </Box>
            ))}
          </Box>
        );
      })}
    </Box>
  );
}

function Block({ block, terminalWidth }: { block: UiBlock; terminalWidth: number }) {
  switch (block.type) {
    case "notice": {
      const tone = block.tone ?? "neutral";
      const color = toneColor[tone];
      return (
        <Text {...(color === undefined ? {} : { color })}>
          {toneIcon[tone]} {block.message}
        </Text>
      );
    }
    case "fields":
      return <Fields fields={block.fields} />;
    case "table":
      return <Table block={block} terminalWidth={terminalWidth} />;
    case "text":
      return (
        <Text
          {...(block.dim === undefined ? {} : { dimColor: block.dim })}
          {...(block.bold === undefined ? {} : { bold: block.bold })}
        >
          {block.text}
        </Text>
      );
    case "help":
      return <Help block={block} />;
    case "pagination": {
      const start = block.count === 0 ? 0 : (block.page - 1) * block.pageSize + 1;
      const end = start === 0 ? 0 : start + block.count - 1;
      if (block.totalCount !== undefined && block.totalPages !== undefined) {
        return (
          <Text dimColor>
            Page {block.page} of {block.totalPages} · {block.totalCount} total
          </Text>
        );
      }
      return (
        <Text dimColor>
          Page {block.page} · showing {start}–{end} · {block.count} result
          {block.count === 1 ? "" : "s"}
        </Text>
      );
    }
  }
}

export function DocumentView({
  document,
  terminalWidth = 80,
}: {
  document: UiDocument;
  terminalWidth?: number;
}) {
  return (
    <Box flexDirection="column">
      {document.title ? (
        <Box marginBottom={document.blocks.length > 0 ? 1 : 0}>
          <Text bold>{document.title}</Text>
        </Box>
      ) : null}
      {document.blocks.map((block, index) => (
        <Box key={index} marginBottom={index === document.blocks.length - 1 ? 0 : 1}>
          <Block block={block} terminalWidth={terminalWidth} />
        </Box>
      ))}
    </Box>
  );
}

const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function ActivityView({ label, frame }: { label: string; frame: number }) {
  return (
    <Box>
      <Text color="cyan">{spinnerFrames[frame % spinnerFrames.length]}</Text>
      <Text> {label}</Text>
    </Box>
  );
}
