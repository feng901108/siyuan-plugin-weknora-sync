import { defineConfig } from "vite";
import { resolve } from "path";

// 思源插件打包为 CommonJS 单文件，输出到 dist/index.js
// 思源插件加载器通过 require() 拿到模块，期望 module.exports = PluginClass
// 因此使用 exports: "default"，让 export default 编译为 module.exports = ...
// `siyuan` 包是纯类型声明（无运行时代码），必须 external 掉，运行时由思源注入
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      formats: ["cjs"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: ["siyuan"],
      output: {
        entryFileNames: "index.js",
        assetFileNames: "[name].[ext]",
        exports: "default",
      },
    },
  },
});


