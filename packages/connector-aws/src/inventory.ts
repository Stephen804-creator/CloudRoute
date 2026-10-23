import { EC2Client, DescribeRegionsCommand, DescribeInstancesCommand, DescribeVolumesCommand, DescribeAddressesCommand, DescribeSnapshotsCommand } from "@aws-sdk/client-ec2";
import { S3Client, ListBucketsCommand } from "@aws-sdk/client-s3";
import { RDSClient, DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { LambdaClient, ListFunctionsCommand } from "@aws-sdk/client-lambda";
import { ElasticLoadBalancingV2Client, DescribeLoadBalancersCommand } from "@aws-sdk/client-elastic-load-balancing-v2";
import type { AwsCredentialIdentity } from "@aws-sdk/types";

export interface AwsInventoryItem {
  externalId: string; resourceType: string; displayName: string | null; region: string | null;
  resourceStatus: string | null; tags: Record<string, string>; metadata: Record<string, unknown>;
}
export interface AwsInventoryResult { resources: AwsInventoryItem[]; complete: boolean; warnings: string[] }

function tagsToRecord(tags: Array<{ Key?: string; Value?: string }> | undefined): Record<string, string> {
  return Object.fromEntries((tags ?? []).filter((tag) => tag.Key).map((tag) => [tag.Key!, tag.Value ?? ""]));
}
function arn(accountId: string, region: string, service: string, resource: string): string {
  return "arn:aws:" + service + ":" + region + ":" + accountId + ":" + resource;
}

export async function fetchAwsInventory(credentials: AwsCredentialIdentity, accountId: string): Promise<AwsInventoryResult> {
  const warnings: string[] = [];
  const resources: AwsInventoryItem[] = [];
  const discovery = new EC2Client({ region: "us-east-1", credentials });
  let regions: string[] = [];
  try {
    const result = await discovery.send(new DescribeRegionsCommand({ AllRegions: false }));
    regions = (result.Regions ?? []).map((item) => item.RegionName).filter((value): value is string => Boolean(value));
  } catch { return { resources, complete: false, warnings: ["REGION_DISCOVERY_FAILED"] }; }
  finally { discovery.destroy(); }
  if (!regions.length) return { resources, complete: false, warnings: ["NO_ENABLED_REGIONS"] };

  const s3 = new S3Client({ region: "us-east-1", credentials });
  try {
    let token: string | undefined;
    do {
      const result = await s3.send(new ListBucketsCommand({ ContinuationToken: token, MaxBuckets: 1000 }));
      for (const bucket of result.Buckets ?? []) if (bucket.Name) resources.push({
        externalId: "arn:aws:s3:::" + bucket.Name, resourceType: "object_bucket", displayName: bucket.Name,
        region: null, resourceStatus: "available", tags: {},
        metadata: { creationDate: bucket.CreationDate?.toISOString() ?? null, scope: "bucket-metadata-only" },
      });
      token = result.ContinuationToken;
    } while (token);
  } catch { warnings.push("S3_BUCKET_LIST_FAILED"); } finally { s3.destroy(); }

  for (const region of regions) {
    const ec2 = new EC2Client({ region, credentials });
    try {
      let token: string | undefined;
      do {
        const result = await ec2.send(new DescribeInstancesCommand({ NextToken: token, MaxResults: 1000 }));
        for (const reservation of result.Reservations ?? []) for (const instance of reservation.Instances ?? []) if (instance.InstanceId) resources.push({
          externalId: arn(accountId, region, "ec2", "instance/" + instance.InstanceId),
          resourceType: "compute_instance", displayName: instance.Tags?.find((tag) => tag.Key === "Name")?.Value ?? instance.InstanceId,
          region, resourceStatus: instance.State?.Name ?? null, tags: tagsToRecord(instance.Tags),
          metadata: { instanceType: instance.InstanceType ?? null, launchTime: instance.LaunchTime?.toISOString() ?? null, platform: instance.PlatformDetails ?? instance.Platform ?? null, availabilityZone: instance.Placement?.AvailabilityZone ?? null, vpcId: instance.VpcId ?? null, subnetId: instance.SubnetId ?? null },
        });
        token = result.NextToken;
      } while (token);
    } catch { warnings.push("EC2_INSTANCES_FAILED:" + region); }
    try {
      let token: string | undefined;
      do {
        const result = await ec2.send(new DescribeVolumesCommand({ NextToken: token, MaxResults: 500 }));
        for (const volume of result.Volumes ?? []) if (volume.VolumeId) resources.push({
          externalId: arn(accountId, region, "ec2", "volume/" + volume.VolumeId), resourceType: "block_volume",
          displayName: volume.Tags?.find((tag) => tag.Key === "Name")?.Value ?? volume.VolumeId, region,
          resourceStatus: volume.State ?? null, tags: tagsToRecord(volume.Tags),
          metadata: { sizeGiB: volume.Size ?? null, volumeType: volume.VolumeType ?? null, encrypted: volume.Encrypted ?? null, attached: Boolean(volume.Attachments?.length) },
        });
        token = result.NextToken;
      } while (token);
    } catch { warnings.push("EC2_VOLUMES_FAILED:" + region); }
    try {
      const result = await ec2.send(new DescribeAddressesCommand({}));
      for (const address of result.Addresses ?? []) if (address.AllocationId || address.PublicIp) resources.push({
        externalId: address.AllocationId ? arn(accountId, region, "ec2", "elastic-ip/" + address.AllocationId) : "aws:ec2:" + region + ":public-ip:" + address.PublicIp,
        resourceType: "static_ip", displayName: address.PublicIp ?? address.AllocationId ?? null, region,
        resourceStatus: address.AssociationId ? "associated" : "unassociated", tags: tagsToRecord(address.Tags),
        metadata: { allocationId: address.AllocationId ?? null, associationId: address.AssociationId ?? null, networkInterfaceId: address.NetworkInterfaceId ?? null },
      });
    } catch { warnings.push("EC2_ADDRESSES_FAILED:" + region); }
    try {
      let token: string | undefined;
      do {
        const result = await ec2.send(new DescribeSnapshotsCommand({ OwnerIds: ["self"], NextToken: token, MaxResults: 1000 }));
        for (const snapshot of result.Snapshots ?? []) if (snapshot.SnapshotId) resources.push({
          externalId: arn(accountId, region, "ec2", "snapshot/" + snapshot.SnapshotId), resourceType: "snapshot",
          displayName: snapshot.Tags?.find((tag) => tag.Key === "Name")?.Value ?? snapshot.SnapshotId, region,
          resourceStatus: snapshot.State ?? null, tags: tagsToRecord(snapshot.Tags),
          metadata: { volumeSizeGiB: snapshot.VolumeSize ?? null, encrypted: snapshot.Encrypted ?? null, startTime: snapshot.StartTime?.toISOString() ?? null },
        });
        token = result.NextToken;
      } while (token);
    } catch { warnings.push("EC2_SNAPSHOTS_FAILED:" + region); }
    ec2.destroy();

    const rds = new RDSClient({ region, credentials });
    try {
      let marker: string | undefined;
      do {
        const result = await rds.send(new DescribeDBInstancesCommand({ Marker: marker, MaxRecords: 100 }));
        for (const db of result.DBInstances ?? []) if (db.DBInstanceArn) resources.push({
          externalId: db.DBInstanceArn, resourceType: "database", displayName: db.DBInstanceIdentifier ?? db.DBInstanceArn,
          region, resourceStatus: db.DBInstanceStatus ?? null, tags: {},
          metadata: { engine: db.Engine ?? null, instanceClass: db.DBInstanceClass ?? null, storageGiB: db.AllocatedStorage ?? null, multiAz: db.MultiAZ ?? null, publiclyAccessible: db.PubliclyAccessible ?? null },
        });
        marker = result.Marker;
      } while (marker);
    } catch { warnings.push("RDS_DATABASES_FAILED:" + region); } finally { rds.destroy(); }

    const lambda = new LambdaClient({ region, credentials });
    try {
      let marker: string | undefined;
      do {
        const result = await lambda.send(new ListFunctionsCommand({ Marker: marker, MaxItems: 50 }));
        for (const fn of result.Functions ?? []) if (fn.FunctionArn) resources.push({
          externalId: fn.FunctionArn, resourceType: "function", displayName: fn.FunctionName ?? fn.FunctionArn,
          region, resourceStatus: fn.State ?? fn.LastUpdateStatus ?? null, tags: {},
          metadata: { runtime: fn.Runtime ?? null, memoryMiB: fn.MemorySize ?? null, timeoutSeconds: fn.Timeout ?? null, lastModified: fn.LastModified ?? null, environmentVariablesStored: false },
        });
        marker = result.NextMarker;
      } while (marker);
    } catch { warnings.push("LAMBDA_FUNCTIONS_FAILED:" + region); } finally { lambda.destroy(); }

    const elb = new ElasticLoadBalancingV2Client({ region, credentials });
    try {
      let marker: string | undefined;
      do {
        const result = await elb.send(new DescribeLoadBalancersCommand({ Marker: marker, PageSize: 400 }));
        for (const lb of result.LoadBalancers ?? []) if (lb.LoadBalancerArn) resources.push({
          externalId: lb.LoadBalancerArn, resourceType: "load_balancer", displayName: lb.LoadBalancerName ?? lb.LoadBalancerArn,
          region, resourceStatus: lb.State?.Code ?? null, tags: {},
          metadata: { scheme: lb.Scheme ?? null, type: lb.Type ?? null, vpcId: lb.VpcId ?? null, dnsName: lb.DNSName ?? null },
        });
        marker = result.NextMarker;
      } while (marker);
    } catch { warnings.push("LOAD_BALANCERS_FAILED:" + region); } finally { elb.destroy(); }
  }
  return { resources, complete: warnings.length === 0, warnings };
}
