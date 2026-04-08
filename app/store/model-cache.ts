import { StoreKey } from "../constant";
import { createPersistStore } from "../utils/store";
import { useAccessStore } from "./access";

export type ProfileModelCache = {
  profileId: string;
  cachedModels: string;
  modelCount: number;
  updatedAt: number;
  source?: "builtin" | "cache" | "remote" | "derived";
  syncStatus?:
    | "idle"
    | "using_cache"
    | "checking_remote"
    | "first_sync"
    | "syncing"
    | "ready"
    | "error";
  hydrated?: boolean;
  hasRemoteChecked?: boolean;
  lastSyncAt?: number;
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
            source: payload.source ?? current?.source,
            syncStatus: payload.syncStatus ?? current?.syncStatus,
            hydrated: payload.hydrated ?? current?.hydrated,
            hasRemoteChecked:
              payload.hasRemoteChecked ?? current?.hasRemoteChecked,
            lastSyncAt: payload.lastSyncAt ?? current?.lastSyncAt,
            lastError: payload.lastError ?? current?.lastError,
          },
        },
      });
    },

    setProfileSyncState(
      profileId: string,
      payload: Partial<
        Pick<
          ProfileModelCache,
          | "source"
          | "syncStatus"
          | "hydrated"
          | "hasRemoteChecked"
          | "lastSyncAt"
          | "lastError"
          | "cachedModels"
          | "modelCount"
        >
      >,
    ) {
      const current = get().profiles[profileId];
      set({
        profiles: {
          ...get().profiles,
          [profileId]: {
            profileId,
            cachedModels: payload.cachedModels ?? current?.cachedModels ?? "",
            modelCount: payload.modelCount ?? current?.modelCount ?? 0,
            updatedAt: Date.now(),
            source: payload.source ?? current?.source,
            syncStatus: payload.syncStatus ?? current?.syncStatus,
            hydrated: payload.hydrated ?? current?.hydrated,
            hasRemoteChecked:
              payload.hasRemoteChecked ?? current?.hasRemoteChecked,
            lastSyncAt: payload.lastSyncAt ?? current?.lastSyncAt,
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
          source: current?.source,
          syncStatus: current?.syncStatus,
          hydrated: current?.hydrated,
          hasRemoteChecked: current?.hasRemoteChecked,
          lastSyncAt: current?.lastSyncAt,
          lastError: current?.lastError,
        };
        migrated = true;
      });

      const currentState = get();
      const profilesChanged =
        JSON.stringify(currentState.profiles) !== JSON.stringify(nextProfiles);
      const nextMigratedFromLegacyAccess =
        currentState.migratedFromLegacyAccess || migrated;

      if (
        !profilesChanged &&
        currentState.migratedFromLegacyAccess === nextMigratedFromLegacyAccess
      ) {
        return;
      }

      set({
        profiles: nextProfiles,
        migratedFromLegacyAccess: nextMigratedFromLegacyAccess,
      });
    },
  }),
  {
    name: StoreKey.ModelCache,
    version: 1,
  },
);
