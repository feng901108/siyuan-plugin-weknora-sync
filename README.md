# WeKnora Sync（思源笔记插件）

把思源笔记的文档（含本地图片）一键同步到 [WeKnora](https://github.com/tencent/weknora) 知识库。

## 工作原理

```
思源笔记文档
  ↓ /api/export/exportMdContent 导出 markdown
  ↓ 扫描 ![alt](assets/xxx.png) 本地图片
  ↓ /api/file/getFile 读取图片字节 → base64 data URI 内联到 markdown
  ↓
WeKnora POST /knowledge-bases/:id/knowledge/manual
  ↓ WeKnora 后台 ResolveDataURIImages 自动解码 base64
  ↓ fileSvc.SaveBytes 上传到对象存储（local/minio/cos/tos/s3/obs）
  ↓ markdown 中 URL 自动改写为 provider://...
  ↓
索引完成 → 图片在对象存储里永久可访问，原文章图片不再丢失
```

关键点：**思源笔记的本地图片会被转成 base64 内联，WeKnora 收到后会自动转存到对象存储并改写 URL**，无需手动处理图片。

## 安装

### 方式一：从源码构建

```bash
# 1. 安装依赖
cd siyuan-plugin-weknora-sync
pnpm install   # 或 npm install

# 2. 构建
pnpm build     # 产物在 dist/index.js

# 3. 打包（可选，生成 package.zip）
pnpm package
```

构建完成后：

- **开发模式**：把项目根目录软链接到思源的 `<工作空间>/data/plugins/weknora-sync/`
- **正式安装**：把 `dist/index.js`、`plugin.json`、`icon.png`、`preview.png`、`README*.md`、`index.css` 复制到 `<工作空间>/data/plugins/weknora-sync/`，然后在思源「设置 → 集市 → 已下载 → 插件」中启用。

> 思源插件开发模板推荐使用 `plugin-sample-vite-svelte`，本项目为纯 TypeScript + Vite，无需 svelte。如需热重载，可参考官方模板配置 `vite-plugin-siyuan`。

### 方式二：手动加载

1. 构建后得到 `dist/index.js`
2. 在思源工作空间下创建 `data/plugins/weknora-sync/` 目录
3. 复制以下文件到该目录：
   - `dist/index.js`
   - `plugin.json`
   - `index.css`
   - `icon.png`（自备 160×160）
   - `preview.png`（自备 1024×768）
   - `README.md`、`README_zh_CN.md`
4. 重启思源，在「设置 → 集市 → 已下载」启用插件

## 使用步骤

### 1. 准备 WeKnora

- 启动 WeKnora 服务（默认 `http://localhost:8080`）
- 注册账号并登录，在「个人设置 / API Key」处获取 `sk-xxxx` 形式的 API Key
- 创建一个知识库（建议 Markdown 类型），记下知识库 ID（形如 `kb-00000001`）

### 2. 配置插件

点击思源顶栏的「WeKnora 同步」图标，或用命令面板执行「同步思源笔记到 WeKnora」：

| 配置项 | 说明 |
|---|---|
| Base URL | WeKnora 服务地址，如 `http://localhost:8080` |
| API Key | WeKnora 的 `sk-xxxx` API Key |
| 知识库 | 下拉选择（点「刷新」从 WeKnora 拉取列表） |
| 笔记本 | 多选要同步的思源笔记本，不选=全部打开的笔记本 |
| 启用多模态 | 开启后图片会做 OCR + Caption（消耗 LLM 资源） |
| 并发数 | 同时上传的文档数（建议 1-3，避免拖慢思源） |
| 失败重试 | 单文档失败时的重试次数 |

点击「测试连接」验证配置，然后「保存配置」。

### 3. 开始同步

点击「开始同步」，进度条和日志区会实时显示：

```
[14:23:01] ✓ [产品手册] 上传成功 (图片: 内联 8/8)
[14:23:05] ✓ [架构设计] 上传成功 (图片: 内联 3/3)
[14:23:06] ⚠ [草稿] 1 张图片转 base64 失败: xxx.png
```

同步过程中可点「取消」发送停止信号（当前文档处理完后退出）。

## 常见问题

### Q: 测试连接失败 / 上传报 401

- 确认 API Key 正确（`sk-` 开头）
- 确认 WeKnora 服务可达：浏览器访问 `${Base URL}/api/v1/auth/me` 应返回 401（说明服务在跑）

### Q: 跨域请求被拦截

思源插件运行在 `http://127.0.0.1:6806`，调用外部 WeKnora 时浏览器会做 CORS 校验。如果 WeKnora 与思源不同源，需在 WeKnora 启动环境配置允许的来源，例如：

```bash
export CORS_ALLOWED_ORIGINS="http://127.0.0.1:6806,http://localhost:6806"
```

或将 WeKnora 部署在同一域名下走反代。

### Q: 图片转 base64 失败

日志会显示尝试过的候选路径。常见原因：

- 图片是网络图片（`http(s)://`），插件不处理这类，WeKnora 会自动下载
- 思源资源使用了非标准路径，可检查文档 markdown 中图片引用的写法
- 资源文件已被删除

### Q: 同步后图片在 WeKnora 显示为 `local://` 或 `minio://`

这是正常现象——WeKnora 已把图片转存到对象存储，`provider://` 是统一访问 scheme。前端通过后端代理读取，不会暴露原始存储 URL。若图片显示异常，请检查 WeKnora 的 `STORAGE_PROVIDER` 配置是否正确。

### Q: 想增量同步怎么办

当前版本是「全量上传」，重复文档会在 WeKnora 中创建新的知识条目（按标题重复）。如需增量，建议在 WeKnora 端按 `source=siyuan` + 标题去重，或在同步前手动删除旧条目。后续版本会加增量能力。

## 限制

- 单文档图片数量受 WeKnora 后端限制（默认 30 张远程图片，base64 内联无此限制但单文件大小受 `MAX_FILE_SIZE_MB` 约束）
- 跨文档块引用（`((block-id))`）在导出 markdown 时会被思源渲染为对应内容，块 ID 不会保留
- 思源特有的容器块、属性等在 markdown 中无法完整表达

## 配置文件位置

插件配置保存在思源工作空间的 `<workspace>/data/storage/petal/weknora-sync/weknora-sync-config.json`，可手动编辑。

## 开发

```bash
pnpm install
pnpm dev   # watch 模式，修改自动重新打包到 dist/
```

把项目根目录软链到 `<workspace>/data/plugins/weknora-sync/` 后，思源重启即可加载。修改代码后重新执行 `pnpm dev`，再在思源里「重载插件」生效。

## License

MIT
