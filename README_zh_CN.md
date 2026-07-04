# WeKnora 同步（思源笔记插件）

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

### 从源码构建

```bash
cd siyuan-plugin-weknora-sync
pnpm install
pnpm build      # 产物在 dist/index.js
pnpm package    # 生成 package.zip
```

把构建产物复制到思源工作空间的 `data/plugins/weknora-sync/` 目录：

- `dist/index.js`
- `plugin.json`
- `index.css`
- `icon.png`（160×160，自备）
- `preview.png`（1024×768，自备）
- `README.md`、`README_zh_CN.md`

重启思源，「设置 → 集市 → 已下载 → 插件」中启用 `weknora-sync`。

## 使用步骤

### 1. 准备 WeKnora

- 启动 WeKnora（默认 `http://localhost:8080`）
- 注册并登录，获取 API Key（`sk-xxxx`）
- 创建一个知识库，记下知识库 ID（`kb-00000001`）

### 2. 配置插件

点击思源顶栏的「WeKnora 同步」图标：

| 配置项 | 说明 |
|---|---|
| Base URL | WeKnora 服务地址 |
| API Key | `sk-xxxx` |
| 知识库 | 下拉选择，点「刷新」拉取列表 |
| 笔记本 | 多选要同步的笔记本，不选=全部 |
| 启用多模态 | 开启图片 OCR/Caption（消耗 LLM） |
| 并发数 | 同时上传数（建议 1-3） |
| 失败重试 | 单文档失败重试次数 |

「测试连接」→「保存配置」。

### 3. 开始同步

点「开始同步」，实时查看进度和日志。可随时「取消」。

## 常见问题

### 测试连接失败 / 401

确认 API Key 正确（`sk-` 开头），浏览器访问 `${Base URL}/api/v1/auth/me` 应返回 401。

### 跨域拦截

思源运行在 `http://127.0.0.1:6806`，调用外部 WeKnora 需配置 CORS：

```bash
export CORS_ALLOWED_ORIGINS="http://127.0.0.1:6806,http://localhost:6806"
```

或同域反代。

### 图片转 base64 失败

日志会显示尝试过的候选路径。原因：网络图片（不处理，WeKnora 自动下载）、资源路径非标准、文件已删。

### 同步后图片显示为 `local://` 或 `minio://`

正常。WeKnora 已转存到对象存储，`provider://` 是统一访问 scheme。显示异常请检查 `STORAGE_PROVIDER` 配置。

### 增量同步

当前为全量上传。如需增量，建议在 WeKnora 按 `source=siyuan` + 标题去重，或同步前手动删旧条目。

## 限制

- 单文档图片数受 WeKnora 限制（远程 30 张，base64 无此限制但受 `MAX_FILE_SIZE_MB` 约束）
- 思源块引用 `((block-id))` 导出时渲染为内容，块 ID 不保留
- 思源特有容器块、属性在 markdown 中无法完整表达

## 配置文件位置

`<workspace>/data/storage/petal/weknora-sync/weknora-sync-config.json`

## 开发

```bash
pnpm install
pnpm dev   # watch 模式
```

软链项目根目录到 `<workspace>/data/plugins/weknora-sync/`，思源重启加载。改代码后重新 `pnpm dev`，思源里「重载插件」生效。

## License

MIT
