/* eslint-disable */
import * as types from './graphql';
import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core';

/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "query AuthStatus {\n  me {\n    id\n    name\n    email\n    slug\n    tier\n    subscriptionStatus\n    accountStatus\n  }\n}": typeof types.AuthStatusDocument,
    "query SftpCredentials {\n  sftpCredentials {\n    id\n    name\n    lastUsedAt\n    enabled\n    createdAt\n  }\n}\n\nmutation CreateSftpCredential($name: String!, $password: String) {\n  createSFTPCredential(name: $name, password: $password) {\n    id\n    name\n    password\n    createdAt\n  }\n}\n\nmutation DeleteSftpCredential($id: Int!) {\n  deleteSFTPCredential(id: $id)\n}": typeof types.SftpCredentialsDocument,
};
const documents: Documents = {
    "query AuthStatus {\n  me {\n    id\n    name\n    email\n    slug\n    tier\n    subscriptionStatus\n    accountStatus\n  }\n}": types.AuthStatusDocument,
    "query SftpCredentials {\n  sftpCredentials {\n    id\n    name\n    lastUsedAt\n    enabled\n    createdAt\n  }\n}\n\nmutation CreateSftpCredential($name: String!, $password: String) {\n  createSFTPCredential(name: $name, password: $password) {\n    id\n    name\n    password\n    createdAt\n  }\n}\n\nmutation DeleteSftpCredential($id: Int!) {\n  deleteSFTPCredential(id: $id)\n}": types.SftpCredentialsDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 *
 *
 * @example
 * ```ts
 * const query = graphql(`query GetUser($id: ID!) { user(id: $id) { name } }`);
 * ```
 *
 * The query argument is unknown!
 * Please regenerate the types.
 */
export function graphql(source: string): unknown;

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query AuthStatus {\n  me {\n    id\n    name\n    email\n    slug\n    tier\n    subscriptionStatus\n    accountStatus\n  }\n}"): (typeof documents)["query AuthStatus {\n  me {\n    id\n    name\n    email\n    slug\n    tier\n    subscriptionStatus\n    accountStatus\n  }\n}"];
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "query SftpCredentials {\n  sftpCredentials {\n    id\n    name\n    lastUsedAt\n    enabled\n    createdAt\n  }\n}\n\nmutation CreateSftpCredential($name: String!, $password: String) {\n  createSFTPCredential(name: $name, password: $password) {\n    id\n    name\n    password\n    createdAt\n  }\n}\n\nmutation DeleteSftpCredential($id: Int!) {\n  deleteSFTPCredential(id: $id)\n}"): (typeof documents)["query SftpCredentials {\n  sftpCredentials {\n    id\n    name\n    lastUsedAt\n    enabled\n    createdAt\n  }\n}\n\nmutation CreateSftpCredential($name: String!, $password: String) {\n  createSFTPCredential(name: $name, password: $password) {\n    id\n    name\n    password\n    createdAt\n  }\n}\n\nmutation DeleteSftpCredential($id: Int!) {\n  deleteSFTPCredential(id: $id)\n}"];

export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}

export type DocumentType<TDocumentNode extends DocumentNode<any, any>> = TDocumentNode extends DocumentNode<  infer TType,  any>  ? TType  : never;