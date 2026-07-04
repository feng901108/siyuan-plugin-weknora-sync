"use strict";
Object.defineProperties(exports, { __esModule: { value: true }, [Symbol.toStringTag]: { value: "Module" } });
const siyuan = require("siyuan");
const DEFAULT_CONFIG = {
  weknoraBaseUrl: "http://localhost:8080",
  weknoraApiKey: "",
  weknoraKbId: "",
  selectedNotebooks: [],
  enableMultimodel: false,
  concurrency: 2,
  retryTimes: 2
};
const CONFIG_KEY = "weknora-sync-config.json";
async function loadConfig(plugin) {
  try {
    const data = await plugin.loadData(CONFIG_KEY);
    if (!data) return { ...DEFAULT_CONFIG };
    const obj = typeof data === "string" ? JSON.parse(data) : data;
    return { ...DEFAULT_CONFIG, ...obj };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
async function saveConfig(plugin, cfg) {
  await plugin.saveData(CONFIG_KEY, JSON.stringify(cfg, null, 2));
}
const SIYUAN_BASE = "http://127.0.0.1:6806";
function getSiyuanToken() {
  var _a, _b, _c;
  const token = (_c = (_b = (_a = window == null ? void 0 : window.siyuan) == null ? void 0 : _a.config) == null ? void 0 : _b.api) == null ? void 0 : _c.token;
  if (!token) {
    console.warn("[WeKnoraSync] 未取到思源 API token，部分接口可能 401");
  }
  return token || "";
}
async function siyuanPost(path, body) {
  const headers = { "Content-Type": "application/json" };
  const token = getSiyuanToken();
  if (token) headers["Authorization"] = `Token ${token}`;
  const resp = await fetch(`${SIYUAN_BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body || {})
  });
  if (!resp.ok) {
    throw new Error(`思源 API ${path} HTTP ${resp.status}: ${await resp.text()}`);
  }
  const json = await resp.json();
  if (json.code !== 0) {
    throw new Error(`思源 API ${path} 失败: ${json.msg}`);
  }
  return json.data;
}
async function siyuanGetFile(filePath) {
  const headers = {};
  const token = getSiyuanToken();
  if (token) headers["Authorization"] = `Token ${token}`;
  const url = `${SIYUAN_BASE}/api/file/getFile?path=${encodeURIComponent(filePath)}`;
  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    return null;
  }
  return await resp.arrayBuffer();
}
async function listNotebooks() {
  const data = await siyuanPost("/api/notebook/lsNotebooks", {});
  return (data.notebooks || []).filter((n) => !n.closed);
}
async function listDocTree(notebookId) {
  return await siyuanPost("/api/filetree/listDocTree", { notebook: notebookId });
}
async function exportMdContent(docId) {
  return await siyuanPost("/api/export/exportMdContent", { id: docId });
}
async function readFileBytes(filePath) {
  return await siyuanGetFile(filePath);
}
function collectDocNodes(node) {
  const result = [];
  const walk = (n) => {
    if (n.type === "document") result.push(n);
    if (n.children) n.children.forEach(walk);
  };
  walk(node);
  return result;
}
async function weknoraFetch(cfg, method, path, body, isForm = false) {
  const headers = { "X-API-Key": cfg.apiKey };
  let payload;
  if (body !== void 0) {
    if (isForm) {
      payload = body;
    } else {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
  }
  const resp = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}${path}`, {
    method,
    headers,
    body: payload
  });
  const text = await resp.text();
  let json;
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
async function listKnowledgeBases(cfg) {
  const json = await weknoraFetch(cfg, "GET", "/api/v1/knowledge-bases");
  return json.data || [];
}
async function createManualKnowledge(cfg, title, content, opts) {
  const body = { title, content, status: "published" };
  body.channel = "siyuan";
  const json = await weknoraFetch(
    cfg,
    "POST",
    `/api/v1/knowledge-bases/${cfg.kbId}/knowledge/manual`,
    body
  );
  return json.data;
}
async function validateConfig(cfg) {
  try {
    await listKnowledgeBases(cfg);
    return true;
  } catch {
    return false;
  }
}
const IMG_PATTERN = /!\[([^\]]*)\]\(([^)]+)\)/g;
function mimeFromExt(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".ico")) return "image/x-icon";
  if (lower.endsWith(".tiff") || lower.endsWith(".tif")) return "image/tiff";
  return "application/octet-stream";
}
function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 32768;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}
function isLocalImageRef(url) {
  if (url.startsWith("http://") || url.startsWith("https://")) return false;
  if (url.startsWith("data:")) return false;
  return true;
}
async function inlineLocalImages(markdown, docBox, docPath) {
  const matches = Array.from(markdown.matchAll(IMG_PATTERN));
  const result = {
    markdown,
    totalImages: matches.length,
    inlinedImages: 0,
    failedImages: []
  };
  if (matches.length === 0) return result;
  const docDir = docPath.substring(0, docPath.lastIndexOf("/") + 1);
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    const fullMatch = m[0];
    const alt = m[1];
    let url = m[2].trim();
    if (!isLocalImageRef(url)) continue;
    const spaceIdx = url.indexOf(" ");
    if (spaceIdx > 0) url = url.substring(0, spaceIdx).trim();
    if (url.startsWith("./")) url = url.substring(2);
    else if (url.startsWith(".\\")) url = url.substring(2);
    const candidates = [];
    if (url.startsWith("/")) {
      candidates.push(url);
    } else {
      candidates.push(`${docDir}${url}`);
      candidates.push(`/${docBox}/${url}`);
      candidates.push(`/${url}`);
    }
    let buf = null;
    let usedPath = "";
    for (const cand of candidates) {
      try {
        buf = await readFileBytes(cand);
        if (buf) {
          usedPath = cand;
          break;
        }
      } catch {
      }
    }
    if (!buf || buf.byteLength === 0) {
      result.failedImages.push({
        ref: url,
        reason: `文件不存在或读取失败 (tried: ${candidates.join(", ")})`
      });
      continue;
    }
    const mime = mimeFromExt(usedPath || url);
    const base64 = arrayBufferToBase64(buf);
    const dataUri = `data:${mime};base64,${base64}`;
    const replacement = `![${alt}](${dataUri})`;
    const start = m.index;
    result.markdown = result.markdown.substring(0, start) + replacement + result.markdown.substring(start + fullMatch.length);
    result.inlinedImages++;
  }
  return result;
}
function newProgress(total) {
  return { total, done: 0, failed: 0, logs: [] };
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
async function withRetry(fn, retryTimes, label) {
  let lastErr;
  for (let i = 0; i <= retryTimes; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < retryTimes) await sleep(500 * (i + 1));
    }
  }
  throw new Error(`${label} 重试 ${retryTimes} 次仍失败: ${(lastErr == null ? void 0 : lastErr.message) || lastErr}`);
}
async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
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
function startSync(plugin, cfg, onProgress) {
  let cancelled = false;
  const weknoraCfg = {
    baseUrl: cfg.weknoraBaseUrl,
    apiKey: cfg.weknoraApiKey,
    kbId: cfg.weknoraKbId
  };
  const progress = newProgress(0);
  const promise = (async () => {
    const log = (level, msg) => {
      progress.logs.push({ level, msg, ts: Date.now() });
      onProgress({ ...progress, logs: [...progress.logs] });
    };
    try {
      log("info", "正在获取笔记本列表...");
      const notebooks = await listNotebooks();
      const selected = cfg.selectedNotebooks.length ? notebooks.filter((n) => cfg.selectedNotebooks.includes(n.id)) : notebooks;
      log("info", `将同步 ${selected.length} 个笔记本`);
      const allDocs = [];
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
      await mapWithConcurrency(allDocs, cfg.concurrency, async ({ node, box }) => {
        if (cancelled) return;
        progress.current = node.hPath || node.name;
        onProgress({ ...progress });
        try {
          const exported = await withRetry(
            () => exportMdContent(node.id),
            cfg.retryTimes,
            `导出 ${node.name}`
          );
          const inlined = await inlineLocalImages(exported.content, box, node.path);
          if (inlined.failedImages.length > 0) {
            log(
              "warn",
              `[${node.name}] ${inlined.failedImages.length} 张图片转 base64 失败: ` + inlined.failedImages.map((f) => f.ref).join(", ")
            );
          }
          const title = node.name || exported.hPath.split("/").pop() || "未命名";
          const meta = `> 来源：思源笔记 ${exported.hPath}
> 同步时间：${(/* @__PURE__ */ new Date()).toISOString()}

`;
          const finalContent = meta + inlined.markdown;
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
        } catch (e) {
          progress.failed++;
          log("error", `✗ [${node.name}] 失败: ${(e == null ? void 0 : e.message) || e}`);
        }
        onProgress({ ...progress });
      });
      log("info", `同步完成：成功 ${progress.done}，失败 ${progress.failed}，共 ${progress.total}`);
    } catch (e) {
      log("error", `同步任务异常: ${(e == null ? void 0 : e.message) || e}`);
    }
    return progress;
  })();
  return {
    promise,
    cancel: () => {
      cancelled = true;
    },
    getProgress: () => progress
  };
}
class WeKnoraSyncPlugin extends siyuan.Plugin {
  constructor() {
    super(...arguments);
    this.cfg = { ...DEFAULT_CONFIG };
    this.currentSync = null;
  }
  onload() {
    this.addTopBar({
      icon: "iconUpload",
      title: "WeKnora 同步",
      position: "right",
      callback: () => this.openMainDialog()
    });
    this.addCommand({
      icon: "iconUpload",
      hotkey: "",
      description: "同步思源笔记到 WeKnora",
      callback: () => this.openMainDialog()
    });
    loadConfig(this).then((cfg) => {
      this.cfg = cfg;
    });
  }
  onunload() {
    if (this.currentSync) {
      this.currentSync.cancel();
    }
  }
  /** 打开主对话框 */
  async openMainDialog() {
    this.cfg = await loadConfig(this);
    const dialog = new siyuan.Dialog({
      title: "WeKnora 同步",
      width: "720px",
      content: this.renderMainHtml()
    });
    const el = dialog.element.querySelector(".b3-dialog__container > div");
    if (!el) return;
    this.bindMainEvents(el, dialog);
    await this.refreshNotebookList(el);
    await this.refreshKbList(el);
  }
  /** 主界面 HTML */
  renderMainHtml() {
    return `<div class="b3-dialog__container" style="width:720px;height:640px;display:flex;flex-direction:column">
      <div style="padding:16px 24px 0 24px;font-size:18px;font-weight:600">WeKnora 同步</div>
      <div style="padding:8px 24px;flex:1;overflow:auto" id="weknora-main">

        <div style="margin-bottom:16px">
          <div style="font-weight:600;margin-bottom:8px">1. WeKnora 连接配置</div>
          <div style="display:grid;grid-template-columns:90px 1fr;gap:8px 12px;align-items:center">
            <label>Base URL</label>
            <input id="weknora-base-url" class="b3-text-field" value="${this.escape(this.cfg.weknoraBaseUrl)}" placeholder="http://localhost:8080"/>
            <label>API Key</label>
            <input id="weknora-api-key" class="b3-text-field" type="password" value="${this.escape(this.cfg.weknoraApiKey)}" placeholder="sk-xxxxx"/>
            <label>知识库</label>
            <div style="display:flex;gap:8px">
              <select id="weknora-kb-id" class="b3-select" style="flex:1"></select>
              <button id="weknora-refresh-kb" class="b3-button b3-button--outline">刷新</button>
              <button id="weknora-test" class="b3-button b3-button--outline">测试连接</button>
            </div>
          </div>
        </div>

        <div style="margin-bottom:16px">
          <div style="font-weight:600;margin-bottom:8px">2. 选择要同步的思源笔记本（不选=全部）</div>
          <div id="weknora-notebook-list" style="border:1px solid var(--b3-border-color);border-radius:4px;padding:8px;max-height:140px;overflow:auto"></div>
        </div>

        <div style="margin-bottom:16px">
          <div style="font-weight:600;margin-bottom:8px">3. 选项</div>
          <div style="display:flex;flex-direction:column;gap:6px">
            <label><input type="checkbox" id="weknora-multimodel" ${this.cfg.enableMultimodel ? "checked" : ""}/> 启用多模态解析（图片 OCR/Caption，会消耗更多 LLM 资源）</label>
            <div style="display:grid;grid-template-columns:90px 1fr;gap:8px 12px;align-items:center;margin-top:4px">
              <label>并发数</label>
              <input id="weknora-concurrency" type="number" min="1" max="8" value="${this.cfg.concurrency}" class="b3-text-field" style="width:80px"/>
              <label>失败重试</label>
              <input id="weknora-retry" type="number" min="0" max="5" value="${this.cfg.retryTimes}" class="b3-text-field" style="width:80px"/>
            </div>
          </div>
        </div>

        <div style="margin-bottom:16px">
          <div style="display:flex;gap:8px;align-items:center">
            <button id="weknora-save" class="b3-button b3-button--outline">保存配置</button>
            <button id="weknora-start" class="b3-button b3-button--text">开始同步</button>
            <button id="weknora-cancel" class="b3-button b3-button--cancel" disabled>取消</button>
          </div>
        </div>

        <div>
          <div style="font-weight:600;margin-bottom:8px">进度</div>
          <div id="weknora-progress-summary" style="margin-bottom:8px;color:var(--b3-theme-on-surface-light)"></div>
          <div id="weknora-progress-bar" style="height:8px;background:var(--b3-theme-background-light);border-radius:4px;overflow:hidden;margin-bottom:8px">
            <div id="weknora-progress-fill" style="height:100%;width:0;background:var(--b3-theme-primary);transition:width .2s"></div>
          </div>
          <div id="weknora-logs" style="height:200px;overflow:auto;border:1px solid var(--b3-border-color);border-radius:4px;padding:8px;font-size:12px;font-family:monospace;background:var(--b3-theme-background-light)"></div>
        </div>

      </div>
    </div>`;
  }
  /** 绑定主对话框事件 */
  bindMainEvents(container, dialog) {
    var _a, _b, _c, _d, _e;
    const $ = (id) => container.querySelector(`#${id}`);
    (_a = $("weknora-save")) == null ? void 0 : _a.addEventListener("click", async () => {
      await this.collectConfigFromUi(container);
      await saveConfig(this, this.cfg);
      this.toast("配置已保存");
    });
    (_b = $("weknora-refresh-kb")) == null ? void 0 : _b.addEventListener("click", async () => {
      await this.collectConfigFromUi(container);
      await this.refreshKbList(container);
    });
    (_c = $("weknora-test")) == null ? void 0 : _c.addEventListener("click", async () => {
      await this.collectConfigFromUi(container);
      const ok = await validateConfig(this.asWeknoraCfg());
      this.toast(ok ? "连接成功" : "连接失败，请检查 URL/API Key");
    });
    (_d = $("weknora-start")) == null ? void 0 : _d.addEventListener("click", async () => {
      await this.collectConfigFromUi(container);
      await saveConfig(this, this.cfg);
      $("weknora-start").setAttribute("disabled", "disabled");
      $("weknora-cancel").removeAttribute("disabled");
      container.querySelector("#weknora-logs").innerHTML = "";
      this.currentSync = startSync(this, this.cfg, (p) => this.renderProgress(container, p));
      try {
        await this.currentSync.promise;
      } finally {
        $("weknora-start").removeAttribute("disabled");
        $("weknora-cancel").setAttribute("disabled", "disabled");
        this.currentSync = null;
      }
    });
    (_e = $("weknora-cancel")) == null ? void 0 : _e.addEventListener("click", () => {
      if (this.currentSync) {
        this.currentSync.cancel();
        this.toast("已发送取消信号，正在等待当前任务完成");
      }
    });
  }
  /** 从 UI 收集配置到 this.cfg */
  async collectConfigFromUi(container) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const $ = (id) => container.querySelector(`#${id}`);
    this.cfg.weknoraBaseUrl = ((_b = (_a = $("weknora-base-url")) == null ? void 0 : _a.value) == null ? void 0 : _b.trim()) || "";
    this.cfg.weknoraApiKey = ((_d = (_c = $("weknora-api-key")) == null ? void 0 : _c.value) == null ? void 0 : _d.trim()) || "";
    this.cfg.weknoraKbId = ((_e = $("weknora-kb-id")) == null ? void 0 : _e.value) || "";
    this.cfg.enableMultimodel = ((_f = $("weknora-multimodel")) == null ? void 0 : _f.checked) || false;
    this.cfg.concurrency = parseInt(((_g = $("weknora-concurrency")) == null ? void 0 : _g.value) || "2", 10);
    this.cfg.retryTimes = parseInt(((_h = $("weknora-retry")) == null ? void 0 : _h.value) || "2", 10);
    const checks = container.querySelectorAll("input.weknora-nb-check");
    this.cfg.selectedNotebooks = Array.from(checks).filter((c) => c.checked).map((c) => c.value);
  }
  /** 刷新思源笔记本多选列表 */
  async refreshNotebookList(container) {
    const list = container.querySelector("#weknora-notebook-list");
    if (!list) return;
    list.innerHTML = `<div style="color:var(--b3-theme-on-surface-light)">加载中...</div>`;
    try {
      const notebooks = await listNotebooks();
      if (notebooks.length === 0) {
        list.innerHTML = `<div style="color:var(--b3-theme-on-surface-light)">未找到打开的笔记本</div>`;
        return;
      }
      list.innerHTML = notebooks.map(
        (n) => `
        <label style="display:block;padding:4px 0">
          <input type="checkbox" class="weknora-nb-check" value="${this.escape(n.id)}" ${this.cfg.selectedNotebooks.includes(n.id) ? "checked" : ""}/>
          ${this.escape(n.name)} <span style="color:var(--b3-theme-on-surface-light);font-size:12px">(${n.id})</span>
        </label>`
      ).join("");
    } catch (e) {
      list.innerHTML = `<div style="color:var(--b3-card-error-color)">加载失败: ${this.escape((e == null ? void 0 : e.message) || e)}</div>`;
    }
  }
  /** 刷新 WeKnora 知识库下拉 */
  async refreshKbList(container) {
    const select = container.querySelector("#weknora-kb-id");
    if (!select) return;
    select.innerHTML = `<option value="">加载中...</option>`;
    try {
      const kbs = await listKnowledgeBases(this.asWeknoraCfg());
      if (kbs.length === 0) {
        select.innerHTML = `<option value="">（无知识库，请先在 WeKnora 创建）</option>`;
        return;
      }
      select.innerHTML = kbs.map(
        (kb) => `<option value="${this.escape(kb.id)}" ${kb.id === this.cfg.weknoraKbId ? "selected" : ""}>${this.escape(kb.name || kb.id)}</option>`
      ).join("");
    } catch (e) {
      select.innerHTML = `<option value="">加载失败: ${this.escape((e == null ? void 0 : e.message) || e)}</option>`;
    }
  }
  /** 渲染进度 */
  renderProgress(container, p) {
    const $ = (id) => container.querySelector(`#${id}`);
    const summary = $("weknora-progress-summary");
    if (summary) {
      const pct = p.total > 0 ? Math.round(p.done / p.total * 100) : 0;
      summary.textContent = `进度: ${p.done}/${p.total}（失败 ${p.failed}）${p.current ? " | 当前: " + p.current : ""}`;
      const fill = $("weknora-progress-fill");
      if (fill) fill.setAttribute("style", `height:100%;width:${pct}%;background:var(--b3-theme-primary);transition:width .2s`);
    }
    const logs = $("weknora-logs");
    if (logs) {
      const recent = p.logs.slice(-200);
      logs.innerHTML = recent.map((l) => {
        const color = l.level === "error" ? "var(--b3-card-error-color)" : l.level === "warn" ? "var(--b3-card-warning-color)" : "var(--b3-theme-on-surface)";
        const time = new Date(l.ts).toLocaleTimeString();
        return `<div style="color:${color}">[${time}] ${this.escape(l.msg)}</div>`;
      }).join("");
      logs.scrollTop = logs.scrollHeight;
    }
  }
  asWeknoraCfg() {
    return {
      baseUrl: this.cfg.weknoraBaseUrl,
      apiKey: this.cfg.weknoraApiKey,
      kbId: this.cfg.weknoraKbId
    };
  }
  escape(s) {
    if (s == null) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  toast(msg) {
    var _a, _b;
    try {
      (_b = (_a = window.siyuan) == null ? void 0 : _a.showMessage) == null ? void 0 : _b.call(_a, msg);
    } catch {
      console.log("[WeKnoraSync]", msg);
    }
  }
}
exports.default = WeKnoraSyncPlugin;
