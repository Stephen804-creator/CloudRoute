import type { ConnectorAccount, ReadOnlyCloudConnector } from "@cloudroute/connector-sdk";
import type { NormalizedCloudResource } from "@cloudroute/shared";

const getDemoMode = () => process.env.CLOUDROUTE_DEMO_MODE === "1";

const demoResources = (accountId: string): NormalizedCloudResource[] => [
  {
    provider: "gcp",
    providerAccountId: accountId,
    providerResourceId: "projects/demo/zones/us-central1-a/instances/api-prod-01",
    resourceType: "compute:instance",
    region: "us-central1-a",
    displayName: "api-prod-01",
    observedAt: new Date().toISOString(),
    rawPayload: {
      type: "compute",
      resourceId: "projects/demo/zones/us-central1-a/instances/api-prod-01",
      zone: "us-central1-a",
    },
    tags: { env: "prod", service: "api" },
    cost: {
      amount: 19.42,
      currency: "USD",
      attribution: "provider-reported",
    },
  },
  {
    provider: "gcp",
    providerAccountId: accountId,
    providerResourceId: "projects/demo/regions/us-central1/buckets/cloudroute-artifacts",
    resourceType: "storage:bucket",
    region: "us-central1",
    displayName: "cloudroute-artifacts",
    observedAt: new Date().toISOString(),
    rawPayload: {
      type: "storage",
      bucket: "cloudroute-artifacts",
      location: "us-central1",
    },
    tags: { env: "prod", purpose: "artifacts" },
    cost: null,
  },
];

export const gcpConnectorStatus = {
  provider: "gcp",
  status: "disconnected",
  message: "GCP connector is ready for read-only project discovery but no live project is configured yet.",
  lastSyncAt: null,
} as const;

export const gcpConnector: ReadOnlyCloudConnector = {
  provider: "gcp",
  async validateConnection(account: ConnectorAccount): Promise<void> {
    if (!account.accountId || account.accountId.trim().length === 0) {
      throw new Error("GCP project ID is required for a read-only validation.");
    }

    if (!getDemoMode()) {
      throw new Error("GCP demo mode is disabled. Set CLOUDROUTE_DEMO_MODE=1 to exercise the connector contract locally.");
    }
  },
  async listResources(account: ConnectorAccount, pageToken?: string): Promise<{ resources: NormalizedCloudResource[]; nextPageToken: string | null }> {
    if (!getDemoMode()) {
      return { resources: [], nextPageToken: null };
    }

    return {
      resources: demoResources(account.accountId),
      nextPageToken: pageToken ? null : "gcp-demo-page",
    };
  },
};

export default gcpConnector;
