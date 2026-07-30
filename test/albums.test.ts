import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createAlbumInput,
  type AlbumCommandDependencies,
  runAlbumCreate,
  runAlbumDelete,
  runAlbumEdit,
  runAlbumImageAdd,
  runAlbumImageRemove,
  runAlbumList,
  runAlbumTagAdd,
  runAlbumTagRemove,
  runAlbumView,
  updateAlbumInput,
} from "../src/albums.ts";
import {
  type ArticleCommandDependencies,
  extractArticleImageIds,
  runArticleDelete,
  runArticleEdit,
  runArticleList,
  runArticlePublish,
  runArticleUnpublish,
  runArticleView,
} from "../src/articles.ts";
import { writeCredentials } from "../src/credentials.ts";
import { AlbumPermission } from "@rawback/sdk";

const temporaryDirectories: string[] = [];

type TestDependencies = AlbumCommandDependencies & ArticleCommandDependencies;

async function temporaryDependencies(
  handler: (body: Record<string, unknown>) => Response | Promise<Response>,
  overrides: Partial<TestDependencies> = {},
): Promise<TestDependencies> {
  const directory = await mkdtemp(join(tmpdir(), "rawback-albums-"));
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

const album = {
  id: 7,
  name: "Iceland",
  description: "Winter trip",
  slug: "iceland",
  permission: "private",
  status: "ready",
  isSecret: false,
  coverImage: null,
  imageCount: 2,
  tags: [{ id: 3, name: "Travel", slug: "travel", color: "#123456" }],
  dateFrom: 1_704_067_200,
  dateTo: 1_706_659_199,
  timezone: "UTC",
  camera: { id: 4, make: "Sony", model: "A7" },
  lens: null,
  createdAt: 1_704_067_200,
  updatedAt: 1_704_153_600,
};

const image = {
  id: 11,
  displayName: "Waterfall",
  filename: "waterfall.jpg",
  url: "https://cdn.example/waterfall.jpg",
  thumbnailUrl: null,
  status: "completed",
  width: 1200,
  height: 800,
  blurhash: null,
  capturedAt: 1_704_067_200,
  cameraMake: "Sony",
  cameraModel: "A7",
  rotation: 0,
  rate: 5,
  editedImages: [],
};

const article = {
  id: 21,
  title: "Iceland in winter",
  content: "Hello ![Waterfall](rawback://image/11)",
  status: "draft",
  album: { id: 7, name: "Iceland", slug: "iceland" },
  images: [
    {
      id: 11,
      displayName: "Waterfall",
      filename: "waterfall.jpg",
      url: "https://cdn.example/waterfall.jpg",
      thumbnailUrl: null,
      width: 1200,
      height: 800,
      blurhash: null,
      rotation: 0,
      editedImages: [],
    },
  ],
  createdAt: 1_704_067_200,
  updatedAt: 1_704_153_600,
};

const pageInfo = {
  page: 1,
  pageSize: 20,
  totalCount: 1,
  totalPages: 1,
  hasNextPage: false,
  hasPreviousPage: false,
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("album commands", () => {
  test("builds validated create and edit inputs", () => {
    expect(
      createAlbumInput({
        name: "  Iceland  ",
        permission: "public",
        tagId: ["3,4", "3"],
        dateFrom: "2024-01-01",
        dateTo: "2024-12-31",
        timezone: "UTC",
        cameraId: 5,
      }),
    ).toEqual({
      name: "Iceland",
      permission: AlbumPermission.Public,
      tagIds: [3, 4],
      dateFrom: "2024-01-01",
      dateTo: "2024-12-31",
      timezone: "UTC",
      cameraId: 5,
    });

    expect(
      updateAlbumInput({
        id: 7,
        description: "",
        clearTags: true,
        clearDateFrom: true,
        clearCamera: true,
      }),
    ).toEqual({
      id: 7,
      description: "",
      tagIds: [],
      clearDateFrom: true,
      clearCameraId: true,
    });

    expect(() => updateAlbumInput({ id: 7 })).toThrow("at least one change");
    expect(() => updateAlbumInput({ id: 7, cameraId: 3, clearCamera: true })).toThrow(
      "cannot be used together",
    );
    expect(() =>
      createAlbumInput({ name: "x", dateFrom: "2025-01-02", dateTo: "2025-01-01" }),
    ).toThrow("must not be later");
  });

  test("lists and views albums with stable JSON", async () => {
    const output: string[] = [];
    const operations: string[] = [];
    const dependencies = await temporaryDependencies(
      (body) => {
        operations.push(String(body.operationName));
        if (body.operationName === "CliAlbums") {
          expect(body.variables).toEqual({
            keyword: "ice",
            pagination: { page: 1, pageSize: 20 },
          });
          return Response.json({ data: { me: { albums: { edges: [album], pageInfo } } } });
        }
        expect(body.variables).toEqual({ id: 7, pagination: { page: 2, pageSize: 24 } });
        return Response.json({
          data: {
            me: {
              album: {
                ...album,
                images: { edges: [image], pageInfo: { ...pageInfo, page: 2, pageSize: 24 } },
              },
            },
          },
        });
      },
      { stdout: (message) => output.push(message) },
    );

    await runAlbumList({ json: true, page: 1, pageSize: 20, search: " ice " }, dependencies);
    await runAlbumView({ id: 7, json: true, page: 2, pageSize: 24 }, dependencies);

    expect(operations).toEqual(["CliAlbums", "CliAlbum"]);
    expect(JSON.parse(output[0] ?? "")).toMatchObject({
      albums: [{ id: 7, coverImage: null, tags: [{ id: 3 }] }],
      pageInfo: { totalCount: 1 },
    });
    expect(JSON.parse(output[1] ?? "")).toMatchObject({
      album: { id: 7, camera: { id: 4 } },
      images: [{ id: 11, rate: 5 }],
      pageInfo: { page: 2 },
    });
  });

  test("creates and edits albums with typed mutation payloads", async () => {
    const output: string[] = [];
    const dependencies = await temporaryDependencies(
      (body) => {
        if (body.operationName === "CliCreateAlbum") {
          expect(body.variables).toEqual({
            input: { name: "New album", permission: "private", tagIds: [3] },
          });
          return Response.json({ data: { createAlbum: { ...album, name: "New album" } } });
        }
        expect(body.operationName).toBe("CliUpdateAlbum");
        expect(body.variables).toEqual({
          input: { id: 7, coverImageId: 11, clearTimezone: true },
        });
        return Response.json({ data: { updateAlbum: album } });
      },
      { stdout: (message) => output.push(message) },
    );

    await runAlbumCreate({ name: "New album", tagId: ["3"], json: true }, dependencies);
    await runAlbumEdit({ id: 7, coverImageId: 11, clearTimezone: true }, dependencies);

    expect(JSON.parse(output[0] ?? "")).toMatchObject({ id: 7, name: "New album" });
    expect(output[1]).toBe("✓ Updated album 7 (Iceland).");
  });

  test("manages image and tag membership", async () => {
    const operations: string[] = [];
    const dependencies = await temporaryDependencies(
      (body) => {
        operations.push(String(body.operationName));
        if (body.operationName === "CliAddImageToAlbum") {
          expect(body.variables).toEqual({ albumId: 7, imageId: 11 });
          return Response.json({ data: { addImageToAlbum: album } });
        }
        if (body.operationName === "CliRemoveImageFromAlbum") {
          expect(body.variables).toEqual({ albumId: 7, imageId: 11 });
          return Response.json({ data: { removeImageFromAlbum: album } });
        }
        if (body.operationName === "CliAddTagsToAlbum") {
          expect(body.variables).toEqual({ albumId: 7, tagIds: [3, 4] });
          return Response.json({ data: { addTagsToAlbum: album } });
        }
        expect(body.operationName).toBe("CliRemoveTagsFromAlbum");
        expect(body.variables).toEqual({ albumId: 7, tagIds: [3] });
        return Response.json({ data: { removeTagsFromAlbum: album } });
      },
      { stdout() {} },
    );

    await runAlbumImageAdd({ albumId: 7, imageId: 11 }, dependencies);
    await runAlbumImageRemove({ albumId: 7, imageId: 11, force: true }, dependencies);
    await runAlbumTagAdd({ albumId: 7, tagIds: ["3", "4", "3"] }, dependencies);
    await runAlbumTagRemove({ albumId: 7, tagIds: [3] }, dependencies);

    expect(operations).toEqual([
      "CliAddImageToAlbum",
      "CliRemoveImageFromAlbum",
      "CliAddTagsToAlbum",
      "CliRemoveTagsFromAlbum",
    ]);
  });

  test("cancels and force-deletes albums safely", async () => {
    const output: string[] = [];
    let requests = 0;
    const dependencies = await temporaryDependencies(
      (body) => {
        requests += 1;
        if (body.operationName === "CliAlbumSummary") {
          return Response.json({ data: { me: { album } } });
        }
        expect(body.operationName).toBe("CliDeleteAlbum");
        return Response.json({ data: { deleteAlbum: true } });
      },
      {
        prompts: {
          async confirm() {
            return false;
          },
        },
        stdout: (message) => output.push(message),
      },
    );

    await runAlbumDelete({ id: 7, json: true }, dependencies);
    expect(JSON.parse(output[0] ?? "")).toEqual({ deleted: false, id: 7 });
    expect(requests).toBe(1);

    await runAlbumDelete({ id: 7, force: true, json: true }, dependencies);
    expect(JSON.parse(output[1] ?? "")).toEqual({ deleted: true, id: 7 });
    expect(requests).toBe(2);
  });
});

describe("album article commands", () => {
  test("extracts canonical image tokens in stable order", () => {
    expect(
      extractArticleImageIds(
        "![One](rawback://image/11) ![Two](rawback://image/9) ![Again](rawback://image/11)",
      ),
    ).toEqual([11, 9]);
  });

  test("lists and views articles by album ID", async () => {
    const output: string[] = [];
    const dependencies = await temporaryDependencies(
      (body) => {
        if (body.operationName === "CliArticles") {
          expect(body.variables).toEqual({ pagination: { page: 1, pageSize: 12 } });
          return Response.json({
            data: {
              me: { articles: { edges: [article], pageInfo: { ...pageInfo, pageSize: 12 } } },
            },
          });
        }
        expect(body.operationName).toBe("CliAlbumArticle");
        expect(body.variables).toEqual({ albumId: 7 });
        return Response.json({
          data: { me: { album: { id: 7, name: "Iceland", slug: "iceland", article } } },
        });
      },
      { stdout: (message) => output.push(message) },
    );

    await runArticleList({ json: true, page: 1, pageSize: 12 }, dependencies);
    await runArticleView({ albumId: 7, contentOnly: true }, dependencies);

    expect(JSON.parse(output[0] ?? "")).toMatchObject({
      articles: [{ id: 21, album: { id: 7 }, images: [{ id: 11 }] }],
    });
    expect(output[1]).toBe(article.content);
  });

  test("edits article Markdown and derives image IDs", async () => {
    const markdown = [
      "# Trip",
      "![Waterfall](rawback://image/11)",
      "![Beach](rawback://image/12)",
      "![Waterfall again](rawback://image/11)",
    ].join("\n");
    const output: string[] = [];
    const dependencies = await temporaryDependencies(
      (body) => {
        expect(body.operationName).toBe("CliUpsertArticle");
        expect(body.variables).toEqual({
          input: {
            albumId: 7,
            title: "Trip notes",
            content: markdown,
            imageIds: [11, 12],
          },
        });
        return Response.json({ data: { upsertArticle: article } });
      },
      {
        async readContent(path) {
          expect(path).toBe("-");
          return markdown;
        },
        stdout: (message) => output.push(message),
      },
    );

    await runArticleEdit(
      { albumId: 7, contentFile: "-", title: "  Trip notes  ", json: true },
      dependencies,
    );
    expect(JSON.parse(output[0] ?? "")).toMatchObject({ id: 21, content: article.content });
  });

  test("publishes and unpublishes after resolving the album article", async () => {
    const operations: string[] = [];
    const dependencies = await temporaryDependencies(
      (body) => {
        operations.push(String(body.operationName));
        if (body.operationName === "CliAlbumArticle") {
          return Response.json({
            data: { me: { album: { id: 7, name: "Iceland", slug: "iceland", article } } },
          });
        }
        if (body.operationName === "CliPublishArticle") {
          expect(body.variables).toEqual({ id: 21 });
          return Response.json({
            data: { publishArticle: { ...article, status: "published" } },
          });
        }
        expect(body.operationName).toBe("CliUnpublishArticle");
        expect(body.variables).toEqual({ id: 21 });
        return Response.json({ data: { unpublishArticle: article } });
      },
      { stdout() {} },
    );

    await runArticlePublish({ albumId: 7 }, dependencies);
    await runArticleUnpublish({ albumId: 7 }, dependencies);
    expect(operations).toEqual([
      "CliAlbumArticle",
      "CliPublishArticle",
      "CliAlbumArticle",
      "CliUnpublishArticle",
    ]);
  });

  test("reports missing articles and confirms deletion", async () => {
    const output: string[] = [];
    let hasArticle = false;
    const dependencies = await temporaryDependencies(
      (body) => {
        if (body.operationName === "CliAlbumArticle") {
          return Response.json({
            data: {
              me: {
                album: {
                  id: 7,
                  name: "Iceland",
                  slug: "iceland",
                  article: hasArticle ? article : null,
                },
              },
            },
          });
        }
        expect(body.operationName).toBe("CliDeleteArticle");
        expect(body.variables).toEqual({ id: 21 });
        return Response.json({ data: { deleteArticle: true } });
      },
      {
        prompts: {
          async confirm() {
            return false;
          },
        },
        stdout: (message) => output.push(message),
      },
    );

    expect(runArticleView({ albumId: 7 }, dependencies)).rejects.toThrow(
      "rawback album article edit 7",
    );
    hasArticle = true;
    await runArticleDelete({ albumId: 7, json: true }, dependencies);
    expect(JSON.parse(output[0] ?? "")).toEqual({
      albumId: 7,
      articleId: 21,
      deleted: false,
    });
    await runArticleDelete({ albumId: 7, force: true, json: true }, dependencies);
    expect(JSON.parse(output[1] ?? "")).toEqual({
      albumId: 7,
      articleId: 21,
      deleted: true,
    });
  });
});
