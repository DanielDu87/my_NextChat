import fetch from "node-fetch";
import fs from "fs/promises";

const RAW_FILE_URL = "https://raw.githubusercontent.com/";
const MIRRORF_FILE_URL = "http://raw.fgit.ml/";

const RAW_CN_URL = "PlexPt/awesome-chatgpt-prompts-zh/main/prompts-zh.json";
const CN_URL = MIRRORF_FILE_URL + RAW_CN_URL;
const FILE = "./public/prompts.json";

const ignoreWords = ["涩涩", "魅魔", "澀澀"];

const timeoutPromise = (timeout) => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      reject(new Error("Request timeout"));
    }, timeout);
  });
};

async function fetchCN() {
  console.log("[Fetch] fetching cn prompts...");
  try {
    const response = await Promise.race([fetch(CN_URL), timeoutPromise(5000)]);
    const raw = await response.json();
    return raw
      .map((v) => [v.act, v.prompt])
      .filter(
        (v) =>
          v[0] &&
          v[1] &&
          ignoreWords.every((w) => !v[0].includes(w) && !v[1].includes(w)),
      );
  } catch (error) {
    console.error("[Fetch] failed to fetch cn prompts", error);
    return [];
  }
}

async function main() {
  Promise.all([fetchCN()])
    .then(([cn]) => {
      fs.writeFile(FILE, JSON.stringify({ cn }));
    })
    .catch((e) => {
      console.error("[Fetch] failed to fetch prompts");
      fs.writeFile(FILE, JSON.stringify({ cn: [] }));
    })
    .finally(() => {
      console.log("[Fetch] saved to " + FILE);
    });
}

main();
