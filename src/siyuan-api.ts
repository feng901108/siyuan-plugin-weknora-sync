/**
 * 思源笔记内核 API 封装
 * 文档：https://github.com/siyuan-note/siyuan/blob/master/API_zh_CN.md
 *
 * 所有接口默认走 http://127.0.0.1:6806（思源内核端口），POST + JSON。
 * 鉴权：Authorization: Token <apiToken>，apiToken 从 window.siyuan.config.api.token 取。
 */

const SIYUAN_BASE = "http://127.0.0.1:6806";

function getSiyuanToken(): string {
  // 思源插件运行时会把全局配置挂在 window.siyuan
  const token = (window as any)?.siyuan?.config?.api?.token;
  if (!token) {
    console.warn("[WeKnoraSync] 未取到思源 API token，部分接口可能 401");
  }
  return token || "";
}

async function siyuanPost<T = any>(path: string, body: any): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getSiyuanToken();
  if (token) headers["Authorization"] = `Token ${token}`;
  const resp = await fetch(`${SIYUAN_BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body || {}),
  });
  if (!resp.ok) {
    throw new Error(`思源 API ${path} HTTP ${resp.status}: ${await resp.text()}`);
  }
  const json = await resp.json();
  if (json.code !== 0) {
    throw new Error(`思源 API ${path} 失败: ${json.msg}`);
  }
  return json.data as T;
}

/** GET 思源文件（用于读取 assets 资源文件二进制） */
async function siyuanGetFile(filePath: string): Promise<ArrayBuffer | null> {
  const headers: Record<string, string> = {};
  const token = getSiyuanToken();
  if (token) headers["Authorization"] = `Token ${token}`;
  // /api/file/getFile 支持 GET，参数 path 通过 query 传
  const url = `${SIYUAN_BASE}/api/file/getFile?path=${encodeURIComponent(filePath)}`;
  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    // 文件不存在会返回 4xx，调用方需自行处理
    return null;
  }
  return await resp.arrayBuffer();
}

// ------- 类型定义 -------

export interface Notebook {
  id: string;
  name: string;
  icon: string;
  sort: number;
  closed: boolean;
}

export interface DocTreeFile {
  id: string;
  name: string; // 文档标题
  path: string; // 如 /xxx.sy
  hPath: string; // 人类可读路径 /笔记名/xxx
}

// listDocTree 返回的节点结构（简化）
export interface DocTreeNode {
  id: string;
  name: string;
  type: "notebook" | "folder" | "document";
  box: string; // notebook id
  path: string;
  hPath?: string;
  subType?: string;
  children?: DocTreeNode[];
}

export interface ExportMdResult {
  hPath: string;
  content: string; // markdown 内容
}

// ------- API 方法 -------

/** 列出所有打开的笔记本 */
export async function listNotebooks(): Promise<Notebook[]> {
  const data = await siyuanPost<{ notebooks: Notebook[] }>("/api/notebook/lsNotebooks", {});
  return (data.notebooks || []).filter((n) => !n.closed);
}

/** 列出笔记本下的文档树（含子文档） */
export async function listDocTree(notebookId: string): Promise<DocTreeNode> {
  return await siyuanPost<DocTreeNode>("/api/filetree/listDocTree", { notebook: notebookId });
}

/** 导出文档为 Markdown（含原始 markdown 内容） */
export async function exportMdContent(docId: string): Promise<ExportMdResult> {
  return await siyuanPost<ExportMdResult>("/api/export/exportMdContent", { id: docId });
}

/** 读取思源工作空间内的文件（assets 等）二进制 */
export async function readFileBytes(filePath: string): Promise<ArrayBuffer | null> {
  return await siyuanGetFile(filePath);
}

/** 深度优先遍历文档树，返回所有文档节点 */
export function collectDocNodes(node: DocTreeNode): DocTreeNode[] {
  const result: DocTreeNode[] = [];
  const walk = (n: DocTreeNode) => {
    if (n.type === "document") result.push(n);
    if (n.children) n.children.forEach(walk);
  };
  walk(node);
  return result;
}
