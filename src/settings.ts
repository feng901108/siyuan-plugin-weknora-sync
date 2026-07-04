/**
 * 配置存储：用思源 plugin.loadData/saveData 持久化插件配置
 */

export interface SyncConfig {
  weknoraBaseUrl: string;
  weknoraApiKey: string;
  weknoraKbId: string;
  // 选中的笔记本 ID 列表（空数组=全部笔记本）
  selectedNotebooks: string[];
  // 是否启用多模态解析（图文 OCR/Caption）
  enableMultimodel: boolean;
  // 并发上传数
  concurrency: number;
  // 失败重试次数
  retryTimes: number;
}

export const DEFAULT_CONFIG: SyncConfig = {
  weknoraBaseUrl: "http://localhost:8080",
  weknoraApiKey: "",
  weknoraKbId: "",
  selectedNotebooks: [],
  enableMultimodel: false,
  concurrency: 2,
  retryTimes: 2,
};

/** 配置存储 key */
const CONFIG_KEY = "weknora-sync-config.json";

export async function loadConfig(plugin: any): Promise<SyncConfig> {
  try {
    const data = await plugin.loadData(CONFIG_KEY);
    if (!data) return { ...DEFAULT_CONFIG };
    const obj = typeof data === "string" ? JSON.parse(data) : data;
    return { ...DEFAULT_CONFIG, ...obj };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(plugin: any, cfg: SyncConfig): Promise<void> {
  await plugin.saveData(CONFIG_KEY, JSON.stringify(cfg, null, 2));
}
