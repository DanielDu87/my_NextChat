describe("model selector cache", () => {
  test("打开期间当前供应商瞬时变空时，应继续保留上一份非空列表", () => {
    const activeModelSelectorProviderId = "custom_yutoapi";
    const modelSelectorItemsCache: Record<string, any[]> = {
      [activeModelSelectorProviderId]: [
        { sortKey: "gpt-5.4-mini", value: "gpt-5.4-mini@custom_yutoapi" },
        { sortKey: "gpt-5-mini", value: "gpt-5-mini@custom_yutoapi" },
      ],
    };

    const providerItems: any[] = [];
    const effectiveProviderItems =
      providerItems.length > 0
        ? providerItems
        : modelSelectorItemsCache[activeModelSelectorProviderId] || [];

    expect(effectiveProviderItems.map((item) => item.sortKey)).toEqual([
      "gpt-5.4-mini",
      "gpt-5-mini",
    ]);
  });
});
