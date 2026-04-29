declare module "ssh2" {
  export type ConnectConfig = any;
  export type SFTPWrapper = any;
  export class Client {
    on(event: string, listener: (...args: any[]) => void): this;
    connect(config: any): void;
    end(): void;
  }
}

