import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeCredentials } from "../src/credentials.ts";
import {
  type DreamCommandDependencies,
  runDreamGet,
  runDreamList,
  runDreamRetry,
} from "../src/dreams.ts";

const temporaryDirectories: string[] = [];

async function temporaryDependencies(
  handler: (body: Record<string, unknown>) => Response | Promise<Response>,
  overrides: Partial<DreamCommandDependencies> = {},
): Promise<DreamCommandDependencies> {
  const directory = await mkdtemp(join(tmpdir(), "rawback-dreams-"));
  temporaryDirectories.push(directory);
  const credentialsPath = join(directory, "credentials.json");
  await writeCredentials({ token: "access-token", refreshToken: "refresh-token" }, credentialsPath);
  return {
    configPath: join(directory, "config.yml"),
    credentialsPath,
    fetch: (async (_input, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer access-token");
      return handler(JSON.parse(String(init?.body)) as Record<string, unknown>);
    }) as typeof fetch,
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const summary = {
  id: 7,
  dreamDate: "2025-01-15",
  status: "completed",
  title: "A day in Tokyo",
  imageUrl: "https://cdn.example/dream.jpg",
  photoCount: 12,
  createdAt: 1_736_942_400,
};

const dream = {
  ...summary,
  userId: 42,
  errorMessage: null,
  skipReason: null,
  retryCount: 0,
  descriptionMarkdown: "# Tokyo\n\nA day around the city.",
  imageWidth: 1024,
  imageHeight: 1024,
  imageBlurhash: "blurhash",
  places: ["Tokyo"],
  cameraModels: ["Canon EOS R5"],
  cameras: [
    {
      id: 4,
      make: "Canon",
      model: "EOS R5",
      imageCount: 12,
      sensorWidth: 36,
      sensorHeight: 24,
      shutterCount: 1234,
      product: { productImageUrl: null, yearReleased: 2020 },
    },
  ],
  placeClusters: [
    { id: 8, latitude: 35.6762, longitude: 139.6503, label: "Tokyo", imageCount: 12 },
  ],
};

const photo = {
  id: 11,
  filename: "tokyo.jpg",
  url: "https://cdn.example/tokyo.jpg",
  thumbnailUrl: null,
  status: "completed",
  width: 1200,
  height: 800,
  blurhash: null,
  capturedAt: 1_736_942_400,
  latitude: 35.6762,
  longitude: 139.6503,
  cameraMake: "Canon",
  cameraModel: "EOS R5",
  rotation: 0,
  rate: 5,
  editedImages: [],
};

const listPageInfo = {
  page: 2,
  pageSize: 30,
  totalCount: 31,
  totalPages: 2,
  hasNextPage: false,
  hasPreviousPage: true,
};

const photoPageInfo = {
  page: 1,
  pageSize: 24,
  totalCount: 12,
  totalPages: 1,
  hasNextPage: false,
  hasPreviousPage: false,
};

describe("dream commands", () => {
  test("lists and gets dreams with stable JSON", async () => {
    const output: string[] = [];
    const operations: string[] = [];
    const dependencies = await temporaryDependencies(
      (body) => {
        operations.push(String(body.operationName));
        if (body.operationName === "CliDreams") {
          expect(body.variables).toEqual({ pagination: { page: 2, pageSize: 30 } });
          return Response.json({
            data: { dreams: { edges: [summary], pageInfo: listPageInfo } },
          });
        }
        expect(body.operationName).toBe("CliDream");
        expect(body.variables).toEqual({ id: 7, pagination: { page: 1, pageSize: 24 } });
        return Response.json({
          data: { dream: { ...dream, images: { edges: [photo], pageInfo: photoPageInfo } } },
        });
      },
      { stdout: (message) => output.push(message) },
    );

    await runDreamList({ json: true, page: 2, pageSize: 30 }, dependencies);
    await runDreamGet({ id: 7, json: true, page: 1, pageSize: 24 }, dependencies);

    expect(operations).toEqual(["CliDreams", "CliDream"]);
    expect(JSON.parse(output[0] ?? "")).toEqual({
      dreams: [summary],
      pageInfo: listPageInfo,
    });
    expect(JSON.parse(output[1] ?? "")).toMatchObject({
      dream: {
        id: 7,
        imageBlurhash: "blurhash",
        cameras: [{ id: 4, make: "Canon", product: { yearReleased: 2020 } }],
        placeClusters: [{ id: 8, label: "Tokyo" }],
      },
      photos: [
        {
          id: 11,
          thumbnailUrl: null,
          latitude: 35.6762,
          rate: 5,
        },
      ],
      pageInfo: photoPageInfo,
    });
  });

  test("renders full human detail and reports missing dreams", async () => {
    const output: string[] = [];
    let found = true;
    const dependencies = await temporaryDependencies(
      () =>
        Response.json({
          data: {
            dream: found
              ? {
                  ...dream,
                  status: "failed",
                  errorMessage: "processor failed",
                  images: { edges: [photo], pageInfo: photoPageInfo },
                }
              : null,
          },
        }),
      { columns: 120, stdout: (message) => output.push(message) },
    );

    await runDreamGet({ id: 7, page: 1, pageSize: 24 }, dependencies);
    expect(output[0]).toContain("A day in Tokyo");
    expect(output[0]).toContain("processor failed");
    expect(output[0]).toContain("Canon EOS R5");
    expect(output[0]).toContain("tokyo.jpg");

    found = false;
    await expect(runDreamGet({ id: 9, page: 1, pageSize: 24 }, dependencies)).rejects.toThrow(
      "Dream 9 not found",
    );
  });

  test("confirms retries and emits stable cancellation and success JSON", async () => {
    const output: string[] = [];
    const prompts: string[] = [];
    let requests = 0;
    const dependencies = await temporaryDependencies(
      (body) => {
        requests += 1;
        expect(body.operationName).toBe("CliRetryDream");
        expect(body.variables).toEqual({ id: 7 });
        return Response.json({ data: { retryDream: { id: 7, status: "pending" } } });
      },
      {
        prompts: {
          async confirm(message) {
            prompts.push(message);
            return false;
          },
        },
        stdout: (message) => output.push(message),
      },
    );

    await runDreamRetry({ id: 7, json: true }, dependencies);
    expect(prompts).toEqual(["Retry dream 7? Regeneration may consume AI credits."]);
    expect(JSON.parse(output[0] ?? "")).toEqual({ retried: false, id: 7, status: null });
    expect(requests).toBe(0);

    await runDreamRetry({ id: 7, force: true, json: true }, dependencies);
    expect(JSON.parse(output[1] ?? "")).toEqual({ retried: true, id: 7, status: "pending" });
    expect(requests).toBe(1);
  });

  test("surfaces retry precondition errors", async () => {
    const dependencies = await temporaryDependencies(() =>
      Response.json({ errors: [{ message: "dream is not in a failed state" }] }),
    );

    await expect(runDreamRetry({ id: 7, force: true }, dependencies)).rejects.toThrow(
      "dream is not in a failed state",
    );
  });
});
