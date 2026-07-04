/**
 * 图片处理：把思源 markdown 中的本地图片引用转成 base64 data URI
 *
 * 思源笔记中图片通常以 `![alt](assets/xxx.png)` 形式存在，资源文件
 * 存储在工作空间的 assets/ 目录下。我们通过思源 /api/file/getFile
 * 读取这些文件，转成 `data:image/...;base64,...` 内联到 markdown，
 * 这样上传到 WeKnora 后会被 ResolveDataURIImages 自动转存到对象存储。
 */

import { readFileBytes } from "./siyuan-api";

/** 匹配 markdown 图片语法 ![alt](url)，alt 允许含 ] */
const IMG_PATTERN = /!\[([^\]]*)\]\(([^)]+)\)/g;

/** 通过扩展名推断 MIME */
function mimeFromExt(name: string): string {
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

/** ArrayBuffer 转 base64（避免 btoa 在大文件下栈溢出） */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  return btoa(binary);
}

/** 判断图片 URL 是否为本地资源（非 http(s)://、非 data:） */
export function isLocalImageRef(url: string): boolean {
  if (url.startsWith("http://") || url.startsWith("https://")) return false;
  if (url.startsWith("data:")) return false;
  return true;
}

export interface InlineResult {
  markdown: string;
  totalImages: number;
  inlinedImages: number;
  failedImages: { ref: string; reason: string }[];
}

/**
 * 把 markdown 中的本地图片引用转成 base64 data URI。
 *
 * @param markdown 原始 markdown 内容
 * @param docBox   思源笔记本 ID（用于拼接 assets 路径）
 * @param docPath  文档的存储路径（如 /20210817205410-2kvfpfn/xxx.sy，用于相对路径解析）
 */
export async function inlineLocalImages(
  markdown: string,
  docBox: string,
  docPath: string
): Promise<InlineResult> {
  const matches = Array.from(markdown.matchAll(IMG_PATTERN));
  const result: InlineResult = {
    markdown,
    totalImages: matches.length,
    inlinedImages: 0,
    failedImages: [],
  };
  if (matches.length === 0) return result;

  // 思源文档的存储目录：如 /20210817205410-2kvfpfn/，相对路径基于此解析
  const docDir = docPath.substring(0, docPath.lastIndexOf("/") + 1);

  // 倒序替换以保持索引有效
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    const fullMatch = m[0];
    const alt = m[1];
    let url = m[2].trim();

    // 跳过已内联/远程图片
    if (!isLocalImageRef(url)) continue;

    // 去掉 URL 中的 title 后缀，如 "assets/foo.png \"标题\""
    const spaceIdx = url.indexOf(" ");
    if (spaceIdx > 0) url = url.substring(0, spaceIdx).trim();

    // 去掉开头的 ./ 或 .\
    if (url.startsWith("./")) url = url.substring(2);
    else if (url.startsWith(".\\")) url = url.substring(2);

    // 思源资源通常以 assets/ 开头，可能是工作空间全局 assets，也可能是文档同级
    // 优先尝试文档同级路径，再尝试笔记本根路径
    const candidates: string[] = [];
    if (url.startsWith("/")) {
      // 绝对路径直接用
      candidates.push(url);
    } else {
      candidates.push(`${docDir}${url}`);
      candidates.push(`/${docBox}/${url}`);
      candidates.push(`/${url}`);
    }

    let buf: ArrayBuffer | null = null;
    let usedPath = "";
    for (const cand of candidates) {
      try {
        buf = await readFileBytes(cand);
        if (buf) {
          usedPath = cand;
          break;
        }
      } catch {
        // 继续尝试下一个候选路径
      }
    }

    if (!buf || buf.byteLength === 0) {
      result.failedImages.push({
        ref: url,
        reason: `文件不存在或读取失败 (tried: ${candidates.join(", ")})`,
      });
      continue;
    }

    const mime = mimeFromExt(usedPath || url);
    const base64 = arrayBufferToBase64(buf);
    const dataUri = `data:${mime};base64,${base64}`;
    const replacement = `![${alt}](${dataUri})`;

    const start = m.index!;
    result.markdown =
      result.markdown.substring(0, start) + replacement + result.markdown.substring(start + fullMatch.length);
    result.inlinedImages++;
  }

  return result;
}
