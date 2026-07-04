/**
 * WeKnora Sync 插件入口
 *
 * 功能：把思源笔记的文档（含本地图片）同步到 WeKnora 知识库
 * 图片自动转 base64 内联 → WeKnora 后台自动转存到对象存储并改写 URL
 */

import { Plugin, Dialog } from "siyuan";
import { loadConfig, saveConfig, DEFAULT_CONFIG, type SyncConfig } from "./settings";
import { listNotebooks } from "./siyuan-api";
import { listKnowledgeBases, validateConfig, type WeKnoraKB } from "./weknora-api";
import { startSync, type SyncProgress, type SyncHandle } from "./sync";

class WeKnoraSyncPlugin extends Plugin {
  private cfg: SyncConfig = { ...DEFAULT_CONFIG };
  private currentSync: SyncHandle | null = null;

  onload() {
    // 顶部菜单注册命令
    this.addTopBar({
      icon: "iconUpload",
      title: "WeKnora 同步",
      position: "right",
      callback: () => this.openMainDialog(),
    });

    this.addCommand({
      icon: "iconUpload",
      hotkey: "",
      description: "同步思源笔记到 WeKnora",
      callback: () => this.openMainDialog(),
    });

    // 加载已保存的配置
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
  private async openMainDialog() {
    this.cfg = await loadConfig(this);

    const dialog = new Dialog({
      title: "WeKnora 同步",
      width: "720px",
      content: this.renderMainHtml(),
    });

    const el = dialog.element.querySelector(".b3-dialog__container > div");
    if (!el) return;

    this.bindMainEvents(el as HTMLElement, dialog);
    await this.refreshNotebookList(el as HTMLElement);
    await this.refreshKbList(el as HTMLElement);
  }

  /** 主界面 HTML */
  private renderMainHtml(): string {
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
  private bindMainEvents(container: HTMLElement, dialog: any) {
    const $ = (id: string) => container.querySelector(`#${id}`) as HTMLElement;

    $("weknora-save")?.addEventListener("click", async () => {
      await this.collectConfigFromUi(container);
      await saveConfig(this, this.cfg);
      this.toast("配置已保存");
    });

    $("weknora-refresh-kb")?.addEventListener("click", async () => {
      await this.collectConfigFromUi(container);
      await this.refreshKbList(container);
    });

    $("weknora-test")?.addEventListener("click", async () => {
      await this.collectConfigFromUi(container);
      const ok = await validateConfig(this.asWeknoraCfg());
      this.toast(ok ? "连接成功" : "连接失败，请检查 URL/API Key");
    });

    $("weknora-start")?.addEventListener("click", async () => {
      await this.collectConfigFromUi(container);
      await saveConfig(this, this.cfg);

      $("weknora-start").setAttribute("disabled", "disabled");
      $("weknora-cancel").removeAttribute("disabled");
      (container.querySelector("#weknora-logs") as HTMLElement).innerHTML = "";

      this.currentSync = startSync(this, this.cfg, (p) => this.renderProgress(container, p));
      try {
        await this.currentSync.promise;
      } finally {
        $("weknora-start").removeAttribute("disabled");
        $("weknora-cancel").setAttribute("disabled", "disabled");
        this.currentSync = null;
      }
    });

    $("weknora-cancel")?.addEventListener("click", () => {
      if (this.currentSync) {
        this.currentSync.cancel();
        this.toast("已发送取消信号，正在等待当前任务完成");
      }
    });
  }

  /** 从 UI 收集配置到 this.cfg */
  private async collectConfigFromUi(container: HTMLElement) {
    const $ = (id: string) => container.querySelector(`#${id}`) as HTMLInputElement | HTMLSelectElement;
    this.cfg.weknoraBaseUrl = ($("weknora-base-url") as HTMLInputElement)?.value?.trim() || "";
    this.cfg.weknoraApiKey = ($("weknora-api-key") as HTMLInputElement)?.value?.trim() || "";
    this.cfg.weknoraKbId = ($("weknora-kb-id") as HTMLSelectElement)?.value || "";
    this.cfg.enableMultimodel = ($("weknora-multimodel") as HTMLInputElement)?.checked || false;
    this.cfg.concurrency = parseInt(($("weknora-concurrency") as HTMLInputElement)?.value || "2", 10);
    this.cfg.retryTimes = parseInt(($("weknora-retry") as HTMLInputElement)?.value || "2", 10);

    // 选中的笔记本
    const checks = container.querySelectorAll<HTMLInputElement>("input.weknora-nb-check");
    this.cfg.selectedNotebooks = Array.from(checks)
      .filter((c) => c.checked)
      .map((c) => c.value);
  }

  /** 刷新思源笔记本多选列表 */
  private async refreshNotebookList(container: HTMLElement) {
    const list = container.querySelector("#weknora-notebook-list") as HTMLElement;
    if (!list) return;
    list.innerHTML = `<div style="color:var(--b3-theme-on-surface-light)">加载中...</div>`;
    try {
      const notebooks = await listNotebooks();
      if (notebooks.length === 0) {
        list.innerHTML = `<div style="color:var(--b3-theme-on-surface-light)">未找到打开的笔记本</div>`;
        return;
      }
      list.innerHTML = notebooks
        .map(
          (n) => `
        <label style="display:block;padding:4px 0">
          <input type="checkbox" class="weknora-nb-check" value="${this.escape(n.id)}" ${this.cfg.selectedNotebooks.includes(n.id) ? "checked" : ""}/>
          ${this.escape(n.name)} <span style="color:var(--b3-theme-on-surface-light);font-size:12px">(${n.id})</span>
        </label>`
        )
        .join("");
    } catch (e: any) {
      list.innerHTML = `<div style="color:var(--b3-card-error-color)">加载失败: ${this.escape(e?.message || e)}</div>`;
    }
  }

  /** 刷新 WeKnora 知识库下拉 */
  private async refreshKbList(container: HTMLElement) {
    const select = container.querySelector("#weknora-kb-id") as HTMLSelectElement;
    if (!select) return;
    select.innerHTML = `<option value="">加载中...</option>`;
    try {
      const kbs = await listKnowledgeBases(this.asWeknoraCfg());
      if (kbs.length === 0) {
        select.innerHTML = `<option value="">（无知识库，请先在 WeKnora 创建）</option>`;
        return;
      }
      select.innerHTML = kbs
        .map(
          (kb) =>
            `<option value="${this.escape(kb.id)}" ${kb.id === this.cfg.weknoraKbId ? "selected" : ""}>${this.escape(kb.name || kb.id)}</option>`
        )
        .join("");
    } catch (e: any) {
      select.innerHTML = `<option value="">加载失败: ${this.escape(e?.message || e)}</option>`;
    }
  }

  /** 渲染进度 */
  private renderProgress(container: HTMLElement, p: SyncProgress) {
    const $ = (id: string) => container.querySelector(`#${id}`) as HTMLElement;
    const summary = $("weknora-progress-summary");
    if (summary) {
      const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
      summary.textContent = `进度: ${p.done}/${p.total}（失败 ${p.failed}）${p.current ? " | 当前: " + p.current : ""}`;
      const fill = $("weknora-progress-fill");
      if (fill) fill.setAttribute("style", `height:100%;width:${pct}%;background:var(--b3-theme-primary);transition:width .2s`);
    }
    const logs = $("weknora-logs");
    if (logs) {
      // 只渲染最后 200 条避免卡顿
      const recent = p.logs.slice(-200);
      logs.innerHTML = recent
        .map((l) => {
          const color =
            l.level === "error"
              ? "var(--b3-card-error-color)"
              : l.level === "warn"
              ? "var(--b3-card-warning-color)"
              : "var(--b3-theme-on-surface)";
          const time = new Date(l.ts).toLocaleTimeString();
          return `<div style="color:${color}">[${time}] ${this.escape(l.msg)}</div>`;
        })
        .join("");
      logs.scrollTop = logs.scrollHeight;
    }
  }

  private asWeknoraCfg() {
    return {
      baseUrl: this.cfg.weknoraBaseUrl,
      apiKey: this.cfg.weknoraApiKey,
      kbId: this.cfg.weknoraKbId,
    };
  }

  private escape(s: string): string {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  private toast(msg: string) {
    try {
      (window as any).siyuan?.showMessage?.(msg);
    } catch {
      console.log("[WeKnoraSync]", msg);
    }
  }
}

export default WeKnoraSyncPlugin;
