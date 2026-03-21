import fs from "fs";
import path from "path";
import { CN_MASKS } from "./cn";
import { TW_MASKS } from "./tw";
import { EN_MASKS } from "./en";

import { type BuiltinMask } from "./typing";

const BUILTIN_MASKS: Record<string, BuiltinMask[]> = {
  cn: CN_MASKS,
  tw: TW_MASKS,
  en: EN_MASKS,
};

const dirname = path.dirname(__filename);
const outputPath = dirname + "/../../public/masks.json";
const nextContent = JSON.stringify(BUILTIN_MASKS, null, 4);

try {
  const currentContent = fs.existsSync(outputPath)
    ? fs.readFileSync(outputPath, "utf-8")
    : "";

  if (currentContent !== nextContent) {
    fs.writeFileSync(outputPath, nextContent);
  }
} catch (error) {
  console.error("[Build] failed to build masks", error);
}
