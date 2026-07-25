type GeneratedDownloadFile = {
  url?: string;
  contentType?: string;
  size?: number;
  aliases?: string[];
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
    variants.add(decodeURIComponent(fileName));
  } catch {}
  try {
    variants.add(encodeURI(fileName));
    variants.add(encodeURIComponent(fileName));
  } catch {}
  return Array.from(variants).sort((left, right) => right.length - left.length);
}

function getPathFileName(path: string) {
  const normalized = String(path || "").split(/[?#]/, 1)[0];
  const fileName = normalized.split(/[\\/]/).pop() || "";
  try {
    return decodeURIComponent(fileName);
  } catch {
    return fileName;
  }
}

function getFileExtension(fileName: string) {
  const normalized = getPathFileName(fileName).toLowerCase();
  const lastDot = normalized.lastIndexOf(".");
  return lastDot >= 0 ? normalized.slice(lastDot + 1) : "";
}

export function extractGeneratedSandboxFilePaths(content: string) {
  const matches = String(content || "").match(
    /sandbox:\/(?:mnt\/data|tmp)\/[^\s)\]}>"']+/gi,
  );
  return Array.from(new Set(matches || []));
}

export function assignGeneratedFileAliases(
  output: string,
  files: GeneratedDownloadFiles,
) {
  const sandboxPaths = extractGeneratedSandboxFilePaths(output);
  if (sandboxPaths.length === 0) return files;

  const entries = Object.entries(files).filter(([, file]) =>
    Boolean(file?.url),
  );
  const assignedPaths = new Set<string>();
  const assignedFiles = new Set<string>();

  for (const sandboxPath of sandboxPaths) {
    const sandboxFileName = getPathFileName(sandboxPath);
    const exactEntry = entries.find(
      ([fileName]) =>
        !assignedFiles.has(fileName) &&
        getPathFileName(fileName).toLowerCase() ===
          sandboxFileName.toLowerCase(),
    );
    if (!exactEntry) continue;
    const [fileName, file] = exactEntry;
    file.aliases = Array.from(new Set([...(file.aliases || []), sandboxPath]));
    assignedPaths.add(sandboxPath);
    assignedFiles.add(fileName);
  }

  const extensions = new Set(
    sandboxPaths
      .filter((path) => !assignedPaths.has(path))
      .map(getFileExtension)
      .filter(Boolean),
  );

  for (const extension of extensions) {
    const remainingPaths = sandboxPaths.filter(
      (path) =>
        !assignedPaths.has(path) && getFileExtension(path) === extension,
    );
    const remainingEntries = entries.filter(
      ([fileName]) =>
        !assignedFiles.has(fileName) &&
        getFileExtension(fileName) === extension,
    );
    if (
      remainingPaths.length === 0 ||
      remainingPaths.length !== remainingEntries.length
    ) {
      continue;
    }

    remainingPaths.forEach((sandboxPath, index) => {
      const [fileName, file] = remainingEntries[index];
      file.aliases = Array.from(
        new Set([...(file.aliases || []), sandboxPath]),
      );
      assignedPaths.add(sandboxPath);
      assignedFiles.add(fileName);
    });
  }

  return files;
}

export function rewriteGeneratedFileLinks(
  content: string,
  files: GeneratedDownloadFiles,
) {
  let rewritten = String(content || "");
  for (const [fileName, file] of Object.entries(files || {})) {
    const url = String(file?.url || "").trim();
    if (!fileName || !url) continue;

    const aliases = new Set(file.aliases || []);
    for (const nameVariant of getFileNameVariants(fileName)) {
      aliases.add(`sandbox:/mnt/data/${nameVariant}`);
      aliases.add(`/mnt/data/${nameVariant}`);
      aliases.add(`sandbox:/tmp/${nameVariant}`);
      aliases.add(`/tmp/${nameVariant}`);
    }
    for (const alias of Array.from(aliases).sort(
      (left, right) => right.length - left.length,
    )) {
      rewritten = replaceAllLiteral(rewritten, alias, url);
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
