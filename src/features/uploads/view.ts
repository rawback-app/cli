import { type UploadSessionsQuery } from "../../gql/graphql.ts";
import { formatBytes, formatDuration, formatTimestamp } from "../../ui/format.ts";
import { cell, type UiDocument } from "../../ui/model.ts";

type UploadSession = UploadSessionsQuery["uploads"]["edges"][number];
type PageInfo = UploadSessionsQuery["uploads"]["pageInfo"];

export function uploadSessionListDocument(
  uploads: UploadSession[],
  pageInfo: PageInfo,
): UiDocument {
  return {
    title: "Upload sessions",
    blocks: [
      {
        type: "table",
        emptyMessage: "No upload sessions found.",
        columns: [
          { key: "id", label: "ID", required: true, priority: 1 },
          { key: "status", label: "Status", required: true, priority: 1 },
          { key: "source", label: "Source", priority: 4 },
          { key: "credential", label: "Credential", priority: 5 },
          { key: "files", label: "Files", priority: 2 },
          { key: "failed", label: "Failed", priority: 3 },
          { key: "size", label: "Size", priority: 2 },
          { key: "started", label: "Started", priority: 6, minWidth: 10 },
          { key: "duration", label: "Duration", priority: 7 },
        ],
        rows: uploads.map((upload) => ({
          id: upload.id,
          status: cell(upload.status, {
            tone:
              upload.failedFiles > 0 || upload.status.toLowerCase().includes("fail")
                ? "error"
                : upload.status.toLowerCase().includes("complete")
                  ? "success"
                  : "neutral",
          }),
          source: upload.sourceKind.toUpperCase(),
          credential: upload.credential?.name ?? cell("—", { dim: true }),
          files: String(upload.processedFiles) + "/" + String(upload.totalFiles),
          failed:
            upload.failedFiles === 0
              ? cell("0", { dim: true })
              : cell(String(upload.failedFiles), { tone: "error" }),
          size: formatBytes(upload.totalBytes),
          started: formatTimestamp(upload.createdAt).slice(0, 10),
          duration: formatDuration((upload.completedAt ?? upload.updatedAt) - upload.createdAt),
        })),
      },
      {
        type: "pagination",
        page: pageInfo.page,
        pageSize: pageInfo.pageSize,
        count: uploads.length,
        totalCount: pageInfo.totalCount,
        totalPages: pageInfo.totalPages,
      },
    ],
  };
}
