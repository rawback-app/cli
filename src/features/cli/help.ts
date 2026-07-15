import { type UiDocument, type UiHelpSection } from "../../ui/model.ts";

interface ParsedEntry {
  description: string;
  term: string;
}

function parseEntry(line: string): ParsedEntry | undefined {
  const match = line.match(/^\s+(\S(?:.*?\S)?)\s{2,}(\S.*)$/);
  if (!match?.[1] || !match[2]) return undefined;
  return { term: match[1], description: match[2] };
}

export function helpDocument(rawHelp: string): UiDocument {
  const lines = rawHelp.trimEnd().split("\n");
  const usage = lines.shift()?.trim();
  while (lines[0]?.trim() === "") lines.shift();

  const descriptionLines: string[] = [];
  while (lines.length > 0 && !/^[^ ].*:$/.test(lines[0] ?? "")) {
    const line = lines.shift();
    if (line?.trim()) descriptionLines.push(line.trim());
  }

  const sections: UiHelpSection[] = [];
  let section: UiHelpSection | undefined;
  let lastEntry: ParsedEntry | undefined;

  for (const line of lines) {
    const heading = line.match(/^([^ ].*):$/)?.[1];
    if (heading) {
      section = { title: heading, entries: [] };
      sections.push(section);
      lastEntry = undefined;
      continue;
    }
    if (!section || line.trim() === "") continue;
    const entry = parseEntry(line);
    if (entry) {
      section.entries.push(entry);
      lastEntry = entry;
      continue;
    }
    if (lastEntry && /^\s{2,}\S/.test(line)) {
      lastEntry.description += " " + line.trim();
    }
  }

  return {
    title: "Rawback",
    blocks: [
      {
        type: "help",
        ...(usage ? { usage } : {}),
        ...(descriptionLines.length > 0 ? { description: descriptionLines.join(" ") } : {}),
        sections,
      },
    ],
  };
}
