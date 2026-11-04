import type { ConnectorAccount, ReadOnlyCloudConnector } from "@cloudroute/connector-sdk";
import type { NormalizedCloudResource } from "@cloudroute/shared";

const getDemoMode = () => process.env.CLOUDROUTE_DEMO_MODE === "1";

const demoResources = (accountId: string): NormalizedCloudResource[] => [
  {
    provider: "aws",
    providerAccountId: accountId,
    providerResourceId: "i-0f19ab0fd1c6f4c52",
    resourceType: "ec2:instance",
    region: "us-east-1",
    displayName: "api-prod-01",
    observedAt: new Date().toISOString(),
    rawPayload: {
      type: "ec2",
      id: "i-0f19ab0fd1c6f4c52",
      accountId,
      region: "us-east-1",
    },
    tags: { env: "prod", service: "api" },
    cost: {
      amount: 24.18,
      currency: "USD",
      attribution: "provider-reported",
    },
  },
  {
    provider: "aws",
    providerAccountId: accountId,
    providerResourceId: "arn:aws:s3:::cloudroute-prod-logs",
    resourceType: "s3:bucket",
    region: "us-east-1",
    displayName: "cloudroute-prod-logs",
    observedAt: new Date().toISOString(),
    rawPayload: {
      type: "s3",
      arn: "arn:aws:s3:::cloudroute-prod-logs",
      region: "us-east-1",
    },
    tags: { env: "prod", purpose: "logs" },
    cost: null,
  },
];

export const awsConnectorStatus = {
  provider: "aws",
  status: "disconnected",
  message: "AWS connector is ready for a read-only cross-account role flow but no live account is configured yet.",
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

    return {
      resources: demoResources(account.accountId),
      nextPageToken: pageToken ? null : "aws-demo-page",
    };
  },
};
