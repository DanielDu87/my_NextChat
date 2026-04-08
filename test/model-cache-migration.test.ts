import { useAccessStore } from "../app/store/access";
import { useModelCacheStore } from "../app/store/model-cache";

describe("model cache migration", () => {
  beforeEach(() => {
    useAccessStore.setState((state) => ({
      ...state,
      apiProfiles: [],
    }));
    useModelCacheStore.setState({
      profiles: {},
      migratedFromLegacyAccess: false,
    });
  });

  test("migrateFromAccessProfiles should preserve sync metadata", () => {
    useAccessStore.setState((state) => ({
      ...state,
      apiProfiles: [
        {
          id: "profile-1",
          name: "AihubMix",
          provider: "Custom",
          cachedModels: "gpt-5.4",
          modelCount: 1,
        } as any,
      ],
    }));

    useModelCacheStore.setState({
      profiles: {
        "profile-1": {
          profileId: "profile-1",
          cachedModels: "old-model",
          modelCount: 1,
          updatedAt: 100,
          source: "remote",
          syncStatus: "ready",
          hydrated: true,
          hasRemoteChecked: true,
          lastSyncAt: 123456,
          lastError: "old error",
        },
      },
      migratedFromLegacyAccess: false,
    });

    useModelCacheStore.getState().migrateFromAccessProfiles();

    expect(useModelCacheStore.getState().profiles["profile-1"]).toEqual(
      expect.objectContaining({
        profileId: "profile-1",
        cachedModels: "gpt-5.4",
        modelCount: 1,
        updatedAt: 100,
        source: "remote",
        syncStatus: "ready",
        hydrated: true,
        hasRemoteChecked: true,
        lastSyncAt: 123456,
        lastError: "old error",
      }),
    );
  });
});
