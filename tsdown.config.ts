import { defineConfig } from "tsdown"

export default defineConfig({
  entry: {
    index: "src/index.ts",
    client: "src/client/index.ts",
    webhook: "src/webhook/index.ts",
    effect: "src/effect/index.ts",
    "effect/rpc": "src/effect/rpc/index.ts",
    "effect/rpc/server": "src/effect/rpc/server.ts",
  },
  format: "esm",
  platform: "neutral",
  target: "es2022",
  dts: true,
  sourcemap: true,
  deps: { neverBundle: [/^effect(\/|$)/] },
})
