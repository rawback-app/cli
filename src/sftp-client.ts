import { SftpClient as SdkSftpClient, type SftpClientOptions } from '@rawback/sdk'

export {
  HostKeyError,
  SftpConnectionError,
  isConnectionFailure,
  type KnownHostStore,
  type SftpClientOptions,
} from '@rawback/sdk'

export interface UploadTransport {
  connect(): Promise<void>
  upload(localPath: string, remotePath: string, onProgress: (bytes: number) => void): Promise<void>
  close(): Promise<void>
}

export type UploadTransportFactory = (options: SftpClientOptions) => UploadTransport

export class SftpClient implements UploadTransport {
  private readonly client: SdkSftpClient

  constructor(options: SftpClientOptions) {
    this.client = new SdkSftpClient(options)
  }

  connect(): Promise<void> {
    return this.client.connect()
  }

  upload(
    localPath: string,
    remotePath: string,
    onProgress: (bytes: number) => void,
  ): Promise<void> {
    return this.client.upload(localPath, remotePath, onProgress)
  }

  close(): Promise<void> {
    return this.client.close()
  }
}

export const createSftpClient: UploadTransportFactory = (options) => new SftpClient(options)
