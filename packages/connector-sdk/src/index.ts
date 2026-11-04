import type {
  CloudProvider,
  ConnectionStatus,
  NormalizedCloudResource,
} from "@cloudroute/shared";

export interface ConnectorAccount {
  accountId: string;
  provider: CloudProvider;
  projectId?: string;
  displayName?: string;
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

export interface ConnectorStatusSnapshot {
  provider: CloudProvider;
  status: ConnectionStatus;
  message: string;
  accountId?: string;
  lastSyncAt?: string | null;
}

export function createConnectorStatus(
  provider: CloudProvider,
  status: ConnectionStatus,
  message: string,
  accountId?: string,
  lastSyncAt?: string | null,
): ConnectorStatusSnapshot {
  return {
    provider,
    status,
    message,
    accountId,
    lastSyncAt,
  };
}

/** MVP connectors deliberately expose inventory reads only. */
