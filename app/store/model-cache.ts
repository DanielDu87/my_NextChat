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
      if (get().migratedFromLegacyAccess) {
        return;
      }

      const accessStore = useAccessStore.getState();
      const legacyProfiles = accessStore.apiProfiles || [];
      const nextProfiles = { ...get().profiles };
      let migrated = false;

      legacyProfiles.forEach((profile) => {
        if (!profile.cachedModels && !profile.modelCount) {
          return;
        }

        if (!nextProfiles[profile.id]) {
          nextProfiles[profile.id] = {
            profileId: profile.id,
            cachedModels: profile.cachedModels || "",
            modelCount: profile.modelCount || 0,
            updatedAt: Date.now(),
          };
        }
        migrated = true;
      });

      if (migrated) {
        accessStore.update((state) => {
          state.apiProfiles = state.apiProfiles.map((profile) => ({
            ...profile,
            cachedModels: undefined,
            modelCount: undefined,
          }));
        });
      }

      set({
        profiles: nextProfiles,
        migratedFromLegacyAccess: true,
      });
    },
  }),
  {
    name: StoreKey.ModelCache,
    version: 1,
  },
);
