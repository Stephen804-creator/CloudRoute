import { GoogleAuth, Impersonated } from "google-auth-library";
import type { CloudProvider, NormalizedCloudResource } from "@cloudroute/shared";
import type { ConnectorAccount, InventoryPage, ReadOnlyCloudConnector } from "@cloudroute/connector-sdk";

const CLOUD_PLATFORM_READ_SCOPE = "https://www.googleapis.com/auth/cloud-platform.read-only";
const ASSET_TYPES = [
  "compute.googleapis.com/Instance",
  "compute.googleapis.com/Disk",
  "storage.googleapis.com/Bucket",
  "sqladmin.googleapis.com/Instance",
  "cloudfunctions.googleapis.com/CloudFunction",
  "cloudfunctions.googleapis.com/Function",
  "compute.googleapis.com/ForwardingRule",
  "compute.googleapis.com/Address",
  "compute.googleapis.com/Snapshot",
] as const;

interface CloudAsset {
  name?: string;
  assetType?: string;
  updateTime?: string;
  resource?: { parent?: string; location?: string; data?: Record<string, unknown> };
}
interface AssetListResponse { assets?: CloudAsset[]; nextPageToken?: string }

type ResourceDataFieldMap = Record<string, readonly string[]>;

/**
 * Cloud Asset Inventory can return customer-controlled and workload-adjacent data.
 * Persist only the small set of scalar fields needed to identify and summarize
 * supported infrastructure. Never persist arbitrary provider resource payloads.
 */
const RESOURCE_DATA_FIELDS: ResourceDataFieldMap = {
  "compute.googleapis.com/Instance": [
    "name", "status", "zone", "machineType", "creationTimestamp", "labels",
  ],
  "compute.googleapis.com/Disk": [
    "name", "status", "zone", "region", "sizeGb", "type", "creationTimestamp", "labels",
  ],
  "storage.googleapis.com/Bucket": [
    "name", "location", "storageClass", "timeCreated", "labels",
  ],
  "sqladmin.googleapis.com/Instance": [
    "name", "region", "databaseVersion", "state", "gceZone", "labels",
  ],
  "cloudfunctions.googleapis.com/CloudFunction": [
    "name", "status", "runtime", "availableMemoryMb", "timeout", "entryPoint", "updateTime", "labels",
  ],
  "cloudfunctions.googleapis.com/Function": [
    "name", "state", "runtime", "availableMemory", "timeout", "entryPoint", "updateTime", "labels",
  ],
  "compute.googleapis.com/ForwardingRule": [
    "name", "region", "IPProtocol", "loadBalancingScheme", "portRange", "labels",
  ],
  "compute.googleapis.com/Address": [
    "name", "status", "addressType", "ipVersion", "region", "labels",
  ],
  "compute.googleapis.com/Snapshot": [
    "name", "status", "diskSizeGb", "sourceDisk", "storageBytes", "creationTimestamp", "labels",
  ],
};

export async function getImpersonatedAccessToken(serviceAccountEmail: string, targetScope = CLOUD_PLATFORM_READ_SCOPE): Promise<string> {
  if (!/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(serviceAccountEmail)) throw new Error("INVALID_GCP_SERVICE_ACCOUNT");
  const sourceAuth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const sourceClient = await sourceAuth.getClient();
  const impersonated = new Impersonated({
    sourceClient,
    targetPrincipal: serviceAccountEmail,
    targetScopes: [targetScope],
    lifetime: 900,
  });
  const tokenResponse = await impersonated.getAccessToken();
  const token = tokenResponse.token;
  if (typeof token !== "string" || token.length === 0) throw new Error("GCP_ACCESS_TOKEN_UNAVAILABLE");
  return token;
}

export interface GcpConnectorDependencies {
  getAccessToken?: () => Promise<string>;
  fetch?: typeof fetch;
  now?: () => Date;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function mapResourceType(assetType: string | undefined): string {
  switch (assetType) {
    case "compute.googleapis.com/Instance": return "compute_instance";
    case "compute.googleapis.com/Disk": return "block_volume";
    case "storage.googleapis.com/Bucket": return "object_bucket";
    case "sqladmin.googleapis.com/Instance": return "database";
    case "cloudfunctions.googleapis.com/CloudFunction":
    case "cloudfunctions.googleapis.com/Function": return "function";
    case "compute.googleapis.com/ForwardingRule": return "load_balancer";
    case "compute.googleapis.com/Address": return "static_ip";
    case "compute.googleapis.com/Snapshot": return "snapshot";
    default: return "other";
  }
}

function mapStatus(data: Record<string, unknown>): string | null {
  return stringValue(data.status) ?? stringValue(data.state) ?? stringValue(data.stateName);
}

function mapLocation(asset: CloudAsset, data: Record<string, unknown>): string | null {
  const direct = stringValue(data.region) ?? stringValue(data.zone) ?? stringValue(data.location);
  if (direct) return direct.split("/").at(-1) ?? direct;
  return stringValue(asset.resource?.location);
}

const SENSITIVE_LABEL_VALUE = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bASIA[0-9A-Z]{16}\b|\bBearer\s+\S+|\b(password|token|secret|api[_-]?key)\s*[:=]\s*\S+)/i;

function mapLabels(data: Record<string, unknown>): Record<string, string> {
  const labels = record(data.labels);
  return Object.fromEntries(
    Object.entries(labels)
      .filter((entry): entry is [string, string] =>
        typeof entry[1] === "string" &&
        entry[0].length <= 63 &&
        entry[1].length <= 63 &&
        !/(secret|password|token|credential|key)/i.test(entry[0]) &&
        !SENSITIVE_LABEL_VALUE.test(entry[1]),
      )
      .slice(0, 64),
  );
}

/**
 * Project a provider resource onto an explicit per-type scalar allowlist.
 * Nested objects, arrays, arbitrary metadata and unknown asset types are dropped.
 */
function projectResourceData(assetType: string | undefined, source: Record<string, unknown>): Record<string, unknown> {
  const allowedFields = RESOURCE_DATA_FIELDS[assetType ?? ""];
  if (!allowedFields) return {};

  const projected: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (field === "labels") continue;
    const value = source[field];
    if (
      typeof value === "string" ||
      typeof value === "number" && Number.isFinite(value) ||
      typeof value === "boolean"
    ) {
      projected[field] = value;
    }
  }

  const labels = mapLabels(source);
  if (Object.keys(labels).length > 0) projected.labels = labels;
  return projected;
}

export function normalizeGcpAsset(asset: CloudAsset, projectId: string, observedAt: string = new Date().toISOString()): NormalizedCloudResource | null {
  const name = stringValue(asset.name);
  if (!name) return null;

  const sourceData = record(asset.resource?.data);
  const data = projectResourceData(asset.assetType, sourceData);
  return {
    provider: "gcp",
    providerAccountId: projectId,
    providerResourceId: name,
    resourceType: mapResourceType(asset.assetType),
    region: mapLocation(asset, data),
    displayName: stringValue(data.name) ?? name.split("/").at(-1) ?? name,
    observedAt,
    rawPayload: {
      assetType: asset.assetType ?? null,
      updateTime: asset.updateTime ?? null,
      parent: asset.resource?.parent ?? null,
      status: mapStatus(data),
      labels: mapLabels(sourceData),
      data,
    },
  };
}

export class GcpInventoryConnector implements ReadOnlyCloudConnector {
  readonly provider: CloudProvider = "gcp";
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly serviceAccountEmail: string, private readonly dependencies: GcpConnectorDependencies = {}) {
    if (!/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(serviceAccountEmail)) throw new Error("INVALID_GCP_SERVICE_ACCOUNT");
    this.fetchImpl = dependencies.fetch ?? fetch;
    this.now = dependencies.now ?? (() => new Date());
  }

  private async accessToken(): Promise<string> {
    if (this.dependencies.getAccessToken) {
      const token = await this.dependencies.getAccessToken();
      if (!token) throw new Error("GCP_ACCESS_TOKEN_UNAVAILABLE");
      return token;
    }
    const sourceAuth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
    const sourceClient = await sourceAuth.getClient();
    const impersonated = new Impersonated({
      sourceClient,
      targetPrincipal: this.serviceAccountEmail,
      targetScopes: [CLOUD_PLATFORM_READ_SCOPE],
      lifetime: 900,
    });
    const tokenResponse = await impersonated.getAccessToken();
    const token = tokenResponse.token;
    if (typeof token !== "string" || token.length === 0) throw new Error("GCP_ACCESS_TOKEN_UNAVAILABLE");
    return token;
  }

  private async listAssetPage(projectId: string, pageToken?: string): Promise<AssetListResponse> {
    const token = await this.accessToken();
    const url = new URL("https://cloudasset.googleapis.com/v1/projects/" + encodeURIComponent(projectId) + ":listAssets");
    url.searchParams.set("contentType", "RESOURCE");
    url.searchParams.set("pageSize", "1000");
    for (const assetType of ASSET_TYPES) url.searchParams.append("assetTypes", assetType);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: { authorization: "Bearer " + token, accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error("GCP_INSUFFICIENT_PERMISSIONS");
      if (response.status === 404) throw new Error("GCP_PROJECT_OR_API_NOT_FOUND");
      if (response.status === 429 || response.status >= 500) throw new Error("GCP_PROVIDER_TEMPORARILY_UNAVAILABLE");
      throw new Error("GCP_ASSET_INVENTORY_REQUEST_FAILED");
    }
    return await response.json() as AssetListResponse;
  }

  async validateConnection(account: ConnectorAccount): Promise<void> {
    if (account.provider !== "gcp") throw new Error("PROVIDER_MISMATCH");
    if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(account.accountId)) throw new Error("INVALID_GCP_PROJECT_ID");
    await this.listAssetPage(account.accountId);
  }

  async listResources(account: ConnectorAccount, pageToken?: string): Promise<InventoryPage> {
    if (account.provider !== "gcp") throw new Error("PROVIDER_MISMATCH");
    if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(account.accountId)) throw new Error("INVALID_GCP_PROJECT_ID");
    const response = await this.listAssetPage(account.accountId, pageToken);
    const observedAt = this.now().toISOString();
    return {
      resources: (response.assets ?? []).map((asset) => normalizeGcpAsset(asset, account.accountId, observedAt))
        .filter((resource): resource is NormalizedCloudResource => resource !== null),
      nextPageToken: response.nextPageToken ?? null,
    };
  }
}

export { ASSET_TYPES as GCP_INVENTORY_ASSET_TYPES };
