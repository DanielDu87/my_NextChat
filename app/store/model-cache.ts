import { StoreKey } from "../constant";
import { createPersistStore } from "../utils/store";
import { useAccessStore } from "./access";
import type { LLMModel } from "../client/api";

export type ProfileModelCache = {
  profileId: string;
  cachedModels: string;
  models?: LLMModel[];
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
            models: payload.models ?? current?.models,
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
          | "models"
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
            models: payload.models ?? current?.models,
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
      if (typeof window !== "undefined") {
        try {
          localStorage.removeItem(`nextchat-fetched-models-${profileId}`);
        } catch (e) {
          console.error("[ModelCache] Failed to remove localStorage item", e);
        }
      }
    },

    clearProfileCaches() {
      set({ profiles: {} });
      if (typeof window !== "undefined") {
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith("nextchat-fetched-models-")) {
              localStorage.removeItem(key);
              i--;
            }
          }
        } catch (e) {
          console.error("[ModelCache] Failed to clear localStorage items", e);
        }
      }
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
          models: current?.models,
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
    version: 2,
    partialize(state) {
      return {
        ...state,
        profiles: state.profiles,
      };
    },
  },
);
