import { readFile } from "node:fs/promises";

import {
  createCommandClient,
  output,
  type ReadCommandDependencies,
  validatePagination,
} from "./command.ts";
import { type FragmentType, useFragment } from "./gql/fragment-masking.ts";
import {
  type CliAlbumArticleQuery,
  CliAlbumArticleDocument,
  type CliArticleFieldsFragment,
  CliArticleFieldsFragmentDoc,
  type CliArticleImageFieldsFragment,
  CliArticleImageFieldsFragmentDoc,
  CliArticlesDocument,
  CliDeleteArticleDocument,
  CliPublishArticleDocument,
  CliUnpublishArticleDocument,
  CliUpsertArticleDocument,
  type UpsertArticleInput,
} from "./gql/graphql.ts";
import { formatJson, formatTable, formatTimestamp, sanitizeCell } from "./output.ts";
import { validatePositiveId } from "./albums.ts";

export interface ArticlePrompts {
  confirm(message: string): Promise<boolean>;
}

export interface ArticleCommandDependencies extends ReadCommandDependencies {
  prompts?: ArticlePrompts;
  readContent?: (path: string) => Promise<string>;
}

export interface ArticleListOptions {
  json?: boolean;
  page: number;
  pageSize: number;
}

export interface ArticleViewOptions {
  albumId: number;
  contentOnly?: boolean;
  json?: boolean;
}

export interface ArticleEditOptions {
  albumId: number;
  contentFile?: string;
  json?: boolean;
  title?: string;
}

export interface ArticleStatusOptions {
  albumId: number;
  json?: boolean;
}

export interface ArticleDeleteOptions extends ArticleStatusOptions {
  force?: boolean;
}

type AlbumArticle = NonNullable<CliAlbumArticleQuery["me"]["album"]>;

export function extractArticleImageIds(content: string): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  const pattern = /!\[[^\]]*\]\(rawback:\/\/image\/(\d+)\)/g;
  for (const match of content.matchAll(pattern)) {
    const value = match[1];
    if (value === undefined) continue;
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function pageInfo(page: {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}) {
  return {
    page: page.page,
    pageSize: page.pageSize,
    totalCount: page.totalCount,
    totalPages: page.totalPages,
    hasNextPage: page.hasNextPage,
    hasPreviousPage: page.hasPreviousPage,
  };
}

function articleFragment(
  value: FragmentType<typeof CliArticleFieldsFragmentDoc>,
): CliArticleFieldsFragment {
  return useFragment(CliArticleFieldsFragmentDoc, value);
}

function serializeArticleImage(image: CliArticleImageFieldsFragment) {
  return {
    id: image.id,
    displayName: image.displayName,
    filename: image.filename,
    url: image.url,
    thumbnailUrl: image.thumbnailUrl ?? null,
    width: image.width ?? null,
    height: image.height ?? null,
    blurhash: image.blurhash ?? null,
    rotation: image.rotation,
    editedImages: image.editedImages.map((edited) => ({
      url: edited.url,
      thumbnailUrl: edited.thumbnailUrl ?? null,
      width: edited.width,
      height: edited.height,
      blurhash: edited.blurhash ?? null,
      createdAt: edited.createdAt,
    })),
  };
}

export function serializeArticle(article: CliArticleFieldsFragment) {
  return {
    id: article.id,
    title: article.title,
    content: article.content,
    status: article.status,
    album: {
      id: article.album.id,
      name: article.album.name,
      slug: article.album.slug,
    },
    images: article.images.map((image) =>
      serializeArticleImage(useFragment(CliArticleImageFieldsFragmentDoc, image)),
    ),
    createdAt: article.createdAt,
    updatedAt: article.updatedAt,
  };
}

function articleTable(articles: CliArticleFieldsFragment[]): string {
  return formatTable(
    ["ID", "ALBUM ID", "ALBUM", "STATUS", "TITLE", "UPDATED"],
    articles.map((article) => [
      String(article.id),
      String(article.album.id),
      sanitizeCell(article.album.name),
      article.status,
      sanitizeCell(article.title) || "—",
      formatTimestamp(article.updatedAt),
    ]),
  );
}

function articleDetails(article: CliArticleFieldsFragment): string {
  return formatTable(
    ["FIELD", "VALUE"],
    [
      ["ID", String(article.id)],
      ["Album ID", String(article.album.id)],
      ["Album", sanitizeCell(article.album.name)],
      ["Title", sanitizeCell(article.title) || "—"],
      ["Status", article.status],
      ["Images", String(article.images.length)],
      ["Created", formatTimestamp(article.createdAt)],
      ["Updated", formatTimestamp(article.updatedAt)],
    ],
  );
}

async function queryAlbumArticle(
  albumId: number,
  dependencies: ArticleCommandDependencies,
): Promise<AlbumArticle> {
  const client = await createCommandClient(dependencies);
  const result = await client.graphql.query({
    query: CliAlbumArticleDocument,
    variables: { albumId },
  });
  if (result.error) throw result.error;
  if (!result.data) throw new Error("The article response did not include article data");
  const album = result.data.me.album;
  if (!album) throw new Error(`Album ${albumId} not found`);
  return album;
}

function requireArticle(album: AlbumArticle): CliArticleFieldsFragment {
  if (!album.article) {
    throw new Error(
      `Album ${album.id} has no article; create one with rawback album article edit ${album.id} --content-file <path|->`,
    );
  }
  return articleFragment(album.article);
}

async function defaultReadContent(path: string): Promise<string> {
  if (path === "-") return Bun.stdin.text();
  return readFile(path, "utf8");
}

async function confirm(
  dependencies: ArticleCommandDependencies,
  message: string,
): Promise<boolean> {
  if (dependencies.prompts) return dependencies.prompts.confirm(message);
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "Deleting an article requires an interactive terminal unless --force is provided.",
    );
  }
  const { confirm: prompt } = await import("@inquirer/prompts");
  return prompt({ default: false, message });
}

function writeArticle(
  article: CliArticleFieldsFragment,
  json: boolean | undefined,
  dependencies: ArticleCommandDependencies,
  message: string,
): void {
  output(dependencies, json ? formatJson(serializeArticle(article)) : message);
}

export async function runArticleList(
  options: ArticleListOptions,
  dependencies: ArticleCommandDependencies = {},
): Promise<void> {
  validatePagination(options.page, options.pageSize);
  const client = await createCommandClient(dependencies);
  const result = await client.graphql.query({
    query: CliArticlesDocument,
    variables: { pagination: { page: options.page, pageSize: options.pageSize } },
  });
  if (result.error) throw result.error;
  if (!result.data) throw new Error("The articles response did not include article data");
  const articles = result.data.me.articles.edges.map(articleFragment);
  const pagination = pageInfo(result.data.me.articles.pageInfo);
  if (options.json) {
    output(
      dependencies,
      formatJson({ articles: articles.map(serializeArticle), pageInfo: pagination }),
    );
  } else if (articles.length === 0) {
    output(dependencies, "No articles found.");
  } else {
    output(dependencies, articleTable(articles));
    output(
      dependencies,
      `Page ${pagination.page} of ${pagination.totalPages} (${pagination.totalCount} total articles).`,
    );
  }
}

export async function runArticleView(
  options: ArticleViewOptions,
  dependencies: ArticleCommandDependencies = {},
): Promise<void> {
  const albumId = validatePositiveId(options.albumId, "Album ID");
  if (options.contentOnly && options.json) {
    throw new Error("--content-only and --json cannot be used together");
  }
  const article = requireArticle(await queryAlbumArticle(albumId, dependencies));
  if (options.contentOnly) {
    output(dependencies, article.content);
  } else if (options.json) {
    output(dependencies, formatJson(serializeArticle(article)));
  } else {
    output(dependencies, articleDetails(article));
    output(dependencies, article.content || "No article content.");
  }
}

export async function runArticleEdit(
  options: ArticleEditOptions,
  dependencies: ArticleCommandDependencies = {},
): Promise<void> {
  const albumId = validatePositiveId(options.albumId, "Album ID");
  if (options.title === undefined && options.contentFile === undefined) {
    throw new Error("rawback album article edit requires --title or --content-file");
  }
  const input: UpsertArticleInput = {
    albumId,
    ...(options.title !== undefined ? { title: options.title.trim() } : {}),
  };
  if (options.contentFile !== undefined) {
    const path = options.contentFile.trim();
    if (path.length === 0) throw new Error("--content-file must not be empty");
    const content = await (dependencies.readContent ?? defaultReadContent)(path);
    input.content = content;
    input.imageIds = extractArticleImageIds(content);
  }
  const client = await createCommandClient(dependencies);
  const result = await client.graphql.mutate({
    mutation: CliUpsertArticleDocument,
    variables: { input },
  });
  if (result.error) throw result.error;
  const value = result.data?.upsertArticle;
  if (!value) throw new Error("The edit article response did not include the article");
  const article = articleFragment(value);
  writeArticle(
    article,
    options.json,
    dependencies,
    `Saved article ${article.id} for album ${article.album.id} (${article.album.name}).`,
  );
}

async function runArticleStatus(
  status: "publish" | "unpublish",
  options: ArticleStatusOptions,
  dependencies: ArticleCommandDependencies,
): Promise<void> {
  const albumId = validatePositiveId(options.albumId, "Album ID");
  const current = requireArticle(await queryAlbumArticle(albumId, dependencies));
  const client = await createCommandClient(dependencies);
  let value: FragmentType<typeof CliArticleFieldsFragmentDoc> | undefined;
  if (status === "publish") {
    const result = await client.graphql.mutate({
      mutation: CliPublishArticleDocument,
      variables: { id: current.id },
    });
    if (result.error) throw result.error;
    value = result.data?.publishArticle;
  } else {
    const result = await client.graphql.mutate({
      mutation: CliUnpublishArticleDocument,
      variables: { id: current.id },
    });
    if (result.error) throw result.error;
    value = result.data?.unpublishArticle;
  }
  if (!value) throw new Error(`The ${status} article response did not include the article`);
  const article = articleFragment(value);
  writeArticle(
    article,
    options.json,
    dependencies,
    `${status === "publish" ? "Published" : "Unpublished"} article ${article.id} for album ${albumId}.`,
  );
}

export function runArticlePublish(
  options: ArticleStatusOptions,
  dependencies: ArticleCommandDependencies = {},
): Promise<void> {
  return runArticleStatus("publish", options, dependencies);
}

export function runArticleUnpublish(
  options: ArticleStatusOptions,
  dependencies: ArticleCommandDependencies = {},
): Promise<void> {
  return runArticleStatus("unpublish", options, dependencies);
}

export async function runArticleDelete(
  options: ArticleDeleteOptions,
  dependencies: ArticleCommandDependencies = {},
): Promise<void> {
  const albumId = validatePositiveId(options.albumId, "Album ID");
  const article = requireArticle(await queryAlbumArticle(albumId, dependencies));
  if (!options.force) {
    const confirmed = await confirm(
      dependencies,
      `Delete article "${article.title || article.album.name}" (ID ${article.id}) from album ${albumId}?`,
    );
    if (!confirmed) {
      output(
        dependencies,
        options.json
          ? formatJson({ albumId, articleId: article.id, deleted: false })
          : "Deletion cancelled.",
      );
      return;
    }
  }
  const client = await createCommandClient(dependencies);
  const result = await client.graphql.mutate({
    mutation: CliDeleteArticleDocument,
    variables: { id: article.id },
  });
  if (result.error) throw result.error;
  if (result.data?.deleteArticle !== true) {
    throw new Error("The delete article response did not confirm deletion");
  }
  output(
    dependencies,
    options.json
      ? formatJson({ albumId, articleId: article.id, deleted: true })
      : `Deleted article ${article.id} from album ${albumId}.`,
  );
}
