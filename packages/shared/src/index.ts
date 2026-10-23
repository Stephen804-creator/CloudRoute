export type CloudProvider = "aws" | "gcp";

export type ConnectionStatus =
  | "pending"
  | "connected"
  | "degraded"
  | "disconnected"
  | "error";

export interface DataFreshness {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  status: ConnectionStatus;
}

export interface NormalizedCloudResource {
  provider: CloudProvider;
  providerAccountId: string;
  providerResourceId: string;
  resourceType: string;
  region: string | null;
  displayName: string | null;
  observedAt: string;
  rawPayload: Record<string, unknown>;
}
