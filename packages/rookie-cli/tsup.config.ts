import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/repl.ts"],
  format: ["esm"],
  dts: true,
  splitting: true,
  sourcemap: true,
  clean: true,
});
