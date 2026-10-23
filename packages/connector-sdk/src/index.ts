import type { CloudProvider, NormalizedCloudResource } from "@cloudroute/shared";

export interface ConnectorAccount {
  accountId: string;
  provider: CloudProvider;
}

export interface InventoryPage {
  resources: NormalizedCloudResource[];
  nextPageToken: string | null;
}

export interface ReadOnlyCloudConnector {
  readonly provider: CloudProvider;
  validateConnection(account: ConnectorAccount): Promise<void>;
  listResources(account: ConnectorAccount, pageToken?: string): Promise<InventoryPage>;
}

/** MVP connectors deliberately expose inventory reads only. */
