import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeCredentials } from "../src/credentials.ts";
import { createPhotoFilter, runPhotoList, type PhotoListDependencies } from "../src/photos.ts";

const temporaryDirectories: string[] = [];

async function dependencies(
  handler: (body: Record<string, any>) => Response,
  output: string[],
): Promise<PhotoListDependencies> {
  const directory = await mkdtemp(join(tmpdir(), "rawback-photos-"));
  temporaryDirectories.push(directory);
  const credentialsPath = join(directory, "credentials.json");
  await writeCredentials({ token: "token", refreshToken: "refresh" }, credentialsPath);
  return {
    configPath: join(directory, "config.yml"),
    credentialsPath,
    fetch: (async (_input, init) => handler(JSON.parse(String(init?.body)))) as typeof fetch,
    stdout: (message) => output.push(message),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("photos list", () => {
  test("maps rich filters and emits a stable JSON envelope", async () => {
    const lines: string[] = [];
    const deps = await dependencies((body) => {
      expect(body.operationName).toBe("Photos");
      expect(body.variables).toEqual({
        filter: {
          apertureMin: 1.4,
          cameraMake: ["Fujifilm", "Sony"],
          cameraModel: ["X-T5"],
          capturedAfter: 1_704_067_200,
          capturedBefore: 1_704_153_600,
          city: ["Tokyo"],
          country: ["Japan"],
          focalLengthMax: 85,
          hasGps: true,
          lensModel: ["XF 23mm"],
          rate: [0, 2],
          search: "street",
          status: ["completed", "processing"],
        },
        pagination: { page: 2, pageSize: 10 },
      });
      return Response.json({
        data: {
          images: {
            edges: [
              {
                id: 7,
                filename: "tokyo.raf",
                url: "https://cdn/photo",
                thumbnailUrl: null,
                status: "completed",
                width: 6000,
                height: 4000,
                capturedAt: 1_704_067_200,
                cameraMake: "Fujifilm",
                cameraModel: "X-T5",
                rotation: 0,
                rate: 2,
                editedImages: [],
              },
            ],
            pageInfo: {
              page: 2,
              pageSize: 10,
              totalCount: 17,
              totalPages: 2,
              hasNextPage: false,
              hasPreviousPage: true,
            },
          },
        },
      });
    }, lines);

    await runPhotoList(
      {
        apertureMin: 1.4,
        cameraMake: ["Fujifilm,Sony"],
        cameraModel: ["X-T5"],
        capturedAfter: "2024-01-01",
        capturedBefore: "2024-01-02",
        city: ["Tokyo"],
        country: ["Japan"],
        focalLengthMax: 85,
        hasGps: true,
        json: true,
        lensModel: ["XF 23mm"],
        page: 2,
        pageSize: 10,
        rate: ["0,2"],
        search: " street ",
        status: ["completed,processing"],
      },
      deps,
    );

    expect(JSON.parse(lines.join("\n"))).toMatchObject({
      photos: [{ id: 7, thumbnailUrl: null, editedImages: [] }],
      pageInfo: { page: 2, totalCount: 17 },
    });
  });

  test("uses the web rating default and renders a table", async () => {
    const filter = createPhotoFilter({ page: 1, pageSize: 24 });
    expect(filter).toEqual({ rate: [3, 4, 5] });

    const lines: string[] = [];
    const deps = await dependencies(
      () =>
        Response.json({
          data: {
            images: {
              edges: [
                {
                  id: 1,
                  filename: "photo.jpg",
                  url: "https://cdn/photo",
                  thumbnailUrl: null,
                  status: "completed",
                  width: 1200,
                  height: 800,
                  capturedAt: 1_704_067_200,
                  cameraMake: "Sony",
                  cameraModel: "A7",
                  rotation: 0,
                  rate: 5,
                  editedImages: [],
                },
              ],
              pageInfo: {
                page: 1,
                pageSize: 24,
                totalCount: 1,
                totalPages: 1,
                hasNextPage: false,
                hasPreviousPage: false,
              },
            },
          },
        }),
      lines,
    );
    await runPhotoList({ page: 1, pageSize: 24 }, deps);
    expect(lines[0]).toContain("ID  FILENAME");
    expect(lines[0]).toContain("Sony A7");
    expect(lines[1]).toBe("Page 1 of 1 (1 total photos).");
  });

  test("rejects invalid filters before making a request", async () => {
    expect(() => createPhotoFilter({ page: 1, pageSize: 24, rate: ["6"] })).toThrow(
      "integers between 0 and 5",
    );
    expect(() => createPhotoFilter({ page: 1, pageSize: 24, capturedAfter: "not-a-date" })).toThrow(
      "ISO date/time",
    );
    expect(() => createPhotoFilter({ page: 1, pageSize: 101 })).toThrow("between 1 and 100");
  });
});
