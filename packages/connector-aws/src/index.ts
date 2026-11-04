import type { ConnectorAccount, ReadOnlyCloudConnector } from "@cloudroute/connector-sdk";
import type { NormalizedCloudResource } from "@cloudroute/shared";

const makeResource = (
  provider: "aws" | "gcp",
  accountId: string,
  resourceId: string,
  resourceType: string,
  region: string | null,
  displayName: string,
  tags: Record<string, string>,
  cost?: { amount: number; currency: string; attribution: "provider-reported" | "estimate" | "unknown" },
): NormalizedCloudResource => ({
  provider,
  providerAccountId: accountId,
  providerResourceId: resourceId,
  resourceType,
  region,
  displayName,
  observedAt: new Date().toISOString(),
  rawPayload: {
    provider,
    accountId,
    resourceType,
    region,
    displayName,
    tags,
  },
  tags,
  cost: cost ?? null,
});

const demoResources = (provider: "aws" | "gcp", accountId: string): NormalizedCloudResource[] => {
  if (provider === "aws") {
    return [
      makeResource(
        "aws",
        accountId,
        "i-0f19ab0fd1c6f4c52",
        "ec2:instance",
        "us-east-1",
        "api-prod-01",
        { env: "prod", service: "api" },
        { amount: 24.18, currency: "USD", attribution: "provider-reported" },
      ),
      makeResource(
        "aws",
        accountId,
        "arn:aws:s3:::cloudroute-prod-logs",
        "s3:bucket",
        "us-east-1",
        "cloudroute-prod-logs",
        { env: "prod", purpose: "logs" },
      ),
    ];
  }

  return [
    makeResource(
      "gcp",
      accountId,
      "projects/demo/zones/us-central1-a/instances/api-prod-01",
      "compute:instance",
      "us-central1-a",
      "api-prod-01",
      { env: "prod", service: "api" },
      { amount: 19.42, currency: "USD", attribution: "provider-reported" },
    ),
    makeResource(
      "gcp",
      accountId,
      "projects/demo/regions/us-central1/buckets/cloudroute-artifacts",
      "storage:bucket",
      "us-central1",
      "cloudroute-artifacts",
      { env: "prod", purpose: "artifacts" },
    ),
  ];
};

const getDemoMode = () => process.env.CLOUDROUTE_DEMO_MODE === "1";

export const awsConnectorStatus = {
  provider: "aws",
  status: "disconnected",
  message: "AWS connector is ready for a read-only, cross-account role flow but no live account is configured yet.",
  lastSyncAt: null,
} as const;

export const awsConnector: ReadOnlyCloudConnector = {
  provider: "aws",
  async validateConnection(account: ConnectorAccount): Promise<void> {
    if (!account.accountId || account.accountId.trim().length === 0) {
      throw new Error("AWS accountId is required for a read-only validation.");
    }

    if (!getDemoMode()) {
      throw new Error("AWS demo mode is disabled. Set CLOUDROUTE_DEMO_MODE=1 to exercise the connector contract locally.");
    }
  },
  async listResources(account: ConnectorAccount, pageToken?: string): Promise<{ resources: NormalizedCloudResource[]; nextPageToken: string | null }> {
    if (!getDemoMode()) {
      return { resources: [], nextPageToken: null };
    }

    const resources = demoResources("aws", account.accountId);
    return {
      resources,
      nextPageToken: pageToken ? null : "aws-demo-page",
    };
  },
};

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

    const resources = demoResources("gcp", account.accountId);
    return {
      resources,
      nextPageToken: pageToken ? null : "gcp-demo-page",
    };
  },
};
