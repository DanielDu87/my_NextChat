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
  apiKey: string;
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
    apiKey: "2c0cdc549650459fb39263f9082e90a1",
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
  // {
  //   profileName: "ToAPIs",
  //   mode: "toapis",
  //   url: "https://api.toapis.com",
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
