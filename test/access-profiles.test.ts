import { dedupeAccessProfiles } from "../app/utils/access-profiles";

describe("access profile helpers", () => {
  test("dedupeAccessProfiles preserves newly added draft profiles", () => {
    const profiles = dedupeAccessProfiles([
      {
        id: "profile_123",
        name: "默认新增配置",
        provider: "Custom",
        baseUrl: "xxx-123",
        apiKey: "xxx",
        enabled: false,
      },
    ]);

    expect(profiles).toHaveLength(1);
    expect(profiles[0].id).toBe("profile_123");
  });

  test("dedupeAccessProfiles keeps generated profile identity for canonical base url", () => {
    const profiles = dedupeAccessProfiles([
      {
        id: "profile_456",
        name: "我的 Ocool",
        provider: "Custom",
        baseUrl: "https://one.ooo.cool",
        apiKey: "sk-new",
        enabled: false,
      },
    ]);

    expect(profiles).toHaveLength(1);
    expect(profiles[0].id).toBe("profile_456");
    expect(profiles[0].name).toBe("我的 Ocool");
  });
});
