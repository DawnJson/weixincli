// 以下文件来自 https://github.com/wong2/weixin-agent-sdk (packages/sdk/src/vendor.d.ts)
declare module "silk-wasm" {
  export function decode(
    input: Buffer,
    sampleRate: number,
  ): Promise<{ data: Uint8Array; duration: number }>;
}

declare module "qrcode-terminal" {
  const qrcodeTerminal: {
    generate(
      text: string,
      options?: { small?: boolean },
      callback?: (qr: string) => void,
    ): void;
  };
  export default qrcodeTerminal;
}
