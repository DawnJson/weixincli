import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./main.ts", "./index.ts"],
  dts: true,
  outputOptions: {
    chunkFileNames: "weixin-acp-router-[hash].mjs",
  },
});
