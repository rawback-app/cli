import {
  createCommandClient,
  commandOutput,
  type ReadCommandDependencies,
  validatePagination,
} from "./command.ts";
import { dreamListDocument, dreamViewDocument } from "./features/dreams/view.ts";
import { type FragmentType, useFragment } from "@rawback/sdk";
import {
  type CliDreamFieldsFragment,
  CliDreamFieldsFragmentDoc,
  type CliDreamImageFieldsFragment,
  CliDreamImageFieldsFragmentDoc,
  CliDreamDocument,
  type CliDreamSummaryFieldsFragment,
  CliDreamSummaryFieldsFragmentDoc,
  CliDreamsDocument,
  CliRetryDreamDocument,
} from "@rawback/sdk";

export interface DreamPrompts {
  confirm(message: string): Promise<boolean>;
}

export interface DreamCommandDependencies extends ReadCommandDependencies {
  prompts?: DreamPrompts;
}

export interface DreamListOptions {
  json?: boolean;
  page: number;
  pageSize: number;
}

export interface DreamGetOptions {
  id: number;
  json?: boolean;
  page: number;
  pageSize: number;
}

export interface DreamRetryOptions {
  force?: boolean;
  id: number;
  json?: boolean;
}

function validateDreamId(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Dream ID must be a positive integer");
  }
  return value;
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

function summaryFragment(
  value: FragmentType<typeof CliDreamSummaryFieldsFragmentDoc>,
): CliDreamSummaryFieldsFragment {
  return useFragment(CliDreamSummaryFieldsFragmentDoc, value);
}

function dreamFragment(
  value: FragmentType<typeof CliDreamFieldsFragmentDoc>,
): CliDreamFieldsFragment {
  return useFragment(CliDreamFieldsFragmentDoc, value);
}

function imageFragment(
  value: FragmentType<typeof CliDreamImageFieldsFragmentDoc>,
): CliDreamImageFieldsFragment {
  return useFragment(CliDreamImageFieldsFragmentDoc, value);
}

type DreamSummary = Pick<
  CliDreamSummaryFieldsFragment,
  "id" | "dreamDate" | "status" | "title" | "imageUrl" | "photoCount" | "createdAt"
>;

function serializeDreamSummary(dream: DreamSummary) {
  return {
    id: dream.id,
    dreamDate: dream.dreamDate,
    status: dream.status,
    title: dream.title,
    imageUrl: dream.imageUrl ?? null,
    photoCount: dream.photoCount,
    createdAt: dream.createdAt,
  };
}

function serializeDream(dream: CliDreamFieldsFragment) {
  return {
    ...serializeDreamSummary(dream),
    userId: dream.userId,
    errorMessage: dream.errorMessage ?? null,
    skipReason: dream.skipReason ?? null,
    retryCount: dream.retryCount,
    descriptionMarkdown: dream.descriptionMarkdown,
    imageWidth: dream.imageWidth ?? null,
    imageHeight: dream.imageHeight ?? null,
    imageBlurhash: dream.imageBlurhash ?? null,
    places: dream.places,
    cameraModels: dream.cameraModels,
    cameras: dream.cameras.map((camera) => ({
      id: camera.id,
      make: camera.make ?? null,
      model: camera.model,
      imageCount: camera.imageCount,
      sensorWidth: camera.sensorWidth ?? null,
      sensorHeight: camera.sensorHeight ?? null,
      shutterCount: camera.shutterCount ?? null,
      product: camera.product
        ? {
            productImageUrl: camera.product.productImageUrl ?? null,
            yearReleased: camera.product.yearReleased ?? null,
          }
        : null,
    })),
    placeClusters: dream.placeClusters.map((place) => ({
      id: place.id,
      latitude: place.latitude,
      longitude: place.longitude,
      label: place.label,
      imageCount: place.imageCount,
    })),
  };
}

function serializePhoto(photo: CliDreamImageFieldsFragment) {
  return {
    id: photo.id,
    filename: photo.filename,
    url: photo.url,
    thumbnailUrl: photo.thumbnailUrl ?? null,
    status: photo.status,
    width: photo.width ?? null,
    height: photo.height ?? null,
    blurhash: photo.blurhash ?? null,
    capturedAt: photo.capturedAt ?? null,
    latitude: photo.latitude ?? null,
    longitude: photo.longitude ?? null,
    cameraMake: photo.cameraMake ?? null,
    cameraModel: photo.cameraModel ?? null,
    rotation: photo.rotation,
    rate: photo.rate ?? null,
    editedImages: photo.editedImages.map((image) => ({
      url: image.url,
      thumbnailUrl: image.thumbnailUrl ?? null,
      width: image.width,
      height: image.height,
      blurhash: image.blurhash ?? null,
      createdAt: image.createdAt,
    })),
  };
}

async function confirmRetry(dependencies: DreamCommandDependencies, id: number): Promise<boolean> {
  const message = `Retry dream ${id}? Regeneration may consume AI credits.`;
  if (dependencies.prompts) return dependencies.prompts.confirm(message);
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "Retrying a dream requires an interactive terminal unless --force is provided.",
    );
  }
  const { confirm } = await import("@inquirer/prompts");
  return confirm({ default: false, message });
}

export async function runDreamList(
  options: DreamListOptions,
  dependencies: DreamCommandDependencies = {},
): Promise<void> {
  validatePagination(options.page, options.pageSize);
  const ui = commandOutput(dependencies);
  const result = await ui.withActivity(
    "Loading dreams…",
    async () => {
      const client = await createCommandClient(dependencies);
      return client.graphql.query({
        query: CliDreamsDocument,
        variables: { pagination: { page: options.page, pageSize: options.pageSize } },
      });
    },
    !options.json,
  );
  if (result.error) throw result.error;
  if (!result.data) throw new Error("The dreams response did not include dream data");

  const dreams = result.data.dreams.edges.map(summaryFragment);
  const pagination = pageInfo(result.data.dreams.pageInfo);
  if (options.json) {
    ui.json({ dreams: dreams.map(serializeDreamSummary), pageInfo: pagination });
    return;
  }
  ui.document(dreamListDocument(dreams, pagination));
}

export async function runDreamGet(
  options: DreamGetOptions,
  dependencies: DreamCommandDependencies = {},
): Promise<void> {
  const id = validateDreamId(options.id);
  validatePagination(options.page, options.pageSize);
  const ui = commandOutput(dependencies);
  const result = await ui.withActivity(
    "Loading dream…",
    async () => {
      const client = await createCommandClient(dependencies);
      return client.graphql.query({
        query: CliDreamDocument,
        variables: { id, pagination: { page: options.page, pageSize: options.pageSize } },
      });
    },
    !options.json,
  );
  if (result.error) throw result.error;
  if (!result.data) throw new Error("The dream response did not include dream data");
  if (!result.data.dream) throw new Error(`Dream ${id} not found`);

  const dream = dreamFragment(result.data.dream);
  const photos = result.data.dream.images.edges.map(imageFragment);
  const pagination = pageInfo(result.data.dream.images.pageInfo);
  if (options.json) {
    ui.json({
      dream: serializeDream(dream),
      photos: photos.map(serializePhoto),
      pageInfo: pagination,
    });
    return;
  }
  ui.document(dreamViewDocument(dream, photos, pagination));
}

export async function runDreamRetry(
  options: DreamRetryOptions,
  dependencies: DreamCommandDependencies = {},
): Promise<void> {
  const id = validateDreamId(options.id);
  if (!options.force && !(await confirmRetry(dependencies, id))) {
    const ui = commandOutput(dependencies);
    if (options.json) {
      ui.json({ retried: false, id, status: null });
    } else {
      ui.info("Dream retry cancelled.");
    }
    return;
  }

  const client = await createCommandClient(dependencies);
  const result = await client.graphql.mutate({
    mutation: CliRetryDreamDocument,
    variables: { id },
  });
  if (result.error) throw result.error;
  const dream = result.data?.retryDream;
  if (!dream) throw new Error("The retry dream response did not include the dream status");

  const ui = commandOutput(dependencies);
  if (options.json) {
    ui.json({ retried: true, id: dream.id, status: dream.status });
  } else {
    ui.success(`Retry started for dream ${dream.id}.`);
  }
}
