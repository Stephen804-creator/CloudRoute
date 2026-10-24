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
function mapLabels(data: Record<string, unknown>): Record<string, string> {
  const labels = record(data.labels);
  return Object.fromEntries(Object.entries(labels).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}
export function normalizeGcpAsset(asset: CloudAsset, projectId: string, observedAt: string = new Date().toISOString()): NormalizedCloudResource | null {
  const name = stringValue(asset.name);
  if (!name) return null;
  const data = record(asset.resource?.data);
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
      labels: mapLabels(data),
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
    const sourceAuth = new GoogleAuth({ scopes: [CLOUD_PLATFORM_READ_SCOPE] });
    const sourceClient = await sourceAuth.getClient();
    const impersonated = new Impersonated({
      sourceClient,
      targetPrincipal: this.serviceAccountEmail,
      targetScopes: [CLOUD_PLATFORM_READ_SCOPE],
      lifetime: 900,
    });
    const token = await impersonated.getAccessToken();
    if (!token) throw new Error("GCP_ACCESS_TOKEN_UNAVAILABLE");
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
