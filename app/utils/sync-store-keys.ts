import { StoreKey } from "../constant";

export const SYNC_STORE_KEYS = [
  StoreKey.Chat,
  StoreKey.Plugin,
  StoreKey.Access,
  StoreKey.Config,
  StoreKey.Mask,
  StoreKey.Prompt,
  StoreKey.Update,
  StoreKey.SdList,
] as const satisfies readonly StoreKey[];
