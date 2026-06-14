export type Updater<T> = (updater: (value: T) => void) => void;

export const ROLES = ["system", "user", "assistant"] as const;
export type MessageRole = (typeof ROLES)[number];

export interface RequestMessage {
  role: MessageRole;
  content: string;
}

export type DalleSize =
  | "1024x1024"
  | "1792x1024"
  | "1024x1792"
  | "1024x1536"
  | "1536x1024"
  | "768x1024"
  | "1024x768"
  | "512x1024"
  | "768x512"
  | "1024x576"
  | "576x1024"
  | "2048x2048"
  | "1280x1280"
  | "1K"
  | "2K"
  | "4K";
export type DalleQuality =
  | "standard"
  | "hd"
  | "auto"
  | "low"
  | "medium"
  | "high";
export type DalleStyle = "vivid" | "natural";

export type ModelSize =
  | "1024x1024"
  | "1792x1024"
  | "1024x1792"
  | "1024x1536"
  | "1536x1024"
  | "768x1024"
  | "1024x768"
  | "512x1024"
  | "768x512"
  | "768x1344"
  | "864x1152"
  | "1344x768"
  | "1152x864"
  | "1440x720"
  | "720x1440"
  | "512x512"
  | "768x768"
  | "1536x1536"
  | "2048x2048"
  | "1280x1280"
  | "1568x1056"
  | "1056x1568"
  | "1472x1088"
  | "1088x1472"
  | "1728x960"
  | "960x1728"
  | "1280x1440"
  | "1440x1280"
  | "1024x576"
  | "576x1024"
  | "1664x928"
  | "1472x1104"
  | "1328x1328"
  | "1104x1472"
  | "928x1664"
  | "1280x720"
  | "720x1280"
  | "1K"
  | "2K"
  | "4K";
