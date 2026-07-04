/**
 * 同步主流程：遍历思源笔记本 → 导出 markdown → 内联图片 → 上传 WeKnora
 */

import {
  listNotebooks,
  listDocTree,
  exportMdContent,
  collectDocNodes,
  type DocTreeNode,
} from "./siyuan-api";
import { createManualKnowledge, type WeKnoraConfig } from "./weknora-api";
import { inlineLocalImages } from "./image";
import type { SyncConfig } from "./settings";

export interface SyncProgress {
  total: number;
  done: number;
  failed: number;
  current?: string;
  logs: { level: "info" | "warn" | "error"; msg: string; ts: number }[];
}

export interface SyncHandle {
  promise: Promise<SyncProgress>;
  cancel: () => void;
  getProgress: () => SyncProgress;
}

function newProgress(total: number): SyncProgress {
  return { total, done: 0, failed: 0, logs: [] };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 带重试的 Promise 执行 */
async function withRetry<T>(fn: () => Promise<T>, retryTimes: number, label: string): Promise<T> {
  let lastErr: any;
  for (let i = 0; i <= retryTimes; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < retryTimes) await sleep(500 * (i + 1));
    }
  }
  throw new Error(`${label} 重试 ${retryTimes} 次仍失败: ${lastErr?.message || lastErr}`);
}

/** 并发执行（限制并发数） */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * 启动同步任务
 *
 * @param plugin    思源 Plugin 实例（用于通知）
 * @param cfg       配置
 * @param onProgress 进度回调
 */
export function startSync(
  plugin: any,
  cfg: SyncConfig,
  onProgress: (p: SyncProgress) => void
): SyncHandle {
  let cancelled = false;

  const weknoraCfg: WeKnoraConfig = {
    baseUrl: cfg.weknoraBaseUrl,
    apiKey: cfg.weknoraApiKey,
    kbId: cfg.weknoraKbId,
  };

  const progress = newProgress(0);

  const promise = (async (): Promise<SyncProgress> => {
    const log = (level: "info" | "warn" | "error", msg: string) => {
      progress.logs.push({ level, msg, ts: Date.now() });
      onProgress({ ...progress, logs: [...progress.logs] });
    };

    try {
      // 1. 列出笔记本
      log("info", "正在获取笔记本列表...");
      const notebooks = await listNotebooks();
      const selected = cfg.selectedNotebooks.length
        ? notebooks.filter((n) => cfg.selectedNotebooks.includes(n.id))
        : notebooks;

      log("info", `将同步 ${selected.length} 个笔记本`);

      // 2. 收集所有文档节点
      const allDocs: { node: DocTreeNode; box: string }[] = [];
      for (const nb of selected) {
        if (cancelled) break;
        const tree = await listDocTree(nb.id);
        const docs = collectDocNodes(tree);
        docs.forEach((d) => allDocs.push({ node: d, box: nb.id }));
        log("info", `笔记本 [${nb.name}] 有 ${docs.length} 篇文档`);
      }

      progress.total = allDocs.length;
      onProgress({ ...progress });

      if (cancelled) {
        log("warn", "已取消");
        return progress;
      }

      // 3. 并发上传
      await mapWithConcurrency(allDocs, cfg.concurrency, async ({ node, box }) => {
        if (cancelled) return;
        progress.current = node.hPath || node.name;
        onProgress({ ...progress });

        try {
          // 3.1 导出 markdown
          const exported = await withRetry(
            () => exportMdContent(node.id),
            cfg.retryTimes,
            `导出 ${node.name}`
          );

          // 3.2 内联本地图片为 base64
          const inlined = await inlineLocalImages(exported.content, box, node.path);

          if (inlined.failedImages.length > 0) {
            log(
              "warn",
              `[${node.name}] ${inlined.failedImages.length} 张图片转 base64 失败: ` +
                inlined.failedImages.map((f) => f.ref).join(", ")
            );
          }

          // 3.3 标题：用文档名，无标题时用 hPath 末段
          const title = node.name || exported.hPath.split("/").pop() || "未命名";

          // 3.4 在 markdown 顶部追加来源元信息
          const meta = `> 来源：思源笔记 ${exported.hPath}\n> 同步时间：${new Date().toISOString()}\n\n`;
          const finalContent = meta + inlined.markdown;

          // 3.5 上传到 WeKnora（触发改后端 ResolveDataURIImages 自动转存图片到对象存储）
          await withRetry(
            () => createManualKnowledge(weknoraCfg, title, finalContent),
            cfg.retryTimes,
            `上传 ${node.name}`
          );

          progress.done++;
          log(
            "info",
            `✓ [${title}] 上传成功 (图片: 内联 ${inlined.inlinedImages}/${inlined.totalImages})`
          );
        } catch (e: any) {
          progress.failed++;
          log("error", `✗ [${node.name}] 失败: ${e?.message || e}`);
        }

        onProgress({ ...progress });
      });

      log("info", `同步完成：成功 ${progress.done}，失败 ${progress.failed}，共 ${progress.total}`);
    } catch (e: any) {
      log("error", `同步任务异常: ${e?.message || e}`);
    }

    return progress;
  })();

  return {
    promise,
    cancel: () => {
      cancelled = true;
    },
    getProgress: () => progress,
  };
}
