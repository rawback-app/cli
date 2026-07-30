import { type PhotosQuery } from "@rawback/sdk";
import { formatTimestamp } from "../../ui/format.ts";
import { cell, type UiDocument } from "../../ui/model.ts";

type Photo = PhotosQuery["images"]["edges"][number];
type PageInfo = PhotosQuery["images"]["pageInfo"];

export function photoListDocument(photos: Photo[], pageInfo: PageInfo): UiDocument {
  return {
    title: "Photos",
    blocks: [
      {
        type: "table",
        emptyMessage: "No photos found.",
        columns: [
          { key: "id", label: "ID", required: true, priority: 1 },
          { key: "filename", label: "Filename", required: true, priority: 1, minWidth: 12 },
          { key: "status", label: "Status", priority: 2 },
          { key: "rating", label: "Rating", priority: 5 },
          { key: "captured", label: "Captured", priority: 3, minWidth: 10 },
          { key: "camera", label: "Camera", priority: 6, minWidth: 8 },
          { key: "dimensions", label: "Dimensions", priority: 4 },
        ],
        rows: photos.map((photo) => ({
          id: photo.id,
          filename: photo.filename,
          status: cell(photo.status, {
            tone: photo.status.toLowerCase().includes("fail") ? "error" : "neutral",
          }),
          rating:
            photo.rate === null || photo.rate === undefined ? cell("—", { dim: true }) : photo.rate,
          captured: formatTimestamp(photo.capturedAt).slice(0, 10),
          camera:
            [photo.cameraMake, photo.cameraModel].filter(Boolean).join(" ") ||
            cell("—", { dim: true }),
          dimensions:
            photo.width && photo.height
              ? String(photo.width) + "×" + String(photo.height)
              : cell("—", { dim: true }),
        })),
      },
      {
        type: "pagination",
        page: pageInfo.page,
        pageSize: pageInfo.pageSize,
        count: photos.length,
        totalCount: pageInfo.totalCount,
        totalPages: pageInfo.totalPages,
      },
    ],
  };
}
