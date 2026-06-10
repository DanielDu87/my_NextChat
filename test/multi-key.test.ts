import {
  MULTI_KEY_GROUP_IDS,
  normalizeMultiKeyGroupOrder,
  normalizeMultiKeyGroups,
  shouldAutoEnableMultiKey,
} from "../app/utils/multi-key";

describe("multi-key helpers", () => {
  test("normalizeMultiKeyGroups preserves generic group1-group6 keys", () => {
    expect(
      normalizeMultiKeyGroups({
        group1: "a",
        group3: "c",
      }),
    ).toEqual({
      group1: "a",
      group2: "",
      group3: "c",
      group4: "",
      group5: "",
      group6: "",
    });
  });

  test("normalizeMultiKeyGroups migrates legacy Yuto groups to generic order", () => {
    expect(
      normalizeMultiKeyGroups(
        {
          enterprise: "e",
          discount: "d",
          user: "u",
          anthropic: "a",
          default: "x",
        },
        { name: "YutoAPI", baseUrl: "https://cn.gptapi.asia" },
      ),
    ).toEqual({
      group1: "e",
      group2: "d",
      group3: "u",
      group4: "a",
      group5: "x",
      group6: "",
    });
  });

  test("normalizeMultiKeyGroups migrates legacy Ocoolai groups to generic order", () => {
    expect(
      normalizeMultiKeyGroups(
        {
          default: "all",
          official: "off",
          open_source_cn: "open",
          cn: "cn",
          cc: "cc",
        },
        { name: "Ocoolai", baseUrl: "https://one.ooo.cool" },
      ),
    ).toEqual({
      group1: "all",
      group2: "off",
      group3: "open",
      group4: "cn",
      group5: "cc",
      group6: "",
    });
  });

  test("shouldAutoEnableMultiKey only auto-enables legacy Yuto/Ocoolai profiles", () => {
    expect(MULTI_KEY_GROUP_IDS).toHaveLength(6);
    expect(
      shouldAutoEnableMultiKey({
        name: "YutoAPI",
        baseUrl: "https://cn.gptapi.asia",
        apiKeyGroups: { default: "sk" },
      }),
    ).toBe(true);
    expect(
      shouldAutoEnableMultiKey({
        name: "AihubMix",
        baseUrl: "https://aihubmix.com",
        apiKeyGroups: { default: "sk" },
      }),
    ).toBe(false);
  });

  test("normalizeMultiKeyGroupOrder keeps empty groups at the end", () => {
    expect(
      normalizeMultiKeyGroupOrder(
        ["group3", "group1", "group2", "group6"],
        {
          group1: "a",
          group2: "",
          group3: "c",
          group4: "",
          group5: "e",
          group6: "",
        },
      ),
    ).toEqual(["group3", "group1", "group5", "group2", "group6", "group4"]);
  });
});
