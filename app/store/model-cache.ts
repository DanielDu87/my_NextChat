import { StoreKey } from "../constant";
import { createPersistStore } from "../utils/store";
import { useAccessStore } from "./access";

export type ProfileModelCache = {
  profileId: string;
  cachedModels: string;
  modelCount: number;
  updatedAt: number;
  lastError?: string;
};

const DEFAULT_MODEL_CACHE_STATE = {
  profiles: {} as Record<string, ProfileModelCache>,
  migratedFromLegacyAccess: false,
};

export const useModelCacheStore = createPersistStore(
  DEFAULT_MODEL_CACHE_STATE,
  (set, get) => ({
    upsertProfileCache(
      profileId: string,
      payload: Omit<ProfileModelCache, "profileId" | "updatedAt"> & {
        updatedAt?: number;
      },
    ) {
      const current = get().profiles[profileId];
      set({
        profiles: {
          ...get().profiles,
          [profileId]: {
            profileId,
            cachedModels: payload.cachedModels,
            modelCount: payload.modelCount,
            updatedAt: payload.updatedAt ?? Date.now(),
            lastError: payload.lastError ?? current?.lastError,
          },
        },
      });
    },

    removeProfileCache(profileId: string) {
      const nextProfiles = { ...get().profiles };
      delete nextProfiles[profileId];
      set({ profiles: nextProfiles });
    },

    clearProfileCaches() {
      set({ profiles: {} });
    },

    migrateFromAccessProfiles() {
      const accessStore = useAccessStore.getState();
      const legacyProfiles = accessStore.apiProfiles || [];
      const nextProfiles = { ...get().profiles };
      let migrated = false;

      legacyProfiles.forEach((profile) => {
        if (!profile.cachedModels && !profile.modelCount) {
          return;
        }

        const current = nextProfiles[profile.id];
        nextProfiles[profile.id] = {
          profileId: profile.id,
          cachedModels: profile.cachedModels || "",
          modelCount: profile.modelCount || 0,
          updatedAt: current?.updatedAt ?? Date.now(),
          lastError: current?.lastError,
        };
        migrated = true;
      });

      set({
        profiles: nextProfiles,
        migratedFromLegacyAccess: get().migratedFromLegacyAccess || migrated,
      });
    },
  }),
  {
    name: StoreKey.ModelCache,
    version: 1,
  },
);
