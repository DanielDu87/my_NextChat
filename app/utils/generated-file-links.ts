type GeneratedDownloadFile = {
  url?: string;
  contentType?: string;
  size?: number;
};

type ToolWithContent = {
  content?: string;
};

export type GeneratedDownloadFiles = Record<string, GeneratedDownloadFile>;

function replaceAllLiteral(value: string, search: string, replacement: string) {
  return search ? value.split(search).join(replacement) : value;
}

function getFileNameVariants(fileName: string) {
  const variants = new Set([fileName]);
  try {
    variants.add(encodeURI(fileName));
    variants.add(encodeURIComponent(fileName));
  } catch {}
  return Array.from(variants).sort((left, right) => right.length - left.length);
}

export function rewriteGeneratedFileLinks(
  content: string,
  files: GeneratedDownloadFiles,
) {
  let rewritten = String(content || "");
  for (const [fileName, file] of Object.entries(files || {})) {
    const url = String(file?.url || "").trim();
    if (!fileName || !url) continue;

    for (const nameVariant of getFileNameVariants(fileName)) {
      rewritten = replaceAllLiteral(
        rewritten,
        `sandbox:/mnt/data/${nameVariant}`,
        url,
      );
      rewritten = replaceAllLiteral(rewritten, `/mnt/data/${nameVariant}`, url);
    }
  }
  return rewritten;
}

export function getGeneratedDownloadFilesFromTools(
  tools: ToolWithContent[] = [],
) {
  const files: GeneratedDownloadFiles = {};
  for (const tool of tools) {
    if (!tool?.content) continue;
    try {
      const payload = JSON.parse(tool.content);
      const toolFiles = payload?.files;
      if (!toolFiles || typeof toolFiles !== "object") continue;
      for (const [fileName, file] of Object.entries(toolFiles)) {
        if (file && typeof file === "object" && (file as any).url) {
          files[fileName] = file as GeneratedDownloadFile;
        }
      }
    } catch {}
  }
  return files;
}

export function rewriteGeneratedFileLinksFromTools(
  content: string,
  tools: ToolWithContent[] = [],
) {
  return rewriteGeneratedFileLinks(
    content,
    getGeneratedDownloadFilesFromTools(tools),
  );
}

function escapeMarkdownLabel(value: string) {
  return value.replace(/([\\[\]])/g, "\\$1");
}

export function appendGeneratedFileDownloadLinks(
  output: string,
  files: GeneratedDownloadFiles,
) {
  const entries = Object.entries(files).filter(([, file]) =>
    Boolean(file?.url),
  );
  if (entries.length === 0) return output;

  const normalizedOutput = rewriteGeneratedFileLinks(output, files).trim();
  const downloadLinks = entries
    .map(
      ([fileName, file]) =>
        `- [${escapeMarkdownLabel(fileName)}](${String(file.url)})`,
    )
    .join("\n");
  return [
    normalizedOutput,
    "生成文件下载链接（必须原样使用，不得改写为临时容器路径）：",
    downloadLinks,
  ]
    .filter(Boolean)
    .join("\n\n");
}
