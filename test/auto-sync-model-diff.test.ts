import {
  buildProviderDiffSummaries,
  countCloudMergedModels,
  describeModelCountDiff,
  getCloudMergedPlatformCounts,
} from "../app/utils/auto-sync-model-diff";

describe("auto sync model diff", () => {
  test("describeModelCountDiff should explain which side is more", () => {
    expect(describeModelCountDiff(10, 8)).toBe("本地比云端多 2 个");
    expect(describeModelCountDiff(8, 10)).toBe("本地比云端少 2 个");
    expect(describeModelCountDiff(10, 10)).toBe("本地与云端数量一致");
  });

  test("countCloudMergedModels should only count managed providers", () => {
    const count = countCloudMergedModels(
      [
        { provider: { id: "custom_alpha" } },
        { provider: { id: "openai" } },
        { provider: { id: "ignored" } },
      ],
      [
        { name: "Alpha", provider: "Custom" },
        { name: "OpenAI", provider: "OpenAI" },
      ],
    );

    expect(count).toBe(2);
  });

  test("getCloudMergedPlatformCounts should aggregate by profile name", () => {
    expect(
      getCloudMergedPlatformCounts(
        [
          { provider: { id: "custom_alpha" } },
          { provider: { id: "custom_alpha" } },
          { provider: { id: "openai" } },
        ],
        [
          { name: "Alpha", provider: "Custom" },
          { name: "OpenAI", provider: "OpenAI" },
        ],
      ),
    ).toEqual([
      { name: "Alpha", count: 2 },
      { name: "OpenAI", count: 1 },
    ]);
  });

  test("buildProviderDiffSummaries should report local and remote counts", () => {
    expect(
      buildProviderDiffSummaries(
        [
          { name: "Alpha", count: 5 },
          { name: "Beta", count: 1 },
        ],
        [
          { profileName: "Alpha", fetchedCount: 3 },
          { profileName: "Gamma", fetchedCount: 4 },
        ],
      ),
    ).toEqual([
      {
        name: "Gamma",
        localCount: 0,
        remoteCount: 4,
        diff: -4,
        description: "本地比云端少 4 个",
      },
      {
        name: "Alpha",
        localCount: 5,
        remoteCount: 3,
        diff: 2,
        description: "本地比云端多 2 个",
      },
      {
        name: "Beta",
        localCount: 1,
        remoteCount: 0,
        diff: 1,
        description: "本地比云端多 1 个",
      },
    ]);
  });
});
