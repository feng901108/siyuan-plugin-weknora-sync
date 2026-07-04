/**
 * WeKnora API 封装
 * 文档：docs/api/knowledge.md、docs/api/auth.md
 *
 * 鉴权方式：X-API-Key: sk-xxxx（在 WeKnora 注册/登录后从租户信息中获取）
 */

export interface WeKnoraConfig {
  baseUrl: string; // 如 http://localhost:8080
  apiKey: string; // sk-xxxx
  kbId: string; // 目标知识库 ID，如 kb-00000001
}

export interface WeKnoraKnowledge {
  id: string;
  title: string;
  parse_status: string;
  knowledge_base_id: string;
}

export interface WeKnoraKB {
  id: string;
  name: string;
  description: string;
  embedding_model_id: string;
}

/** 调用 WeKnora，自动加 X-API-Key */
async function weknoraFetch(
  cfg: WeKnoraConfig,
  method: string,
  path: string,
  body?: any,
  isForm = false
): Promise<any> {
  const headers: Record<string, string> = { "X-API-Key": cfg.apiKey };
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    if (isForm) {
      payload = body as BodyInit; // 调用方已构造 FormData
    } else {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
  }
  const resp = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}${path}`, {
    method,
    headers,
    body: payload,
  });
  const text = await resp.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`WeKnora ${path} 返回非 JSON: HTTP ${resp.status} - ${text.slice(0, 200)}`);
  }
  if (!resp.ok || json.success === false) {
    const msg = json.message || json.error || `HTTP ${resp.status}`;
    throw new Error(`WeKnora ${path} 失败: ${msg}`);
  }
  return json;
}

/** 列出当前租户下所有知识库（用于配置 UI 下拉选择） */
export async function listKnowledgeBases(cfg: WeKnoraConfig): Promise<WeKnoraKB[]> {
  const json = await weknoraFetch(cfg, "GET", "/api/v1/knowledge-bases");
  return (json.data || []) as WeKnoraKB[];
}

/** 创建手工 Markdown 知识（触发后台自动解析图片转存到对象存储） */
export async function createManualKnowledge(
  cfg: WeKnoraConfig,
  title: string,
  content: string,
  opts?: { tag_id?: string; channel?: string }
): Promise<WeKnoraKnowledge> {
  const body: any = { title, content, status: "published" };
  if (opts?.tag_id) body.tag_id = opts.tag_id;
  body.channel = opts?.channel || "siyuan";
  const json = await weknoraFetch(
    cfg,
    "POST",
    `/api/v1/knowledge-bases/${cfg.kbId}/knowledge/manual`,
    body
  );
  return json.data as WeKnoraKnowledge;
}

/** 上传文件创建知识（备用方案，用于二进制文件如 PDF） */
export async function createFileKnowledge(
  cfg: WeKnoraConfig,
  fileName: string,
  fileBytes: Uint8Array,
  opts?: { enable_multimodel?: boolean; channel?: string }
): Promise<WeKnoraKnowledge> {
  const form = new FormData();
  // 复制到一个独立的 ArrayBuffer，避免 SharedArrayBuffer 类型不兼容
  const buf = new ArrayBuffer(fileBytes.byteLength);
  new Uint8Array(buf).set(fileBytes);
  const blob = new Blob([buf], { type: "application/octet-stream" });
  form.append("file", blob, fileName);
  if (opts?.enable_multimodel !== undefined) {
    form.append("enable_multimodel", String(opts.enable_multimodel));
  }
  form.append("channel", opts?.channel || "siyuan");
  const json = await weknoraFetch(
    cfg,
    "POST",
    `/api/v1/knowledge-bases/${cfg.kbId}/knowledge/file`,
    form,
    true
  );
  return json.data as WeKnoraKnowledge;
}

/** 校验 API Key 与连通性 */
export async function validateConfig(cfg: WeKnoraConfig): Promise<boolean> {
  try {
    await listKnowledgeBases(cfg);
    return true;
  } catch {
    return false;
  }
}
