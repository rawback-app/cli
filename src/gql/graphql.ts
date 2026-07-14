/* eslint-disable */
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = T | null | undefined;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  JSON: { input: any; output: any; }
  Time: { input: string; output: string; }
};

export type AiCreditsUsage = {
  __typename?: 'AICreditsUsage';
  balance: Scalars['Int']['output'];
  dailySeries: Array<UsagePoint>;
  monthlyAllowance: Scalars['Int']['output'];
  recentOperations: Array<CreditUsage>;
  resetAt?: Maybe<Scalars['Float']['output']>;
  tier: Scalars['String']['output'];
};


export type AiCreditsUsageRecentOperationsArgs = {
  limit?: Scalars['Int']['input'];
};

export type ApiToken = {
  __typename?: 'APIToken';
  createdAt: Scalars['Float']['output'];
  description?: Maybe<Scalars['String']['output']>;
  enabled: Scalars['Boolean']['output'];
  expireAt?: Maybe<Scalars['Float']['output']>;
  id: Scalars['Int']['output'];
  lastUsedAt?: Maybe<Scalars['Float']['output']>;
  name: Scalars['String']['output'];
  scopes: Array<Scalars['String']['output']>;
  token: Scalars['String']['output'];
};

export type AccountDeletionStats = {
  __typename?: 'AccountDeletionStats';
  dreamCount: Scalars['Int']['output'];
  faceCount: Scalars['Int']['output'];
  imageCount: Scalars['Int']['output'];
  storageUsedBytes: Scalars['Float']['output'];
};

export type AddFaceToPersonInput = {
  height: Scalars['Int']['input'];
  imageId: Scalars['Int']['input'];
  personId: Scalars['Int']['input'];
  width: Scalars['Int']['input'];
  x: Scalars['Int']['input'];
  y: Scalars['Int']['input'];
};

export type Admin = {
  __typename?: 'Admin';
  bots: Array<Bot>;
  equipmentProduct?: Maybe<EquipmentProduct>;
  equipmentProducts: EquipmentProductConnection;
  queues: Array<QueueInfo>;
  reportedComments: ReportedCommentConnection;
  reportedImages: ReportedImageConnection;
  tasks: TaskConnection;
  user?: Maybe<AdminUser>;
  userCameras: AdminUserCameraConnection;
  userLenses: AdminUserLensConnection;
  users: AdminUserConnection;
};


export type AdminEquipmentProductArgs = {
  id: Scalars['Int']['input'];
};


export type AdminEquipmentProductsArgs = {
  pagination: InputPagination;
};


export type AdminReportedCommentsArgs = {
  filter?: InputMaybe<AdminCommentFilter>;
  pagination: InputPagination;
};


export type AdminReportedImagesArgs = {
  filter?: InputMaybe<AdminImageFilter>;
  pagination: InputPagination;
};


export type AdminTasksArgs = {
  pagination: InputPagination;
  queue: Scalars['String']['input'];
  state: TaskState;
};


export type AdminUserArgs = {
  id: Scalars['Int']['input'];
};


export type AdminUserCamerasArgs = {
  filter?: InputMaybe<AdminUserEquipmentFilter>;
  pagination: InputPagination;
};


export type AdminUserLensesArgs = {
  filter?: InputMaybe<AdminUserEquipmentFilter>;
  pagination: InputPagination;
};


export type AdminUsersArgs = {
  filter?: InputMaybe<AdminUserFilter>;
  pagination: InputPagination;
};

export type AdminCommentFilter = {
  status?: InputMaybe<ModerationStatus>;
};

export type AdminImageFilter = {
  moderationStatus?: InputMaybe<ModerationStatus>;
};

export type AdminMutation = {
  __typename?: 'AdminMutation';
  enrichEquipmentProduct: Scalars['Boolean']['output'];
  moderateComment: Comment;
  moderateImage: Image;
  triggerBackfillBuiltinBots: Scalars['String']['output'];
  triggerBackfillImageOrientation: Scalars['String']['output'];
  updateBot: Bot;
  updateEquipmentProduct: EquipmentProduct;
  updateUserPlan: AdminUser;
};


export type AdminMutationEnrichEquipmentProductArgs = {
  id: Scalars['Int']['input'];
};


export type AdminMutationModerateCommentArgs = {
  input: ModerateCommentInput;
};


export type AdminMutationModerateImageArgs = {
  input: ModerateImageInput;
};


export type AdminMutationUpdateBotArgs = {
  input: UpdateBotInput;
};


export type AdminMutationUpdateEquipmentProductArgs = {
  input: UpdateEquipmentProductInput;
};


export type AdminMutationUpdateUserPlanArgs = {
  input: UpdateUserPlanInput;
};

export type AdminUser = {
  __typename?: 'AdminUser';
  aiCreditsRemaining: Scalars['Int']['output'];
  albumCount: Scalars['Int']['output'];
  avatar: Scalars['String']['output'];
  createdAt: Scalars['Float']['output'];
  email: Scalars['String']['output'];
  faceRecAddonUnits: Scalars['Int']['output'];
  faceRecRemaining: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  imageCount: Scalars['Int']['output'];
  isAdmin: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  slug: Scalars['String']['output'];
  storageAddonUnits: Scalars['Int']['output'];
  storageQuotaBytes: Scalars['Float']['output'];
  storageUsedBytes: Scalars['Float']['output'];
  subscriptionStatus: Scalars['String']['output'];
  tier: Scalars['String']['output'];
  updatedAt: Scalars['Float']['output'];
};

export type AdminUserCamera = {
  __typename?: 'AdminUserCamera';
  createdAt: Scalars['Float']['output'];
  firmwareVersion?: Maybe<Scalars['String']['output']>;
  id: Scalars['Int']['output'];
  imageCount: Scalars['Int']['output'];
  internalSerialNumber?: Maybe<Scalars['String']['output']>;
  make?: Maybe<Scalars['String']['output']>;
  model: Scalars['String']['output'];
  owner: AdminUser;
  product?: Maybe<EquipmentProduct>;
  serialNumber?: Maybe<Scalars['Float']['output']>;
  shutterCount?: Maybe<Scalars['Int']['output']>;
};

export type AdminUserCameraConnection = {
  __typename?: 'AdminUserCameraConnection';
  edges: Array<AdminUserCamera>;
  pageInfo: PageInfo;
};

export type AdminUserConnection = {
  __typename?: 'AdminUserConnection';
  edges: Array<AdminUser>;
  pageInfo: PageInfo;
};

export type AdminUserEquipmentFilter = {
  make?: InputMaybe<Scalars['String']['input']>;
  model?: InputMaybe<Scalars['String']['input']>;
  userId?: InputMaybe<Scalars['Int']['input']>;
};

export type AdminUserFilter = {
  email?: InputMaybe<Scalars['String']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  tier?: InputMaybe<Scalars['String']['input']>;
};

export type AdminUserLens = {
  __typename?: 'AdminUserLens';
  createdAt: Scalars['Float']['output'];
  id: Scalars['Int']['output'];
  imageCount: Scalars['Int']['output'];
  lensInfo?: Maybe<Scalars['String']['output']>;
  make?: Maybe<Scalars['String']['output']>;
  maxAperture?: Maybe<Scalars['Float']['output']>;
  maxFocalLength?: Maybe<Scalars['Float']['output']>;
  minAperture?: Maybe<Scalars['Float']['output']>;
  minFocalLength?: Maybe<Scalars['Float']['output']>;
  model: Scalars['String']['output'];
  owner: AdminUser;
  product?: Maybe<EquipmentProduct>;
  serialNumber?: Maybe<Scalars['Float']['output']>;
};

export type AdminUserLensConnection = {
  __typename?: 'AdminUserLensConnection';
  edges: Array<AdminUserLens>;
  pageInfo: PageInfo;
};

export type AiChat = {
  __typename?: 'AiChat';
  createdAt: Scalars['Float']['output'];
  id: Scalars['Int']['output'];
  latestMessage?: Maybe<AiChatMessage>;
  messageCount: Scalars['Int']['output'];
  messages: Array<AiChatMessage>;
  model: Scalars['String']['output'];
  sourceImageId: Scalars['Int']['output'];
  sourceType: Scalars['String']['output'];
  updatedAt: Scalars['Float']['output'];
};

export type AiChatConnection = {
  __typename?: 'AiChatConnection';
  edges: Array<AiChat>;
  pageInfo: PageInfo;
};

export type AiChatImageFilter = {
  createdAfter?: InputMaybe<Scalars['Float']['input']>;
  createdBefore?: InputMaybe<Scalars['Float']['input']>;
  model?: InputMaybe<Array<Scalars['String']['input']>>;
  search?: InputMaybe<Scalars['String']['input']>;
  sourceImageId?: InputMaybe<Scalars['Int']['input']>;
};

export type AiChatMessage = {
  __typename?: 'AiChatMessage';
  chatId: Scalars['Int']['output'];
  createdAt: Scalars['Float']['output'];
  editedImage?: Maybe<EditedImage>;
  id: Scalars['Int']['output'];
  model: Scalars['String']['output'];
  prompt: Scalars['String']['output'];
  quality?: Maybe<Scalars['String']['output']>;
  resultBlurhash?: Maybe<Scalars['String']['output']>;
  resultHeight?: Maybe<Scalars['Int']['output']>;
  resultSizeBytes: Scalars['Float']['output'];
  resultUrl: Scalars['String']['output'];
  resultWidth?: Maybe<Scalars['Int']['output']>;
  size?: Maybe<Scalars['String']['output']>;
  sourceImage?: Maybe<Image>;
};

export type AiChatMessageConnection = {
  __typename?: 'AiChatMessageConnection';
  edges: Array<AiChatMessage>;
  pageInfo: PageInfo;
};

export type Album = {
  __typename?: 'Album';
  article?: Maybe<Article>;
  camera?: Maybe<UserCamera>;
  commentCount: Scalars['Int']['output'];
  comments: CommentConnection;
  coverImage?: Maybe<Image>;
  createdAt: Scalars['Float']['output'];
  dateFrom?: Maybe<Scalars['Float']['output']>;
  dateTo?: Maybe<Scalars['Float']['output']>;
  description: Scalars['String']['output'];
  id: Scalars['Int']['output'];
  imageCount: Scalars['Int']['output'];
  images: ImageConnection;
  invitations: Array<AlbumInvitation>;
  isSecret: Scalars['Boolean']['output'];
  lens?: Maybe<UserLens>;
  name: Scalars['String']['output'];
  permission: AlbumPermission;
  places: NominatimGeoResult;
  previewImages: Array<Image>;
  reactions: Array<ReactionSummary>;
  slug: Scalars['String']['output'];
  status: AlbumStatus;
  tags: Array<Tag>;
  timezone?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['Float']['output'];
};


export type AlbumCommentsArgs = {
  pagination: InputPagination;
};


export type AlbumImagesArgs = {
  filter?: InputMaybe<ImageFilter>;
  orderBy?: InputMaybe<ImageOrderBy>;
  pagination: InputPagination;
};

export type AlbumConnection = {
  __typename?: 'AlbumConnection';
  edges: Array<Album>;
  pageInfo: PageInfo;
};

export type AlbumInvitation = {
  __typename?: 'AlbumInvitation';
  album: Album;
  createdAt: Scalars['Float']['output'];
  id: Scalars['Int']['output'];
  invitee: User;
  inviter: User;
  status: InvitationStatus;
};

export enum AlbumPermission {
  Private = 'private',
  Protected = 'protected',
  Public = 'public'
}

export enum AlbumStatus {
  Collecting = 'collecting',
  Ready = 'ready'
}

export type Article = {
  __typename?: 'Article';
  album: Album;
  content: Scalars['String']['output'];
  createdAt: Scalars['Float']['output'];
  id: Scalars['Int']['output'];
  images: Array<Image>;
  status: ArticleStatus;
  title: Scalars['String']['output'];
  updatedAt: Scalars['Float']['output'];
};

export type ArticleConnection = {
  __typename?: 'ArticleConnection';
  edges: Array<Article>;
  pageInfo: PageInfo;
};

export enum ArticleStatus {
  Draft = 'draft',
  Published = 'published'
}

export type AuthPayload = {
  __typename?: 'AuthPayload';
  accessToken: Scalars['String']['output'];
  expiresIn: Scalars['Int']['output'];
  refreshToken: Scalars['String']['output'];
};

export enum AuthorType {
  Ai = 'ai',
  User = 'user'
}

export type Bot = {
  __typename?: 'Bot';
  avatar: Scalars['String']['output'];
  creator?: Maybe<User>;
  description: Scalars['String']['output'];
  enabled: Scalars['Boolean']['output'];
  id: Scalars['Int']['output'];
  isBuiltin: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
  nameEn: Scalars['String']['output'];
  nameZh?: Maybe<Scalars['String']['output']>;
  parameters: Array<BotParameter>;
  permissions: Array<BotPermission>;
  slug: Scalars['String']['output'];
  sort: Scalars['Int']['output'];
  timeout: Scalars['Int']['output'];
  visibility: BotVisibility;
};

export type BotCall = {
  __typename?: 'BotCall';
  action: BotPermission;
  createdAt: Scalars['Time']['output'];
  endedAt?: Maybe<Scalars['Time']['output']>;
  error: Scalars['String']['output'];
  id: Scalars['Int']['output'];
  input: Scalars['String']['output'];
  output: Scalars['String']['output'];
  source: Scalars['String']['output'];
  startedAt: Scalars['Time']['output'];
  status: Scalars['String']['output'];
  steps: Array<BotCallStep>;
  targetId: Scalars['Int']['output'];
  targetType: Scalars['String']['output'];
};

export type BotCallConnection = {
  __typename?: 'BotCallConnection';
  edges: Array<BotCall>;
  pageInfo: PageInfo;
};

export type BotCallStep = {
  __typename?: 'BotCallStep';
  detail: Scalars['String']['output'];
  endedAt?: Maybe<Scalars['Time']['output']>;
  name: Scalars['String']['output'];
  startedAt?: Maybe<Scalars['Time']['output']>;
  status: Scalars['String']['output'];
};

export type BotParameter = {
  __typename?: 'BotParameter';
  key: Scalars['String']['output'];
  value: Scalars['String']['output'];
};

export type BotParameterInput = {
  key: Scalars['String']['input'];
  value: Scalars['String']['input'];
};

export enum BotPermission {
  Comment = 'comment',
  Rate = 'rate',
  Reaction = 'reaction'
}

export enum BotVisibility {
  Private = 'private',
  Public = 'public'
}

export type CaptureCalendarDay = {
  __typename?: 'CaptureCalendarDay';
  count: Scalars['Int']['output'];
  date: Scalars['String']['output'];
};

export type CategoryCount = {
  __typename?: 'CategoryCount';
  count: Scalars['Int']['output'];
  kind: PhotoCategory;
};

export type ChangePasswordInput = {
  currentPassword: Scalars['String']['input'];
  newPassword: Scalars['String']['input'];
};

export type Comment = {
  __typename?: 'Comment';
  aiProvider?: Maybe<Scalars['String']['output']>;
  author: User;
  authorType: AuthorType;
  bot?: Maybe<Bot>;
  content: Scalars['String']['output'];
  createdAt: Scalars['Float']['output'];
  id: Scalars['Int']['output'];
  isDeleted: Scalars['Boolean']['output'];
  parent?: Maybe<Comment>;
  reactions: Array<ReactionSummary>;
  replies: Array<Comment>;
  status: ModerationStatus;
  targetId: Scalars['Int']['output'];
  targetType: CommentTargetType;
  updatedAt: Scalars['Float']['output'];
};

export type CommentConnection = {
  __typename?: 'CommentConnection';
  edges: Array<Comment>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export enum CommentModerationDecision {
  Approve = 'approve',
  Reject = 'reject'
}

export type CommentReport = {
  __typename?: 'CommentReport';
  category: ReportCategory;
  createdAt: Scalars['Float']['output'];
  detail?: Maybe<Scalars['String']['output']>;
  id: Scalars['Int']['output'];
  reporter: AdminUser;
};

export enum CommentTargetType {
  Album = 'album',
  Image = 'image'
}

export type ConnectedCamera = {
  __typename?: 'ConnectedCamera';
  camera?: Maybe<UserCamera>;
  connectionCount: Scalars['Int']['output'];
  createdAt: Scalars['Time']['output'];
  firmwareVersion?: Maybe<Scalars['String']['output']>;
  id: Scalars['Int']['output'];
  lastConnectedAt?: Maybe<Scalars['Float']['output']>;
  lens?: Maybe<UserLens>;
  lensModel?: Maybe<Scalars['String']['output']>;
  macAddress?: Maybe<Scalars['String']['output']>;
  make?: Maybe<Scalars['String']['output']>;
  model: Scalars['String']['output'];
  serialNumber?: Maybe<Scalars['String']['output']>;
  storage: Array<ConnectedCameraStorage>;
};

export type ConnectedCameraStorage = {
  __typename?: 'ConnectedCameraStorage';
  freeBytes?: Maybe<Scalars['Float']['output']>;
  name: Scalars['String']['output'];
  objectCount?: Maybe<Scalars['Int']['output']>;
  totalBytes?: Maybe<Scalars['Float']['output']>;
};

export type ConnectedCameraStorageInput = {
  freeBytes?: InputMaybe<Scalars['Float']['input']>;
  name: Scalars['String']['input'];
  objectCount?: InputMaybe<Scalars['Int']['input']>;
  totalBytes?: InputMaybe<Scalars['Float']['input']>;
};

export type CreateApiTokenInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  expireAt?: InputMaybe<Scalars['Float']['input']>;
  name: Scalars['String']['input'];
  scopes?: InputMaybe<Array<Scalars['String']['input']>>;
};

export type CreateAlbumInput = {
  cameraId?: InputMaybe<Scalars['Int']['input']>;
  dateFrom?: InputMaybe<Scalars['String']['input']>;
  dateTo?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  isSecret?: InputMaybe<Scalars['Boolean']['input']>;
  lensId?: InputMaybe<Scalars['Int']['input']>;
  name: Scalars['String']['input'];
  permission?: InputMaybe<AlbumPermission>;
  tagIds: Array<Scalars['Int']['input']>;
  timezone?: InputMaybe<Scalars['String']['input']>;
};

export type CreateCommentInput = {
  aiProvider?: InputMaybe<Scalars['String']['input']>;
  content: Scalars['String']['input'];
  parentId?: InputMaybe<Scalars['Int']['input']>;
  targetId: Scalars['Int']['input'];
  targetType: CommentTargetType;
};

export type CreateFacePersonInput = {
  height: Scalars['Int']['input'];
  imageId: Scalars['Int']['input'];
  name: Scalars['String']['input'];
  width: Scalars['Int']['input'];
  x: Scalars['Int']['input'];
  y: Scalars['Int']['input'];
};

export type CreateShareInput = {
  accessType: ShareAccessType;
  albumId?: InputMaybe<Scalars['Int']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  expiration: ShareExpiration;
  frameKind: FrameKind;
  imageId?: InputMaybe<Scalars['Int']['input']>;
  minRating?: InputMaybe<Scalars['Int']['input']>;
  permission: SharePermissionInput;
  recipientEmails?: InputMaybe<Array<Scalars['String']['input']>>;
  shareType: ShareType;
  showExif: Scalars['Boolean']['input'];
  title?: InputMaybe<Scalars['String']['input']>;
};

export type CreateTagInput = {
  color?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
};

export type CreditCost = {
  __typename?: 'CreditCost';
  cost: Scalars['Int']['output'];
  description: Scalars['String']['output'];
  operation: Scalars['String']['output'];
  quotaType: Scalars['String']['output'];
};

export type CreditUsage = {
  __typename?: 'CreditUsage';
  createdAt: Scalars['Float']['output'];
  creditsAfter: Scalars['Int']['output'];
  creditsBefore: Scalars['Int']['output'];
  creditsUsed: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  metadata?: Maybe<Scalars['String']['output']>;
  operationType: Scalars['String']['output'];
  quotaType: Scalars['String']['output'];
  referenceId?: Maybe<Scalars['Int']['output']>;
  referenceType?: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
};

export type CreditUsageConnection = {
  __typename?: 'CreditUsageConnection';
  edges: Array<CreditUsage>;
  pageInfo: PageInfo;
};

export enum DevicePlatform {
  Ios = 'ios',
  Web = 'web'
}

export type DeviceToken = {
  __typename?: 'DeviceToken';
  createdAt: Scalars['Float']['output'];
  id: Scalars['Int']['output'];
  lastUsedAt?: Maybe<Scalars['Float']['output']>;
  platform: DevicePlatform;
};

export type Dream = {
  __typename?: 'Dream';
  cameraModels: Array<Scalars['String']['output']>;
  cameras: Array<UserCamera>;
  createdAt: Scalars['Float']['output'];
  descriptionMarkdown: Scalars['String']['output'];
  dreamDate: Scalars['String']['output'];
  errorMessage?: Maybe<Scalars['String']['output']>;
  id: Scalars['Int']['output'];
  imageBlurhash?: Maybe<Scalars['String']['output']>;
  imageHeight?: Maybe<Scalars['Int']['output']>;
  imageUrl?: Maybe<Scalars['String']['output']>;
  imageWidth?: Maybe<Scalars['Int']['output']>;
  images: ImageConnection;
  photoCount: Scalars['Int']['output'];
  placeClusters: Array<DreamPlace>;
  places: Array<Scalars['String']['output']>;
  retryCount: Scalars['Int']['output'];
  skipReason?: Maybe<Scalars['String']['output']>;
  status: Scalars['String']['output'];
  title: Scalars['String']['output'];
  userId: Scalars['Int']['output'];
};


export type DreamImagesArgs = {
  orderBy?: InputMaybe<ImageOrderBy>;
  pagination: InputPagination;
};

export type DreamConnection = {
  __typename?: 'DreamConnection';
  edges: Array<Dream>;
  pageInfo: PageInfo;
};

export type DreamPlace = {
  __typename?: 'DreamPlace';
  id: Scalars['Int']['output'];
  imageCount: Scalars['Int']['output'];
  label: Scalars['String']['output'];
  latitude: Scalars['Float']['output'];
  longitude: Scalars['Float']['output'];
};

export type EditedImage = {
  __typename?: 'EditedImage';
  blurhash?: Maybe<Scalars['String']['output']>;
  contentHash: Scalars['String']['output'];
  createdAt: Scalars['Float']['output'];
  filename: Scalars['String']['output'];
  height: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  mimeType: Scalars['String']['output'];
  s3Deleted: Scalars['Boolean']['output'];
  sizeBytes: Scalars['Float']['output'];
  thumbnailUrl?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['Float']['output'];
  url: Scalars['String']['output'];
  width: Scalars['Int']['output'];
};

export type EditedImageConnection = {
  __typename?: 'EditedImageConnection';
  edges: Array<EditedImage>;
  pageInfo: PageInfo;
};

export type EquipmentProduct = {
  __typename?: 'EquipmentProduct';
  createdAt: Scalars['Float']['output'];
  description?: Maybe<Scalars['String']['output']>;
  enrichmentError?: Maybe<Scalars['String']['output']>;
  enrichmentStatus: Scalars['String']['output'];
  equipmentType: EquipmentType;
  id: Scalars['Int']['output'];
  make?: Maybe<Scalars['String']['output']>;
  model: Scalars['String']['output'];
  msrp?: Maybe<Scalars['String']['output']>;
  productImageUrl?: Maybe<Scalars['String']['output']>;
  specs?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['Float']['output'];
  yearReleased?: Maybe<Scalars['Int']['output']>;
};

export type EquipmentProductConnection = {
  __typename?: 'EquipmentProductConnection';
  edges: Array<EquipmentProduct>;
  pageInfo: PageInfo;
};

export enum EquipmentType {
  Camera = 'camera',
  Lens = 'lens'
}

export type FaceDetection = {
  __typename?: 'FaceDetection';
  age?: Maybe<Scalars['Int']['output']>;
  beauty?: Maybe<Scalars['Int']['output']>;
  brightness?: Maybe<Scalars['Int']['output']>;
  confidence: Scalars['Float']['output'];
  createdAt: Scalars['Float']['output'];
  expression?: Maybe<Scalars['Int']['output']>;
  eyeOpen?: Maybe<Scalars['Boolean']['output']>;
  gender?: Maybe<Scalars['Int']['output']>;
  glass?: Maybe<Scalars['Boolean']['output']>;
  hairBang?: Maybe<Scalars['Int']['output']>;
  hairColor?: Maybe<Scalars['Int']['output']>;
  hairLength?: Maybe<Scalars['Int']['output']>;
  hat?: Maybe<Scalars['Boolean']['output']>;
  height: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  mask?: Maybe<Scalars['Boolean']['output']>;
  pitch?: Maybe<Scalars['Float']['output']>;
  qualityScore?: Maybe<Scalars['Int']['output']>;
  roll?: Maybe<Scalars['Float']['output']>;
  sharpness?: Maybe<Scalars['Int']['output']>;
  smile?: Maybe<Scalars['Int']['output']>;
  width: Scalars['Int']['output'];
  x: Scalars['Int']['output'];
  y: Scalars['Int']['output'];
  yaw?: Maybe<Scalars['Float']['output']>;
};

export type FaceLibrary = {
  __typename?: 'FaceLibrary';
  createdAt: Scalars['Time']['output'];
  id: Scalars['Int']['output'];
  peopleCount: Scalars['Int']['output'];
  tencentGroupId: Scalars['String']['output'];
};

export type FacePerson = {
  __typename?: 'FacePerson';
  coverImageUrl?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['Time']['output'];
  faceCount: Scalars['Int']['output'];
  faceImageUrls: Array<Scalars['String']['output']>;
  id: Scalars['Int']['output'];
  matchedImages: ImageConnection;
  name: Scalars['String']['output'];
};


export type FacePersonMatchedImagesArgs = {
  pagination: InputPagination;
};

export type FacePersonConnection = {
  __typename?: 'FacePersonConnection';
  edges: Array<FacePerson>;
  pageInfo: PageInfo;
};

export type FaceRecognitionUsage = {
  __typename?: 'FaceRecognitionUsage';
  dailySeries: Array<UsagePoint>;
  facesCount: Scalars['Int']['output'];
  monthlyAllowance: Scalars['Int']['output'];
  remaining: Scalars['Int']['output'];
  resetAt?: Maybe<Scalars['Float']['output']>;
  topFaces: Array<FacePerson>;
};


export type FaceRecognitionUsageTopFacesArgs = {
  limit?: Scalars['Int']['input'];
};

export type FocalLengthBucket = {
  __typename?: 'FocalLengthBucket';
  count: Scalars['Int']['output'];
  kind: FocalLengthKind;
};

export enum FocalLengthKind {
  MidTelephoto = 'midTelephoto',
  Standard = 'standard',
  SuperTelephoto = 'superTelephoto',
  Telephoto = 'telephoto',
  UltraWide = 'ultraWide',
  Wide = 'wide'
}

export enum FrameKind {
  FilmStrip = 'film_strip',
  None = 'none'
}

export type Image = {
  __typename?: 'Image';
  aiChat?: Maybe<AiChat>;
  aiChats: AiChatConnection;
  aiDescription?: Maybe<Scalars['String']['output']>;
  aiEditedImages: Array<AiChatMessage>;
  aiTitle?: Maybe<Scalars['String']['output']>;
  albumIds: Array<Scalars['Int']['output']>;
  altitude?: Maybe<Scalars['Float']['output']>;
  aperture?: Maybe<Scalars['Float']['output']>;
  archivedAt?: Maybe<Scalars['Time']['output']>;
  blurhash?: Maybe<Scalars['String']['output']>;
  camera?: Maybe<UserCamera>;
  cameraId?: Maybe<Scalars['Int']['output']>;
  cameraMake?: Maybe<Scalars['String']['output']>;
  cameraModel?: Maybe<Scalars['String']['output']>;
  capturedAt?: Maybe<Scalars['Float']['output']>;
  city?: Maybe<Scalars['String']['output']>;
  commentCount: Scalars['Int']['output'];
  comments: CommentConnection;
  country?: Maybe<Scalars['String']['output']>;
  countryCode?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['Float']['output'];
  displayDesc: Scalars['String']['output'];
  displayName: Scalars['String']['output'];
  editedImages: Array<EditedImage>;
  errorReason?: Maybe<Scalars['String']['output']>;
  exposureMode?: Maybe<Scalars['Int']['output']>;
  exposureProgram?: Maybe<Scalars['Int']['output']>;
  exposureTime?: Maybe<Scalars['String']['output']>;
  extension: Scalars['String']['output'];
  eyeDetection?: Maybe<Scalars['Boolean']['output']>;
  faceMatches: Array<ImageFaceMatch>;
  faces: Array<FaceDetection>;
  filename: Scalars['String']['output'];
  flash?: Maybe<Scalars['Boolean']['output']>;
  focalLength?: Maybe<Scalars['Float']['output']>;
  focalLength35mm?: Maybe<Scalars['Float']['output']>;
  focusDistance?: Maybe<Scalars['Float']['output']>;
  fullsizeUrl?: Maybe<Scalars['String']['output']>;
  height?: Maybe<Scalars['Int']['output']>;
  id: Scalars['Int']['output'];
  imageUniqueId?: Maybe<Scalars['String']['output']>;
  isHidden: Scalars['Boolean']['output'];
  iso?: Maybe<Scalars['Int']['output']>;
  latitude?: Maybe<Scalars['Float']['output']>;
  lens?: Maybe<UserLens>;
  lensId?: Maybe<Scalars['Int']['output']>;
  lensModel?: Maybe<Scalars['String']['output']>;
  longitude?: Maybe<Scalars['Float']['output']>;
  meteringMode?: Maybe<Scalars['Int']['output']>;
  mimeType: Scalars['String']['output'];
  moderationStatus: ModerationStatus;
  orientation?: Maybe<Scalars['Int']['output']>;
  originalFilename: Scalars['String']['output'];
  owner: User;
  place?: Maybe<NominatimGeo>;
  rate?: Maybe<Scalars['Float']['output']>;
  reactions: Array<ReactionSummary>;
  rotation: Scalars['Int']['output'];
  s3Deleted: Scalars['Boolean']['output'];
  sizeBytes: Scalars['Float']['output'];
  state?: Maybe<Scalars['String']['output']>;
  status: ImageStatus;
  tags: Array<Tag>;
  tasks: ImageTaskProgress;
  thumbnailHeight?: Maybe<Scalars['Int']['output']>;
  thumbnailUrl?: Maybe<Scalars['String']['output']>;
  thumbnailWidth?: Maybe<Scalars['Int']['output']>;
  timezone?: Maybe<Scalars['Int']['output']>;
  updatedAt: Scalars['Float']['output'];
  url: Scalars['String']['output'];
  whiteBalance?: Maybe<Scalars['Int']['output']>;
  width?: Maybe<Scalars['Int']['output']>;
};


export type ImageAiChatArgs = {
  id: Scalars['Int']['input'];
};


export type ImageAiChatsArgs = {
  pagination: InputPagination;
};


export type ImageCommentsArgs = {
  pagination: InputPagination;
};

export type ImageConnection = {
  __typename?: 'ImageConnection';
  edges: Array<Image>;
  pageInfo: PageInfo;
};

export type ImageFaceMatch = {
  __typename?: 'ImageFaceMatch';
  confidence: Scalars['Float']['output'];
  height: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  imageId: Scalars['Int']['output'];
  person: FacePerson;
  width: Scalars['Int']['output'];
  x: Scalars['Int']['output'];
  y: Scalars['Int']['output'];
};

export type ImageFilter = {
  apertureMax?: InputMaybe<Scalars['Float']['input']>;
  apertureMin?: InputMaybe<Scalars['Float']['input']>;
  archived?: InputMaybe<Scalars['Boolean']['input']>;
  cameraMake?: InputMaybe<Array<Scalars['String']['input']>>;
  cameraModel?: InputMaybe<Array<Scalars['String']['input']>>;
  capturedAfter?: InputMaybe<Scalars['Float']['input']>;
  capturedBefore?: InputMaybe<Scalars['Float']['input']>;
  city?: InputMaybe<Array<Scalars['String']['input']>>;
  country?: InputMaybe<Array<Scalars['String']['input']>>;
  focalLengthMax?: InputMaybe<Scalars['Float']['input']>;
  focalLengthMin?: InputMaybe<Scalars['Float']['input']>;
  hasGps?: InputMaybe<Scalars['Boolean']['input']>;
  isHidden?: InputMaybe<Scalars['Boolean']['input']>;
  lensModel?: InputMaybe<Array<Scalars['String']['input']>>;
  rate?: InputMaybe<Array<Scalars['Int']['input']>>;
  search?: InputMaybe<Scalars['String']['input']>;
  showAllFaces?: InputMaybe<Scalars['Boolean']['input']>;
  status?: InputMaybe<Array<ImageStatus>>;
  uploadId?: InputMaybe<Scalars['Int']['input']>;
};

export enum ImageJobStatus {
  Completed = 'completed',
  Failed = 'failed',
  Pending = 'pending',
  Processing = 'processing',
  Skipped = 'skipped'
}

export enum ImageModerationDecision {
  Approve = 'approve',
  Reject = 'reject'
}

export type ImageNeighbors = {
  __typename?: 'ImageNeighbors';
  nextId?: Maybe<Scalars['Int']['output']>;
  prevId?: Maybe<Scalars['Int']['output']>;
};

export enum ImageOrderBy {
  CreatedAtDesc = 'CREATED_AT_DESC',
  RateDesc = 'RATE_DESC'
}

export type ImageReport = {
  __typename?: 'ImageReport';
  category: ReportCategory;
  createdAt: Scalars['Float']['output'];
  detail?: Maybe<Scalars['String']['output']>;
  id: Scalars['Int']['output'];
  reporter: AdminUser;
};

export enum ImageStatus {
  Completed = 'completed',
  Failed = 'failed',
  Pending = 'pending',
  Processing = 'processing'
}

export type ImageTaskProgress = {
  __typename?: 'ImageTaskProgress';
  progress: Scalars['Float']['output'];
  status: ImageStatus;
  steps: Array<ImageTaskStep>;
};

export type ImageTaskStep = {
  __typename?: 'ImageTaskStep';
  error?: Maybe<Scalars['String']['output']>;
  finishedAt?: Maybe<Scalars['Float']['output']>;
  startedAt?: Maybe<Scalars['Float']['output']>;
  status: ImageJobStatus;
  type: ImageTaskType;
};

export enum ImageTaskType {
  AiAnalyze = 'ai_analyze',
  Analyze = 'analyze',
  EquipmentExtract = 'equipment_extract',
  Geocode = 'geocode',
  Parse = 'parse',
  PeopleRecognize = 'people_recognize'
}

export type InputPagination = {
  page: Scalars['Int']['input'];
  pageSize: Scalars['Int']['input'];
};

export type InvitationCode = {
  __typename?: 'InvitationCode';
  code: Scalars['String']['output'];
  createdAt: Scalars['Float']['output'];
  id: Scalars['Int']['output'];
  invitees: Array<InvitationInvitee>;
  maxUses: Scalars['Int']['output'];
  useCount: Scalars['Int']['output'];
};

export type InvitationInvitee = {
  __typename?: 'InvitationInvitee';
  avatar: Scalars['String']['output'];
  email: Scalars['String']['output'];
  id: Scalars['Int']['output'];
  joinedAt: Scalars['Float']['output'];
  name: Scalars['String']['output'];
};

export enum InvitationStatus {
  Accepted = 'accepted',
  Declined = 'declined',
  Pending = 'pending'
}

export type LoginAuditLog = {
  __typename?: 'LoginAuditLog';
  action: Scalars['String']['output'];
  city?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['Float']['output'];
  id: Scalars['Int']['output'];
  ipAddress?: Maybe<Scalars['String']['output']>;
  userAgent?: Maybe<Scalars['String']['output']>;
};

export type LoginAuditLogConnection = {
  __typename?: 'LoginAuditLogConnection';
  edges: Array<LoginAuditLog>;
  pageInfo: PageInfo;
};

export type LoginWithEmailInput = {
  email: Scalars['String']['input'];
  password: Scalars['String']['input'];
};

export type ModerateCommentInput = {
  commentId: Scalars['Int']['input'];
  decision: CommentModerationDecision;
};

export type ModerateImageInput = {
  decision: ImageModerationDecision;
  imageId: Scalars['Int']['input'];
};

export enum ModerationStatus {
  Approved = 'approved',
  Flagged = 'flagged',
  Normal = 'normal',
  Rejected = 'rejected',
  Reported = 'reported'
}

export type Mutation = {
  __typename?: 'Mutation';
  addFaceToPerson: FacePerson;
  addImageToAlbum: Album;
  addProfilePhoto: ProfilePhoto;
  addShareRecipients: Share;
  addTagsToAlbum: Album;
  addTagsToImage: Image;
  adminMutation: AdminMutation;
  archiveImage: Image;
  archiveImages: Scalars['Int']['output'];
  cancelAccountDeletion: Scalars['Boolean']['output'];
  changePassword: Scalars['Boolean']['output'];
  clearOpenAISettings: UserPreferences;
  clearS3Settings: UserPreferences;
  createAPIToken: ApiToken;
  createAlbum: Album;
  createComment: Comment;
  createFacePerson: FacePerson;
  createSFTPCredential: SftpCredentialWithPassword;
  createShare: Share;
  createTag: Tag;
  deleteAPIToken: Scalars['Boolean']['output'];
  deleteAccount: Scalars['Boolean']['output'];
  deleteAlbum: Scalars['Boolean']['output'];
  deleteArticle: Scalars['Boolean']['output'];
  deleteComment: Scalars['Boolean']['output'];
  deleteEditedImage: Scalars['Boolean']['output'];
  deleteFacePerson: Scalars['Boolean']['output'];
  deleteImage: Scalars['Boolean']['output'];
  deleteSFTPCredential: Scalars['Boolean']['output'];
  deleteShare: Scalars['Boolean']['output'];
  deleteTag: Scalars['Boolean']['output'];
  generateInvitationCode: InvitationCode;
  inviteToAlbum: AlbumInvitation;
  loginWithEmail: AuthPayload;
  markAllNotificationsRead: Scalars['Boolean']['output'];
  markNotificationRead: Notification;
  publishArticle: Article;
  reanalyzeImages: ReanalyzeImagesResult;
  regenerateSFTPCredential: SftpCredentialWithPassword;
  regenerateShareCode: Share;
  registerDeviceToken: DeviceToken;
  registerWebPushSubscription: DeviceToken;
  removeFaceFromPerson: FacePerson;
  removeFromAlbum: Scalars['Boolean']['output'];
  removeImageFromAlbum: Album;
  removeProfilePhoto: Scalars['Boolean']['output'];
  removeShareRecipient: Share;
  removeTagsFromAlbum: Album;
  removeTagsFromImage: Image;
  renameFacePerson: FacePerson;
  reorderProfilePhotos: Scalars['Boolean']['output'];
  reportComment: Comment;
  reportConnectedCamera: ConnectedCamera;
  reportImage: Image;
  respondToInvitation: AlbumInvitation;
  retryDream: Dream;
  sendToLightroom: Scalars['Boolean']['output'];
  setPassword: Scalars['Boolean']['output'];
  shareResource: Array<ResourceShare>;
  syncUserLocation: UserLocation;
  testOpenAISettings: Scalars['Boolean']['output'];
  testS3Settings: Scalars['Boolean']['output'];
  toggleReaction: ReactionResult;
  unarchiveImage: Image;
  unlinkAdobe: Scalars['Boolean']['output'];
  unlinkApple: Scalars['Boolean']['output'];
  unpublishArticle: Article;
  unregisterDeviceToken: Scalars['Boolean']['output'];
  unregisterWebPushSubscription: Scalars['Boolean']['output'];
  unshareResource: Scalars['Boolean']['output'];
  updateAlbum: Album;
  updateComment: Comment;
  updateImage: Image;
  updateNotificationPreferences: NotificationPreferences;
  updateOpenAISettings: UserPreferences;
  updateS3Settings: UserPreferences;
  updateShare: Share;
  updateTag: Tag;
  updateUser: User;
  updateUserBot: UserBot;
  updateUserPreferences: UserPreferences;
  upsertArticle: Article;
};


export type MutationAddFaceToPersonArgs = {
  input: AddFaceToPersonInput;
};


export type MutationAddImageToAlbumArgs = {
  albumId: Scalars['Int']['input'];
  imageId: Scalars['Int']['input'];
};


export type MutationAddProfilePhotoArgs = {
  imageId: Scalars['Int']['input'];
};


export type MutationAddShareRecipientsArgs = {
  emails: Array<Scalars['String']['input']>;
  shareId: Scalars['Int']['input'];
};


export type MutationAddTagsToAlbumArgs = {
  albumId: Scalars['Int']['input'];
  tagIds: Array<Scalars['Int']['input']>;
};


export type MutationAddTagsToImageArgs = {
  imageId: Scalars['Int']['input'];
  tagIds: Array<Scalars['Int']['input']>;
};


export type MutationArchiveImageArgs = {
  id: Scalars['Int']['input'];
};


export type MutationArchiveImagesArgs = {
  ids: Array<Scalars['Int']['input']>;
};


export type MutationChangePasswordArgs = {
  input: ChangePasswordInput;
};


export type MutationCreateApiTokenArgs = {
  input: CreateApiTokenInput;
};


export type MutationCreateAlbumArgs = {
  input: CreateAlbumInput;
};


export type MutationCreateCommentArgs = {
  input: CreateCommentInput;
};


export type MutationCreateFacePersonArgs = {
  input: CreateFacePersonInput;
};


export type MutationCreateSftpCredentialArgs = {
  name: Scalars['String']['input'];
  password?: InputMaybe<Scalars['String']['input']>;
};


export type MutationCreateShareArgs = {
  input: CreateShareInput;
};


export type MutationCreateTagArgs = {
  input: CreateTagInput;
};


export type MutationDeleteApiTokenArgs = {
  id: Scalars['Int']['input'];
};


export type MutationDeleteAlbumArgs = {
  id: Scalars['Int']['input'];
};


export type MutationDeleteArticleArgs = {
  id: Scalars['Int']['input'];
};


export type MutationDeleteCommentArgs = {
  id: Scalars['Int']['input'];
};


export type MutationDeleteEditedImageArgs = {
  id: Scalars['Int']['input'];
};


export type MutationDeleteFacePersonArgs = {
  id: Scalars['Int']['input'];
};


export type MutationDeleteImageArgs = {
  id: Scalars['Int']['input'];
};


export type MutationDeleteSftpCredentialArgs = {
  id: Scalars['Int']['input'];
};


export type MutationDeleteShareArgs = {
  id: Scalars['Int']['input'];
};


export type MutationDeleteTagArgs = {
  id: Scalars['Int']['input'];
};


export type MutationInviteToAlbumArgs = {
  albumId: Scalars['Int']['input'];
  userEmail: Scalars['String']['input'];
};


export type MutationLoginWithEmailArgs = {
  input: LoginWithEmailInput;
};


export type MutationMarkNotificationReadArgs = {
  id: Scalars['Int']['input'];
};


export type MutationPublishArticleArgs = {
  id: Scalars['Int']['input'];
};


export type MutationReanalyzeImagesArgs = {
  input: ReanalyzeImagesInput;
};


export type MutationRegenerateSftpCredentialArgs = {
  id: Scalars['Int']['input'];
};


export type MutationRegenerateShareCodeArgs = {
  id: Scalars['Int']['input'];
};


export type MutationRegisterDeviceTokenArgs = {
  input: RegisterDeviceTokenInput;
};


export type MutationRegisterWebPushSubscriptionArgs = {
  input: RegisterWebPushSubscriptionInput;
};


export type MutationRemoveFaceFromPersonArgs = {
  input: RemoveFaceFromPersonInput;
};


export type MutationRemoveFromAlbumArgs = {
  albumId: Scalars['Int']['input'];
  userId: Scalars['Int']['input'];
};


export type MutationRemoveImageFromAlbumArgs = {
  albumId: Scalars['Int']['input'];
  imageId: Scalars['Int']['input'];
};


export type MutationRemoveProfilePhotoArgs = {
  imageId: Scalars['Int']['input'];
};


export type MutationRemoveShareRecipientArgs = {
  recipientId: Scalars['Int']['input'];
  shareId: Scalars['Int']['input'];
};


export type MutationRemoveTagsFromAlbumArgs = {
  albumId: Scalars['Int']['input'];
  tagIds: Array<Scalars['Int']['input']>;
};


export type MutationRemoveTagsFromImageArgs = {
  imageId: Scalars['Int']['input'];
  tagIds: Array<Scalars['Int']['input']>;
};


export type MutationRenameFacePersonArgs = {
  id: Scalars['Int']['input'];
  name: Scalars['String']['input'];
};


export type MutationReorderProfilePhotosArgs = {
  imageIds: Array<Scalars['Int']['input']>;
};


export type MutationReportCommentArgs = {
  input: ReportCommentInput;
};


export type MutationReportConnectedCameraArgs = {
  input: ReportConnectedCameraInput;
};


export type MutationReportImageArgs = {
  input: ReportImageInput;
};


export type MutationRespondToInvitationArgs = {
  accept: Scalars['Boolean']['input'];
  invitationId: Scalars['Int']['input'];
};


export type MutationRetryDreamArgs = {
  id: Scalars['Int']['input'];
};


export type MutationSendToLightroomArgs = {
  imageId: Scalars['Int']['input'];
};


export type MutationSetPasswordArgs = {
  input: SetPasswordInput;
};


export type MutationShareResourceArgs = {
  input: ShareResourceInput;
};


export type MutationSyncUserLocationArgs = {
  input: SyncUserLocationInput;
};


export type MutationTestOpenAiSettingsArgs = {
  input: TestOpenAiSettingsInput;
};


export type MutationTestS3SettingsArgs = {
  input: TestS3SettingsInput;
};


export type MutationToggleReactionArgs = {
  input: ToggleReactionInput;
};


export type MutationUnarchiveImageArgs = {
  id: Scalars['Int']['input'];
};


export type MutationUnpublishArticleArgs = {
  id: Scalars['Int']['input'];
};


export type MutationUnregisterDeviceTokenArgs = {
  token: Scalars['String']['input'];
};


export type MutationUnregisterWebPushSubscriptionArgs = {
  endpoint: Scalars['String']['input'];
};


export type MutationUnshareResourceArgs = {
  input: UnshareResourceInput;
};


export type MutationUpdateAlbumArgs = {
  input: UpdateAlbumInput;
};


export type MutationUpdateCommentArgs = {
  input: UpdateCommentInput;
};


export type MutationUpdateImageArgs = {
  input: UpdateImageInput;
};


export type MutationUpdateNotificationPreferencesArgs = {
  input: NotificationPreferencesInput;
};


export type MutationUpdateOpenAiSettingsArgs = {
  input: UpdateOpenAiSettingsInput;
};


export type MutationUpdateS3SettingsArgs = {
  input: UpdateS3SettingsInput;
};


export type MutationUpdateShareArgs = {
  input: UpdateShareInput;
};


export type MutationUpdateTagArgs = {
  input: UpdateTagInput;
};


export type MutationUpdateUserArgs = {
  input: UpdateUserInput;
};


export type MutationUpdateUserBotArgs = {
  input: UpdateUserBotInput;
};


export type MutationUpdateUserPreferencesArgs = {
  input: UpdateUserPreferencesInput;
};


export type MutationUpsertArticleArgs = {
  input: UpsertArticleInput;
};

export type NominatimGeo = {
  __typename?: 'NominatimGeo';
  city: Scalars['String']['output'];
  country: Scalars['String']['output'];
  countryCode: Scalars['String']['output'];
  displayName: Scalars['String']['output'];
  id: Scalars['Int']['output'];
  latitude: Scalars['Float']['output'];
  longitude: Scalars['Float']['output'];
  name: Scalars['String']['output'];
  state: Scalars['String']['output'];
};

export type NominatimGeoResult = {
  __typename?: 'NominatimGeoResult';
  count: Scalars['Int']['output'];
  edges: Array<NominatimGeo>;
};

export type Notification = {
  __typename?: 'Notification';
  actionUrl?: Maybe<Scalars['String']['output']>;
  actor?: Maybe<User>;
  actorType: AuthorType;
  createdAt: Scalars['Float']['output'];
  description: Scalars['String']['output'];
  icon?: Maybe<Scalars['String']['output']>;
  id: Scalars['Int']['output'];
  level: NotificationLevel;
  read: Scalars['Boolean']['output'];
  referenceId?: Maybe<Scalars['Int']['output']>;
  targetId?: Maybe<Scalars['Int']['output']>;
  targetType?: Maybe<Scalars['String']['output']>;
  title: Scalars['String']['output'];
  type: NotificationType;
};

export type NotificationConnection = {
  __typename?: 'NotificationConnection';
  edges: Array<Notification>;
  pageInfo: PageInfo;
  unreadCount: Scalars['Int']['output'];
};

export type NotificationFilter = {
  categories?: InputMaybe<Array<NotificationType>>;
  dateFrom?: InputMaybe<Scalars['String']['input']>;
  dateTo?: InputMaybe<Scalars['String']['input']>;
  levels?: InputMaybe<Array<NotificationLevel>>;
  read?: InputMaybe<Scalars['Boolean']['input']>;
};

export enum NotificationLevel {
  Error = 'error',
  Info = 'info',
  Warning = 'warning'
}

export type NotificationPreferences = {
  __typename?: 'NotificationPreferences';
  email: Scalars['Boolean']['output'];
  inApp: Scalars['Boolean']['output'];
  push: Scalars['Boolean']['output'];
};

export type NotificationPreferencesInput = {
  email: Scalars['Boolean']['input'];
  inApp: Scalars['Boolean']['input'];
  push: Scalars['Boolean']['input'];
};

export enum NotificationType {
  Comment = 'comment',
  CommentReply = 'comment_reply',
  Dream = 'dream',
  Message = 'message',
  Reaction = 'reaction',
  Report = 'report'
}

export type OnThisDayGroup = {
  __typename?: 'OnThisDayGroup';
  photoCount: Scalars['Int']['output'];
  photos: Array<Image>;
  year: Scalars['Int']['output'];
  yearsAgo: Scalars['Int']['output'];
};

export type OpenAiSettings = {
  __typename?: 'OpenAISettings';
  apiKeyHint?: Maybe<Scalars['String']['output']>;
  apiKeyLength?: Maybe<Scalars['Int']['output']>;
  endpoint?: Maybe<Scalars['String']['output']>;
  hasApiKey: Scalars['Boolean']['output'];
  model?: Maybe<Scalars['String']['output']>;
};

export type OutgoingShare = {
  __typename?: 'OutgoingShare';
  album?: Maybe<Album>;
  createdAt: Scalars['Float']['output'];
  dream?: Maybe<Dream>;
  id: Scalars['String']['output'];
  image?: Maybe<Image>;
  kind: OutgoingShareKind;
  link?: Maybe<Share>;
  recipientCount: Scalars['Int']['output'];
  recipients: Array<User>;
  resourceType: ShareResourceType;
};

export type OutgoingShareConnection = {
  __typename?: 'OutgoingShareConnection';
  edges: Array<OutgoingShare>;
  pageInfo: PageInfo;
};

export enum OutgoingShareKind {
  Direct = 'direct',
  Link = 'link'
}

export type PageInfo = {
  __typename?: 'PageInfo';
  hasNextPage: Scalars['Boolean']['output'];
  hasPreviousPage: Scalars['Boolean']['output'];
  page: Scalars['Int']['output'];
  pageSize: Scalars['Int']['output'];
  totalCount: Scalars['Int']['output'];
  totalPages: Scalars['Int']['output'];
};

export enum PhotoCategory {
  Architecture = 'architecture',
  Documentary = 'documentary',
  Event = 'event',
  Family = 'family',
  Fashion = 'fashion',
  FineArt = 'fine_art',
  Food = 'food',
  Landscape = 'landscape',
  Other = 'other',
  Portrait = 'portrait',
  Product = 'product',
  Sports = 'sports',
  Street = 'street',
  Travel = 'travel',
  Wedding = 'wedding',
  Wildlife = 'wildlife'
}

export type Pricing = {
  __typename?: 'Pricing';
  addOns: Array<PricingAddOn>;
  tiers: Array<PricingTier>;
};

export type PricingAddOn = {
  __typename?: 'PricingAddOn';
  amount: Scalars['Int']['output'];
  description: Scalars['String']['output'];
  id: Scalars['String']['output'];
  kind: Scalars['String']['output'];
  name: Scalars['String']['output'];
  price: Scalars['Int']['output'];
};

export type PricingTier = {
  __typename?: 'PricingTier';
  billingInterval: Scalars['String']['output'];
  creditsPerMonth: Scalars['Int']['output'];
  faceRecPerMonth: Scalars['Int']['output'];
  id: Scalars['String']['output'];
  name: Scalars['String']['output'];
  price: Scalars['Int']['output'];
  priorityProcessing: Scalars['Boolean']['output'];
  sharingPublic: Scalars['Boolean']['output'];
  sharingRestricted: Scalars['Boolean']['output'];
  sharingUnlimited: Scalars['Boolean']['output'];
  storageGB: Scalars['Int']['output'];
};

export type ProfilePhoto = {
  __typename?: 'ProfilePhoto';
  createdAt: Scalars['Float']['output'];
  id: Scalars['Int']['output'];
  image: Image;
  sortOrder: Scalars['Int']['output'];
};

export type PublicUserProfile = {
  __typename?: 'PublicUserProfile';
  analyze: UserAnalyze;
  avatar: Scalars['String']['output'];
  bannerImage?: Maybe<SharedImage>;
  bannerUrl?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['Float']['output'];
  equipmentCount: Scalars['Int']['output'];
  id: Scalars['Int']['output'];
  mostUsedCamera?: Maybe<Scalars['String']['output']>;
  mostUsedCameraEntity?: Maybe<UserCamera>;
  name: Scalars['String']['output'];
  profilePhotos: SharedImageConnection;
  slug: Scalars['String']['output'];
  totalPhotos: Scalars['Int']['output'];
};


export type PublicUserProfileProfilePhotosArgs = {
  pagination: InputPagination;
};

export type Query = {
  __typename?: 'Query';
  accountDeletionStats: AccountDeletionStats;
  admin: Admin;
  archivedImages: ImageConnection;
  botCall?: Maybe<BotCall>;
  creditCosts: Array<CreditCost>;
  dream?: Maybe<Dream>;
  dreams: DreamConnection;
  image?: Maybe<Image>;
  imageNeighbors: ImageNeighbors;
  images: ImageConnection;
  imagesByFilenames: Array<Image>;
  me: User;
  myBot?: Maybe<UserBot>;
  myBots: Array<UserBot>;
  myInvitationCodes: Array<InvitationCode>;
  notificationPreferences: NotificationPreferences;
  notifications: NotificationConnection;
  openUploads: Array<Upload>;
  pricing: Pricing;
  resourceShares: Array<ResourceShare>;
  searchUsers: Array<User>;
  sftpCredentials: Array<SftpCredential>;
  share?: Maybe<Share>;
  sharedByMe: OutgoingShareConnection;
  sharedContent?: Maybe<SharedContent>;
  sharedWithMe: ResourceShareConnection;
  shares: ShareConnection;
  unreadNotificationCount: Scalars['Int']['output'];
  uploads: UploadConnection;
  userProfile?: Maybe<PublicUserProfile>;
};


export type QueryArchivedImagesArgs = {
  filter?: InputMaybe<ImageFilter>;
  orderBy?: InputMaybe<ImageOrderBy>;
  pagination: InputPagination;
};


export type QueryBotCallArgs = {
  id: Scalars['Int']['input'];
};


export type QueryDreamArgs = {
  id: Scalars['Int']['input'];
};


export type QueryDreamsArgs = {
  pagination: InputPagination;
};


export type QueryImageArgs = {
  id: Scalars['Int']['input'];
};


export type QueryImageNeighborsArgs = {
  albumId?: InputMaybe<Scalars['Int']['input']>;
  filter?: InputMaybe<ImageFilter>;
  imageId: Scalars['Int']['input'];
};


export type QueryImagesArgs = {
  filter?: InputMaybe<ImageFilter>;
  orderBy?: InputMaybe<ImageOrderBy>;
  pagination: InputPagination;
};


export type QueryImagesByFilenamesArgs = {
  filenames: Array<Scalars['String']['input']>;
};


export type QueryMyBotArgs = {
  id: Scalars['Int']['input'];
};


export type QueryNotificationsArgs = {
  filter?: InputMaybe<NotificationFilter>;
  pagination: InputPagination;
};


export type QueryResourceSharesArgs = {
  resourceId: Scalars['Int']['input'];
  resourceType: ShareResourceType;
};


export type QuerySearchUsersArgs = {
  query: Scalars['String']['input'];
};


export type QueryShareArgs = {
  id: Scalars['Int']['input'];
};


export type QuerySharedByMeArgs = {
  pagination: InputPagination;
  resourceType?: InputMaybe<ShareResourceType>;
};


export type QuerySharedContentArgs = {
  accessToken?: InputMaybe<Scalars['String']['input']>;
  code: Scalars['String']['input'];
};


export type QuerySharedWithMeArgs = {
  pagination: InputPagination;
  resourceType?: InputMaybe<ShareResourceType>;
};


export type QuerySharesArgs = {
  pagination: InputPagination;
  status?: InputMaybe<ShareStatus>;
};


export type QueryUploadsArgs = {
  pagination: InputPagination;
  status?: InputMaybe<UploadStatus>;
};


export type QueryUserProfileArgs = {
  slug: Scalars['String']['input'];
};

export type QueueInfo = {
  __typename?: 'QueueInfo';
  active: Scalars['Int']['output'];
  archived: Scalars['Int']['output'];
  completed: Scalars['Int']['output'];
  failed: Scalars['Int']['output'];
  latencyMs: Scalars['Int']['output'];
  name: Scalars['String']['output'];
  paused: Scalars['Boolean']['output'];
  pending: Scalars['Int']['output'];
  processed: Scalars['Int']['output'];
  retry: Scalars['Int']['output'];
  scheduled: Scalars['Int']['output'];
  size: Scalars['Int']['output'];
};

export type Reaction = {
  __typename?: 'Reaction';
  createdAt: Scalars['Float']['output'];
  emoji: Scalars['String']['output'];
  id: Scalars['Int']['output'];
  targetId: Scalars['Int']['output'];
  targetType: ReactionTargetType;
  user: User;
};

export type ReactionResult = {
  __typename?: 'ReactionResult';
  added: Scalars['Boolean']['output'];
  reactions: Array<ReactionSummary>;
};

export type ReactionSummary = {
  __typename?: 'ReactionSummary';
  count: Scalars['Int']['output'];
  emoji: Scalars['String']['output'];
  userReacted: Scalars['Boolean']['output'];
  users: Array<User>;
};

export enum ReactionTargetType {
  Album = 'album',
  Comment = 'comment',
  Image = 'image'
}

export type ReanalyzeImagesInput = {
  endDate?: InputMaybe<Scalars['Time']['input']>;
  extensions?: InputMaybe<Array<Scalars['String']['input']>>;
  imageIds?: InputMaybe<Array<Scalars['Int']['input']>>;
  startDate?: InputMaybe<Scalars['Time']['input']>;
  status?: InputMaybe<Array<ImageStatus>>;
  tasks?: InputMaybe<Array<ImageTaskType>>;
};

export type ReanalyzeImagesResult = {
  __typename?: 'ReanalyzeImagesResult';
  count: Scalars['Int']['output'];
  jobIds: Array<Scalars['String']['output']>;
};

export type RegisterDeviceTokenInput = {
  platform: DevicePlatform;
  token: Scalars['String']['input'];
};

export type RegisterWebPushSubscriptionInput = {
  auth: Scalars['String']['input'];
  endpoint: Scalars['String']['input'];
  p256dh: Scalars['String']['input'];
};

export type RemoveFaceFromPersonInput = {
  faceId: Scalars['String']['input'];
  personId: Scalars['Int']['input'];
};

export enum ReportCategory {
  Harassment = 'harassment',
  HateSpeech = 'hate_speech',
  Misinformation = 'misinformation',
  Nudity = 'nudity',
  Other = 'other',
  Spam = 'spam',
  Violence = 'violence'
}

export type ReportCommentInput = {
  category: ReportCategory;
  commentId: Scalars['Int']['input'];
  detail?: InputMaybe<Scalars['String']['input']>;
};

export type ReportConnectedCameraInput = {
  firmwareVersion?: InputMaybe<Scalars['String']['input']>;
  lensModel?: InputMaybe<Scalars['String']['input']>;
  macAddress?: InputMaybe<Scalars['String']['input']>;
  make?: InputMaybe<Scalars['String']['input']>;
  model: Scalars['String']['input'];
  serialNumber?: InputMaybe<Scalars['String']['input']>;
  storage?: InputMaybe<Array<ConnectedCameraStorageInput>>;
};

export type ReportImageInput = {
  category: ReportCategory;
  detail?: InputMaybe<Scalars['String']['input']>;
  imageId: Scalars['Int']['input'];
};

export type ReportedComment = {
  __typename?: 'ReportedComment';
  comment: Comment;
  latestReportedAt?: Maybe<Scalars['Float']['output']>;
  reportCount: Scalars['Int']['output'];
  reports: Array<CommentReport>;
};

export type ReportedCommentConnection = {
  __typename?: 'ReportedCommentConnection';
  edges: Array<ReportedComment>;
  pageInfo: PageInfo;
};

export type ReportedImage = {
  __typename?: 'ReportedImage';
  image: Image;
  latestReportedAt?: Maybe<Scalars['Float']['output']>;
  reportCount: Scalars['Int']['output'];
  reports: Array<ImageReport>;
};

export type ReportedImageConnection = {
  __typename?: 'ReportedImageConnection';
  edges: Array<ReportedImage>;
  pageInfo: PageInfo;
};

export type ResourceShare = {
  __typename?: 'ResourceShare';
  album?: Maybe<Album>;
  createdAt: Scalars['Float']['output'];
  dream?: Maybe<Dream>;
  id: Scalars['Int']['output'];
  image?: Maybe<Image>;
  owner: User;
  resourceId: Scalars['Int']['output'];
  resourceType: ShareResourceType;
  target: User;
};

export type ResourceShareConnection = {
  __typename?: 'ResourceShareConnection';
  edges: Array<ResourceShare>;
  pageInfo: PageInfo;
};

export type S3Settings = {
  __typename?: 'S3Settings';
  accessKeyHint?: Maybe<Scalars['String']['output']>;
  accessKeyLength?: Maybe<Scalars['Int']['output']>;
  archiveOriginals: Scalars['Boolean']['output'];
  bucket?: Maybe<Scalars['String']['output']>;
  domain?: Maybe<Scalars['String']['output']>;
  endpoint?: Maybe<Scalars['String']['output']>;
  hasAccessKey: Scalars['Boolean']['output'];
  hasSecretKey: Scalars['Boolean']['output'];
  region?: Maybe<Scalars['String']['output']>;
  secretKeyHint?: Maybe<Scalars['String']['output']>;
  secretKeyLength?: Maybe<Scalars['Int']['output']>;
};

export type SftpCredential = {
  __typename?: 'SFTPCredential';
  createdAt: Scalars['Float']['output'];
  enabled: Scalars['Boolean']['output'];
  id: Scalars['Int']['output'];
  lastUsedAt?: Maybe<Scalars['Float']['output']>;
  name: Scalars['String']['output'];
};

export type SftpCredentialWithPassword = {
  __typename?: 'SFTPCredentialWithPassword';
  createdAt: Scalars['Float']['output'];
  id: Scalars['Int']['output'];
  name: Scalars['String']['output'];
  password: Scalars['String']['output'];
};

export type SetPasswordInput = {
  newPassword: Scalars['String']['input'];
};

export type Share = {
  __typename?: 'Share';
  accessType: ShareAccessType;
  album?: Maybe<Album>;
  code: Scalars['String']['output'];
  createdAt: Scalars['Float']['output'];
  description?: Maybe<Scalars['String']['output']>;
  enabled: Scalars['Boolean']['output'];
  expiresAt?: Maybe<Scalars['Float']['output']>;
  frameKind: FrameKind;
  id: Scalars['Int']['output'];
  image?: Maybe<Image>;
  isExpired: Scalars['Boolean']['output'];
  minRating?: Maybe<Scalars['Int']['output']>;
  owner: User;
  permission: SharePermission;
  recipients: Array<ShareRecipient>;
  shareType: ShareType;
  showExif: Scalars['Boolean']['output'];
  status: ShareStatus;
  title?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['Float']['output'];
  url: Scalars['String']['output'];
  viewCount: Scalars['Int']['output'];
};

export enum ShareAccessType {
  Public = 'public',
  Restricted = 'restricted'
}

export type ShareConnection = {
  __typename?: 'ShareConnection';
  edges: Array<Share>;
  pageInfo: PageInfo;
};

export enum ShareExpiration {
  Day = 'day',
  Forever = 'forever',
  Month = 'month',
  Week = 'week'
}

export type SharePermission = {
  __typename?: 'SharePermission';
  allowDownload: Scalars['Boolean']['output'];
  allowOriginalDownload: Scalars['Boolean']['output'];
};

export type SharePermissionInput = {
  allowDownload: Scalars['Boolean']['input'];
  allowOriginalDownload: Scalars['Boolean']['input'];
};

export type SharePermissionUpdateInput = {
  allowDownload?: InputMaybe<Scalars['Boolean']['input']>;
  allowOriginalDownload?: InputMaybe<Scalars['Boolean']['input']>;
};

export type ShareRecipient = {
  __typename?: 'ShareRecipient';
  createdAt: Scalars['Float']['output'];
  email: Scalars['String']['output'];
  id: Scalars['Int']['output'];
  lastAccessedAt?: Maybe<Scalars['Float']['output']>;
  user?: Maybe<User>;
};

export type ShareResourceInput = {
  resourceId: Scalars['Int']['input'];
  resourceType: ShareResourceType;
  userIds: Array<Scalars['Int']['input']>;
};

export enum ShareResourceType {
  Album = 'album',
  Dream = 'dream',
  Image = 'image'
}

export enum ShareStatus {
  Active = 'active',
  Archived = 'archived'
}

export enum ShareType {
  Album = 'album',
  Image = 'image'
}

export type SharedAlbum = {
  __typename?: 'SharedAlbum';
  article?: Maybe<SharedArticle>;
  coverImage?: Maybe<SharedImage>;
  description: Scalars['String']['output'];
  id: Scalars['Int']['output'];
  imageCount: Scalars['Int']['output'];
  images: SharedImageConnection;
  name: Scalars['String']['output'];
  previewImages: Array<SharedImage>;
};


export type SharedAlbumImagesArgs = {
  pagination: InputPagination;
};

export type SharedArticle = {
  __typename?: 'SharedArticle';
  content: Scalars['String']['output'];
  images: Array<SharedImage>;
  title: Scalars['String']['output'];
};

export type SharedContent = {
  __typename?: 'SharedContent';
  album?: Maybe<SharedAlbum>;
  description?: Maybe<Scalars['String']['output']>;
  frameKind: FrameKind;
  image?: Maybe<SharedImage>;
  minRating?: Maybe<Scalars['Int']['output']>;
  ownerAvatar?: Maybe<Scalars['String']['output']>;
  ownerName: Scalars['String']['output'];
  permission: SharePermission;
  shareType: ShareType;
  showExif: Scalars['Boolean']['output'];
  title?: Maybe<Scalars['String']['output']>;
};

export type SharedImage = {
  __typename?: 'SharedImage';
  aperture?: Maybe<Scalars['Float']['output']>;
  blurhash?: Maybe<Scalars['String']['output']>;
  cameraMake?: Maybe<Scalars['String']['output']>;
  cameraModel?: Maybe<Scalars['String']['output']>;
  displayDesc: Scalars['String']['output'];
  displayName: Scalars['String']['output'];
  editedImages: Array<EditedImage>;
  exposureTime?: Maybe<Scalars['String']['output']>;
  focalLength?: Maybe<Scalars['Float']['output']>;
  height?: Maybe<Scalars['Int']['output']>;
  id: Scalars['Int']['output'];
  iso?: Maybe<Scalars['Int']['output']>;
  lensModel?: Maybe<Scalars['String']['output']>;
  rotation: Scalars['Int']['output'];
  thumbnailHeight?: Maybe<Scalars['Int']['output']>;
  thumbnailUrl?: Maybe<Scalars['String']['output']>;
  thumbnailWidth?: Maybe<Scalars['Int']['output']>;
  url: Scalars['String']['output'];
  width?: Maybe<Scalars['Int']['output']>;
};

export type SharedImageConnection = {
  __typename?: 'SharedImageConnection';
  edges: Array<SharedImage>;
  pageInfo: PageInfo;
};

export type SharingPreferences = {
  __typename?: 'SharingPreferences';
  albumsShareWith: Array<User>;
  dreamsShareWith: Array<User>;
  imagesShareWith: Array<User>;
};

export type StorageUsage = {
  __typename?: 'StorageUsage';
  dailySeries: Array<UsagePoint>;
  originalsBytes: Scalars['Float']['output'];
  othersBytes: Scalars['Float']['output'];
  quotaBytes: Scalars['Float']['output'];
  remainingBytes: Scalars['Float']['output'];
  topImages: Array<Image>;
  usedBytes: Scalars['Float']['output'];
};


export type StorageUsageTopImagesArgs = {
  limit?: Scalars['Int']['input'];
};

export type SyncUserLocationInput = {
  accuracy?: InputMaybe<Scalars['Float']['input']>;
  altitude?: InputMaybe<Scalars['Float']['input']>;
  course?: InputMaybe<Scalars['Float']['input']>;
  latitude: Scalars['Float']['input'];
  longitude: Scalars['Float']['input'];
  speed?: InputMaybe<Scalars['Float']['input']>;
  timestamp: Scalars['Float']['input'];
};

export type Tag = {
  __typename?: 'Tag';
  color?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['Float']['output'];
  id: Scalars['Int']['output'];
  imageCount: Scalars['Int']['output'];
  name: Scalars['String']['output'];
  slug: Scalars['String']['output'];
  updatedAt: Scalars['Float']['output'];
};

export type TagConnection = {
  __typename?: 'TagConnection';
  edges: Array<Tag>;
  pageInfo: PageInfo;
};

export type TaskConnection = {
  __typename?: 'TaskConnection';
  edges: Array<TaskInfo>;
  pageInfo: PageInfo;
};

export type TaskInfo = {
  __typename?: 'TaskInfo';
  completedAt?: Maybe<Scalars['Time']['output']>;
  id: Scalars['String']['output'];
  lastError?: Maybe<Scalars['String']['output']>;
  lastFailedAt?: Maybe<Scalars['Time']['output']>;
  maxRetry: Scalars['Int']['output'];
  nextProcessAt?: Maybe<Scalars['Time']['output']>;
  queue: Scalars['String']['output'];
  retried: Scalars['Int']['output'];
  state: Scalars['String']['output'];
  type: Scalars['String']['output'];
};

export enum TaskState {
  Active = 'active',
  Archived = 'archived',
  Completed = 'completed',
  Pending = 'pending',
  Retry = 'retry',
  Scheduled = 'scheduled'
}

export type TestOpenAiSettingsInput = {
  apiKey: Scalars['String']['input'];
  endpoint?: InputMaybe<Scalars['String']['input']>;
  model?: InputMaybe<Scalars['String']['input']>;
};

export type TestS3SettingsInput = {
  accessKey: Scalars['String']['input'];
  bucket: Scalars['String']['input'];
  domain: Scalars['String']['input'];
  endpoint: Scalars['String']['input'];
  region?: InputMaybe<Scalars['String']['input']>;
  secretKey: Scalars['String']['input'];
};

export enum Theme {
  Dark = 'DARK',
  Light = 'LIGHT',
  System = 'SYSTEM'
}

export enum TimeFormat {
  Time_12H = 'TIME_12H',
  Time_24H = 'TIME_24H'
}

export type ToggleReactionInput = {
  emoji: Scalars['String']['input'];
  targetId: Scalars['Int']['input'];
  targetType: ReactionTargetType;
};

export type UnshareResourceInput = {
  resourceId: Scalars['Int']['input'];
  resourceType: ShareResourceType;
  userIds: Array<Scalars['Int']['input']>;
};

export type UpdateAlbumInput = {
  cameraId?: InputMaybe<Scalars['Int']['input']>;
  clearCameraId?: InputMaybe<Scalars['Boolean']['input']>;
  clearDateFrom?: InputMaybe<Scalars['Boolean']['input']>;
  clearDateTo?: InputMaybe<Scalars['Boolean']['input']>;
  clearLensId?: InputMaybe<Scalars['Boolean']['input']>;
  clearTimezone?: InputMaybe<Scalars['Boolean']['input']>;
  coverImageId?: InputMaybe<Scalars['Int']['input']>;
  dateFrom?: InputMaybe<Scalars['String']['input']>;
  dateTo?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['Int']['input'];
  lensId?: InputMaybe<Scalars['Int']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
  permission?: InputMaybe<AlbumPermission>;
  tagIds?: InputMaybe<Array<Scalars['Int']['input']>>;
  timezone?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateBotInput = {
  avatar?: InputMaybe<Scalars['String']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  id: Scalars['Int']['input'];
  nameEn?: InputMaybe<Scalars['String']['input']>;
  nameZh?: InputMaybe<Scalars['String']['input']>;
  parameters?: InputMaybe<Array<BotParameterInput>>;
  permissions?: InputMaybe<Array<BotPermission>>;
  sort?: InputMaybe<Scalars['Int']['input']>;
  timeout?: InputMaybe<Scalars['Int']['input']>;
  visibility?: InputMaybe<BotVisibility>;
};

export type UpdateCommentInput = {
  content: Scalars['String']['input'];
  id: Scalars['Int']['input'];
};

export type UpdateEquipmentProductInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['Int']['input'];
  msrp?: InputMaybe<Scalars['String']['input']>;
  productImageUrl?: InputMaybe<Scalars['String']['input']>;
  specs?: InputMaybe<Scalars['String']['input']>;
  yearReleased?: InputMaybe<Scalars['Int']['input']>;
};

export type UpdateImageInput = {
  displayDesc?: InputMaybe<Scalars['String']['input']>;
  displayName?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['Int']['input'];
  rotation?: InputMaybe<Scalars['Int']['input']>;
};

export type UpdateOpenAiSettingsInput = {
  apiKey?: InputMaybe<Scalars['String']['input']>;
  endpoint?: InputMaybe<Scalars['String']['input']>;
  model?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateS3SettingsInput = {
  accessKey?: InputMaybe<Scalars['String']['input']>;
  archiveOriginals?: InputMaybe<Scalars['Boolean']['input']>;
  bucket?: InputMaybe<Scalars['String']['input']>;
  domain?: InputMaybe<Scalars['String']['input']>;
  endpoint?: InputMaybe<Scalars['String']['input']>;
  region?: InputMaybe<Scalars['String']['input']>;
  secretKey?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateShareInput = {
  accessType?: InputMaybe<ShareAccessType>;
  clearMinRating?: InputMaybe<Scalars['Boolean']['input']>;
  description?: InputMaybe<Scalars['String']['input']>;
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  expiration?: InputMaybe<ShareExpiration>;
  frameKind?: InputMaybe<FrameKind>;
  id: Scalars['Int']['input'];
  minRating?: InputMaybe<Scalars['Int']['input']>;
  permission?: InputMaybe<SharePermissionUpdateInput>;
  showExif?: InputMaybe<Scalars['Boolean']['input']>;
  status?: InputMaybe<ShareStatus>;
  title?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateTagInput = {
  color?: InputMaybe<Scalars['String']['input']>;
  id: Scalars['Int']['input'];
  name?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateUserBotInput = {
  botId: Scalars['Int']['input'];
  enabled?: InputMaybe<Scalars['Boolean']['input']>;
  grantedPermissions?: InputMaybe<Array<BotPermission>>;
};

export type UpdateUserInput = {
  avatar?: InputMaybe<Scalars['String']['input']>;
  bannerImageId?: InputMaybe<Scalars['Int']['input']>;
  clearBannerImage?: InputMaybe<Scalars['Boolean']['input']>;
  name?: InputMaybe<Scalars['String']['input']>;
};

export type UpdateUserPlanInput = {
  faceRecAddonUnits?: InputMaybe<Scalars['Int']['input']>;
  storageAddonUnits?: InputMaybe<Scalars['Int']['input']>;
  tier?: InputMaybe<Scalars['String']['input']>;
  userId: Scalars['Int']['input'];
};

export type UpdateUserPreferencesInput = {
  albumsShareWith?: InputMaybe<Array<Scalars['Int']['input']>>;
  archiveDeleteAfterDays?: InputMaybe<Scalars['Int']['input']>;
  autoDeleteLevel?: InputMaybe<Scalars['Int']['input']>;
  dreamsShareWith?: InputMaybe<Array<Scalars['Int']['input']>>;
  imagesShareWith?: InputMaybe<Array<Scalars['Int']['input']>>;
  location?: InputMaybe<Scalars['String']['input']>;
  overviewKnownFacesOnly?: InputMaybe<Scalars['Boolean']['input']>;
  retentionDays?: InputMaybe<Scalars['Int']['input']>;
  secretKeyword?: InputMaybe<Scalars['String']['input']>;
  theme?: InputMaybe<Theme>;
  timeFormat?: InputMaybe<TimeFormat>;
  timezone?: InputMaybe<Scalars['String']['input']>;
  visiblePeopleIds?: InputMaybe<Array<Scalars['Int']['input']>>;
  writeGeoToExifIfEmpty?: InputMaybe<Scalars['Boolean']['input']>;
};

export type Upload = {
  __typename?: 'Upload';
  clientBanner?: Maybe<Scalars['String']['output']>;
  closedReason?: Maybe<Scalars['String']['output']>;
  completedAt?: Maybe<Scalars['Float']['output']>;
  createdAt: Scalars['Float']['output'];
  credential?: Maybe<SftpCredential>;
  failedFiles: Scalars['Int']['output'];
  failedImageCount: Scalars['Int']['output'];
  geoCity?: Maybe<Scalars['String']['output']>;
  geoCountry?: Maybe<Scalars['String']['output']>;
  id: Scalars['Int']['output'];
  processedFiles: Scalars['Int']['output'];
  processedImageCount: Scalars['Int']['output'];
  processingImageCount: Scalars['Int']['output'];
  processingProgress: Scalars['Float']['output'];
  serverCommit?: Maybe<Scalars['String']['output']>;
  serverHostname?: Maybe<Scalars['String']['output']>;
  serverIP?: Maybe<Scalars['String']['output']>;
  serverOS?: Maybe<Scalars['String']['output']>;
  serverVersion?: Maybe<Scalars['String']['output']>;
  sessionId: Scalars['String']['output'];
  sftpSessionId?: Maybe<Scalars['String']['output']>;
  sourceIP?: Maybe<Scalars['String']['output']>;
  sourceKind: Scalars['String']['output'];
  status: UploadStatus;
  totalBytes: Scalars['Float']['output'];
  totalFiles: Scalars['Int']['output'];
  updatedAt: Scalars['Float']['output'];
};

export type UploadConnection = {
  __typename?: 'UploadConnection';
  edges: Array<Upload>;
  pageInfo: PageInfo;
};

export enum UploadStatus {
  Completed = 'completed',
  Failed = 'failed',
  InProgress = 'in_progress'
}

export type UpsertArticleInput = {
  albumId: Scalars['Int']['input'];
  content?: InputMaybe<Scalars['String']['input']>;
  imageIds?: InputMaybe<Array<Scalars['Int']['input']>>;
  title?: InputMaybe<Scalars['String']['input']>;
};

export type UsageOverview = {
  __typename?: 'UsageOverview';
  aiCredits: AiCreditsUsage;
  faceRecognition: FaceRecognitionUsage;
  storage: StorageUsage;
};

export type UsagePoint = {
  __typename?: 'UsagePoint';
  day: Scalars['Float']['output'];
  value: Scalars['Float']['output'];
};

export type User = {
  __typename?: 'User';
  accountStatus: Scalars['String']['output'];
  activeAddOns: Array<Scalars['String']['output']>;
  addonCreditsPerMonth: Scalars['Int']['output'];
  addonFaceRecPerMonth: Scalars['Int']['output'];
  addonStorageBytes: Scalars['Float']['output'];
  adobeLinked: Scalars['Boolean']['output'];
  aiChat?: Maybe<AiChat>;
  aiChatImage?: Maybe<AiChatMessage>;
  aiChatImages: AiChatMessageConnection;
  aiChats: AiChatConnection;
  album?: Maybe<Album>;
  albums: AlbumConnection;
  analyze: UserAnalyze;
  appleLinked: Scalars['Boolean']['output'];
  article?: Maybe<Article>;
  articles: ArticleConnection;
  avatar: Scalars['String']['output'];
  bannerImage?: Maybe<Image>;
  bannerUrl?: Maybe<Scalars['String']['output']>;
  cameras: Array<UserCamera>;
  comments: CommentConnection;
  connectedCameras: Array<ConnectedCamera>;
  createdAt: Scalars['Float']['output'];
  creditBalance: Scalars['Int']['output'];
  creditMonthlyAllowance: Scalars['Int']['output'];
  creditResetAt?: Maybe<Scalars['Float']['output']>;
  creditUsageHistory: CreditUsageConnection;
  deletionScheduledAt?: Maybe<Scalars['Float']['output']>;
  editedImages: Array<EditedImage>;
  email: Scalars['String']['output'];
  face?: Maybe<FacePerson>;
  faceLibrary?: Maybe<FaceLibrary>;
  facePeople: FacePersonConnection;
  faceRecAddonUnits: Scalars['Int']['output'];
  faceRecMonthlyAllowance: Scalars['Int']['output'];
  faceRecRemaining: Scalars['Int']['output'];
  faceRecResetAt?: Maybe<Scalars['Float']['output']>;
  hasPassword: Scalars['Boolean']['output'];
  id: Scalars['Int']['output'];
  isAdmin: Scalars['Boolean']['output'];
  lenses: Array<UserLens>;
  loginAuditLogs: LoginAuditLogConnection;
  name: Scalars['String']['output'];
  notifications: NotificationConnection;
  overview: UserOverview;
  places: Array<UserPlace>;
  preferences?: Maybe<UserPreferences>;
  profilePhotos: Array<ProfilePhoto>;
  receivedInvitations: Array<AlbumInvitation>;
  slug: Scalars['String']['output'];
  storageAddonUnits: Scalars['Int']['output'];
  storageQuotaBytes: Scalars['Float']['output'];
  storageUsedBytes: Scalars['Float']['output'];
  subscriptionStatus: Scalars['String']['output'];
  tag?: Maybe<Tag>;
  tags: TagConnection;
  tier: Scalars['String']['output'];
  usageOverview: UsageOverview;
};


export type UserAiChatArgs = {
  id: Scalars['Int']['input'];
};


export type UserAiChatImageArgs = {
  id: Scalars['Int']['input'];
};


export type UserAiChatImagesArgs = {
  filter?: InputMaybe<AiChatImageFilter>;
  pagination: InputPagination;
};


export type UserAiChatsArgs = {
  pagination: InputPagination;
};


export type UserAlbumArgs = {
  id: Scalars['Int']['input'];
};


export type UserAlbumsArgs = {
  keyword?: InputMaybe<Scalars['String']['input']>;
  pagination: InputPagination;
};


export type UserArticleArgs = {
  id: Scalars['Int']['input'];
};


export type UserArticlesArgs = {
  pagination: InputPagination;
};


export type UserCommentsArgs = {
  pagination: InputPagination;
};


export type UserCreditUsageHistoryArgs = {
  pagination: InputPagination;
};


export type UserEditedImagesArgs = {
  contentHashes: Array<Scalars['String']['input']>;
};


export type UserFaceArgs = {
  id: Scalars['Int']['input'];
};


export type UserFacePeopleArgs = {
  pagination: InputPagination;
};


export type UserLoginAuditLogsArgs = {
  pagination: InputPagination;
};


export type UserNotificationsArgs = {
  pagination: InputPagination;
  unreadOnly?: InputMaybe<Scalars['Boolean']['input']>;
};


export type UserTagArgs = {
  id: Scalars['Int']['input'];
};


export type UserTagsArgs = {
  pagination: InputPagination;
};

export type UserAnalyze = {
  __typename?: 'UserAnalyze';
  category: Array<CategoryCount>;
  focalLength: Array<FocalLengthBucket>;
};

export type UserBot = {
  __typename?: 'UserBot';
  bot: Bot;
  calls: BotCallConnection;
  enabled: Scalars['Boolean']['output'];
  grantedPermissions: Array<BotPermission>;
};


export type UserBotCallsArgs = {
  pagination: InputPagination;
};

export type UserCamera = {
  __typename?: 'UserCamera';
  batteryType?: Maybe<Scalars['String']['output']>;
  createdAt: Scalars['Float']['output'];
  firmwareVersion?: Maybe<Scalars['String']['output']>;
  id: Scalars['Int']['output'];
  imageCount: Scalars['Int']['output'];
  images: ImageConnection;
  internalSerialNumber?: Maybe<Scalars['String']['output']>;
  make?: Maybe<Scalars['String']['output']>;
  model: Scalars['String']['output'];
  product?: Maybe<EquipmentProduct>;
  sensorHeight?: Maybe<Scalars['Int']['output']>;
  sensorWidth?: Maybe<Scalars['Int']['output']>;
  serialNumber?: Maybe<Scalars['Float']['output']>;
  shutterCount?: Maybe<Scalars['Int']['output']>;
};


export type UserCameraImagesArgs = {
  pagination: InputPagination;
};

export type UserLens = {
  __typename?: 'UserLens';
  createdAt: Scalars['Float']['output'];
  id: Scalars['Int']['output'];
  imageCount: Scalars['Int']['output'];
  images: ImageConnection;
  lensId?: Maybe<Scalars['Int']['output']>;
  lensInfo?: Maybe<Scalars['String']['output']>;
  make?: Maybe<Scalars['String']['output']>;
  maxAperture?: Maybe<Scalars['Float']['output']>;
  maxFocalLength?: Maybe<Scalars['Float']['output']>;
  minAperture?: Maybe<Scalars['Float']['output']>;
  minFocalLength?: Maybe<Scalars['Float']['output']>;
  model: Scalars['String']['output'];
  product?: Maybe<EquipmentProduct>;
  serialNumber?: Maybe<Scalars['Float']['output']>;
};


export type UserLensImagesArgs = {
  pagination: InputPagination;
};

export type UserLocation = {
  __typename?: 'UserLocation';
  accuracy?: Maybe<Scalars['Float']['output']>;
  altitude?: Maybe<Scalars['Float']['output']>;
  capturedAt: Scalars['Time']['output'];
  createdAt: Scalars['Time']['output'];
  id: Scalars['Int']['output'];
  latitude: Scalars['Float']['output'];
  longitude: Scalars['Float']['output'];
};

export type UserOverview = {
  __typename?: 'UserOverview';
  albumCount: Scalars['Int']['output'];
  captureCalendar: Array<CaptureCalendarDay>;
  /** @deprecated Overview no longer shows the processing queue. */
  failedCount: Scalars['Int']['output'];
  latestDream?: Maybe<Dream>;
  onThisDay: Array<OnThisDayGroup>;
  /** @deprecated Overview no longer shows the processing queue. */
  pendingCount: Scalars['Int']['output'];
  peopleCount: Scalars['Int']['output'];
  photosLast30Days: Scalars['Int']['output'];
  placeCount: Scalars['Int']['output'];
  /** @deprecated Overview no longer shows the processing queue. */
  processingCount: Scalars['Int']['output'];
  storageQuotaBytes: Scalars['Float']['output'];
  storageUsedBytes: Scalars['Float']['output'];
  storageUsedPercent: Scalars['Float']['output'];
  tagCount: Scalars['Int']['output'];
  topRatedPhotos: Array<Image>;
  totalPhotos: Scalars['Int']['output'];
  unreadNotifications: Scalars['Int']['output'];
};


export type UserOverviewCaptureCalendarArgs = {
  days?: Scalars['Int']['input'];
};


export type UserOverviewOnThisDayArgs = {
  tzOffsetMinutes?: Scalars['Int']['input'];
};

export type UserPlace = {
  __typename?: 'UserPlace';
  city: Scalars['String']['output'];
  country: Scalars['String']['output'];
  countryCode: Scalars['String']['output'];
  createdAt: Scalars['Float']['output'];
  firstVisitedAt: Scalars['Float']['output'];
  id: Scalars['Int']['output'];
  imageCount: Scalars['Int']['output'];
  latitude: Scalars['Float']['output'];
  longitude: Scalars['Float']['output'];
  state: Scalars['String']['output'];
};

export type UserPreferences = {
  __typename?: 'UserPreferences';
  archiveDeleteAfterDays: Scalars['Int']['output'];
  autoDeleteLevel: Scalars['Int']['output'];
  createdAt: Scalars['Float']['output'];
  hasSecretKeyword: Scalars['Boolean']['output'];
  id: Scalars['Int']['output'];
  location: Scalars['String']['output'];
  openai: OpenAiSettings;
  overviewKnownFacesOnly: Scalars['Boolean']['output'];
  retentionDays: Scalars['Int']['output'];
  s3: S3Settings;
  sharing: SharingPreferences;
  theme: Theme;
  timeFormat: TimeFormat;
  timezone: Scalars['String']['output'];
  updatedAt: Scalars['Float']['output'];
  visiblePeopleIds: Array<Scalars['Int']['output']>;
  writeGeoToExifIfEmpty: Scalars['Boolean']['output'];
};

export type AuthStatusQueryVariables = Exact<{ [key: string]: never; }>;


export type AuthStatusQuery = { __typename?: 'Query', me: { __typename?: 'User', id: number, name: string, email: string, slug: string, tier: string, subscriptionStatus: string, accountStatus: string } };

export type SftpCredentialsQueryVariables = Exact<{ [key: string]: never; }>;


export type SftpCredentialsQuery = { __typename?: 'Query', sftpCredentials: Array<{ __typename?: 'SFTPCredential', id: number, name: string, lastUsedAt?: number | null, enabled: boolean, createdAt: number }> };

export type CreateSftpCredentialMutationVariables = Exact<{
  name: Scalars['String']['input'];
  password?: InputMaybe<Scalars['String']['input']>;
}>;


export type CreateSftpCredentialMutation = { __typename?: 'Mutation', createSFTPCredential: { __typename?: 'SFTPCredentialWithPassword', id: number, name: string, password: string, createdAt: number } };

export type DeleteSftpCredentialMutationVariables = Exact<{
  id: Scalars['Int']['input'];
}>;


export type DeleteSftpCredentialMutation = { __typename?: 'Mutation', deleteSFTPCredential: boolean };


export const AuthStatusDocument = {"__meta__":{"hash":"b1ed2f39e8c0f4be476fc3e5e17a133fc87256ab"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"AuthStatus"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"me"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"email"}},{"kind":"Field","name":{"kind":"Name","value":"slug"}},{"kind":"Field","name":{"kind":"Name","value":"tier"}},{"kind":"Field","name":{"kind":"Name","value":"subscriptionStatus"}},{"kind":"Field","name":{"kind":"Name","value":"accountStatus"}}]}}]}}]} as unknown as DocumentNode<AuthStatusQuery, AuthStatusQueryVariables>;
export const SftpCredentialsDocument = {"__meta__":{"hash":"ed0f410bd1da62db1fe9e5d0eddfa41d8b590f9b"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"query","name":{"kind":"Name","value":"SftpCredentials"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"sftpCredentials"},"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"lastUsedAt"}},{"kind":"Field","name":{"kind":"Name","value":"enabled"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<SftpCredentialsQuery, SftpCredentialsQueryVariables>;
export const CreateSftpCredentialDocument = {"__meta__":{"hash":"8021783905f059c8d0f55da26932257be0cd88e9"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"CreateSftpCredential"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"name"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}},{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"password"}},"type":{"kind":"NamedType","name":{"kind":"Name","value":"String"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"createSFTPCredential"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"name"},"value":{"kind":"Variable","name":{"kind":"Name","value":"name"}}},{"kind":"Argument","name":{"kind":"Name","value":"password"},"value":{"kind":"Variable","name":{"kind":"Name","value":"password"}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"id"}},{"kind":"Field","name":{"kind":"Name","value":"name"}},{"kind":"Field","name":{"kind":"Name","value":"password"}},{"kind":"Field","name":{"kind":"Name","value":"createdAt"}}]}}]}}]} as unknown as DocumentNode<CreateSftpCredentialMutation, CreateSftpCredentialMutationVariables>;
export const DeleteSftpCredentialDocument = {"__meta__":{"hash":"4cb78c0ab43e8534df63ababc233ece29b2e7598"},"kind":"Document","definitions":[{"kind":"OperationDefinition","operation":"mutation","name":{"kind":"Name","value":"DeleteSftpCredential"},"variableDefinitions":[{"kind":"VariableDefinition","variable":{"kind":"Variable","name":{"kind":"Name","value":"id"}},"type":{"kind":"NonNullType","type":{"kind":"NamedType","name":{"kind":"Name","value":"Int"}}}}],"selectionSet":{"kind":"SelectionSet","selections":[{"kind":"Field","name":{"kind":"Name","value":"deleteSFTPCredential"},"arguments":[{"kind":"Argument","name":{"kind":"Name","value":"id"},"value":{"kind":"Variable","name":{"kind":"Name","value":"id"}}}]}]}}]} as unknown as DocumentNode<DeleteSftpCredentialMutation, DeleteSftpCredentialMutationVariables>;