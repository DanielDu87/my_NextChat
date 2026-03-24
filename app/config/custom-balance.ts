export type CustomBalanceQueryMode =
  | "json"
  | "aihubmix"
  | "ocoolai"
  | "toapis"
  | "openai-compatible";

export type CustomBalanceQueryRule = {
  profileName: string;
  mode: CustomBalanceQueryMode;
  url: string;
  apiKey?: string;
  field?: string;
  aliases?: string[];
};

// 在这里为每个 Custom 配置条目单独指定余额查询方式。
// profileName 必须与 API 配置页中的“名称”完全一致。
export const CUSTOM_BALANCE_QUERY_RULES: CustomBalanceQueryRule[] = [
  {
    profileName: "AihubMix",
    aliases: ["aihubmix", "aihubmix.com"],
    mode: "aihubmix",
    url: "https://aihubmix.com",
    apiKey: "cd2d40b608024227b5af7ba655a5a7b4",
  },
  {
    profileName: "YutoAPI",
    aliases: ["yutoapi", "gptapi.asia", "cn.gptapi.asia"],
    mode: "openai-compatible",
    url: "https://cn.gptapi.asia",
    apiKey: "sk-korED7kHNSVz1KYY3c3b9aE599Bc41A29674C419B71d217a",
  },
  {
    profileName: "Ocoolai",
    aliases: ["ocoolai", "one.ooo.cool"],
    mode: "ocoolai",
    url: "https://one.ooo.cool",
    apiKey: "1e64d2329f18493784eba5b2390bcf0b",
  },
  {
    profileName: "ToAPIs",
    aliases: ["toapis", "toapis.com"],
    mode: "toapis",
    url: "https://toapis.com",
    apiKey: "sk-Pn3Pqt9iCIRYBPMilukEJ6wKx3F6TKNAquIOP1ockZgZrSBx",
  },
  // {
  //   profileName: "My Proxy",
  //   mode: "json",
  //   url: "https://your-proxy.example.com/api/user/balance",
  //   apiKey: "balance-query-api-key",
  //   field: "data.balance",
  // },
  // {
  //   profileName: "OpenAI Proxy",
  //   mode: "openai-compatible",
  //   url: "https://your-openai-proxy.example.com",
  //   apiKey: "balance-query-api-key",
  // },
];

export function findCustomBalanceQueryRule(profile: { name: string }) {
  const normalizedName = String(profile.name || "")
    .trim()
    .toLowerCase();

  return CUSTOM_BALANCE_QUERY_RULES.find(
    (rule) =>
      rule.profileName.trim().toLowerCase() === normalizedName ||
      rule.aliases?.some((alias) =>
        normalizedName.includes(alias.toLowerCase()),
      ),
  );
}
