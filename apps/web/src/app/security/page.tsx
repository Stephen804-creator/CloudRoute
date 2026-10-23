export const metadata = {
  title: "Security and permissions — CloudRoute",
  description: "What CloudRoute reads, what it never collects, and how to revoke access.",
};

export default function SecurityPage() {
  return <main className="security-page">
    <header className="topbar security-topbar"><a className="brand" href="/"><span className="brand-mark">C</span><span>CloudRoute</span></a><a className="text-link" href="/signup">Create workspace →</a></header>
    <section className="security-hero"><p className="eyebrow">SECURITY & PERMISSIONS</p><h1>Visibility without<br /><span>cloud control.</span></h1><p>CloudRoute's MVP is designed to observe cloud resource metadata. It cannot provision, modify, or delete customer infrastructure.</p><span className="mode-badge"><span /> Read-only by design</span></section>
    <section className="security-section"><h2>What AWS permissions are requested?</h2><p>The current connector uses a customer-created IAM role, a unique external ID, and temporary AWS STS credentials. It requests these read-only actions:</p><div className="permission-list">{["ec2:DescribeRegions","ec2:DescribeInstances","ec2:DescribeVolumes","ec2:DescribeAddresses","ec2:DescribeSnapshots","s3:ListAllMyBuckets","rds:DescribeDBInstances","lambda:ListFunctions","elasticloadbalancing:DescribeLoadBalancers"].map((permission) => <code key={permission}>{permission}</code>)}</div><a className="text-link" href="https://github.com/Stephen804-creator/CloudRoute/blob/main/docs/security/aws-read-only-policy.json" target="_blank" rel="noreferrer">Review the exact IAM policy →</a></section>
    <section className="security-section security-grid"><article><span className="security-icon positive">✓</span><h2>What we collect</h2><ul><li>Resource identifiers and types</li><li>Resource names, regions, state, and tags when available</li><li>Selected configuration metadata needed for inventory</li><li>Sync health and timestamps</li></ul></article><article><span className="security-icon negative">×</span><h2>What we do not collect</h2><ul><li>Objects or files inside storage buckets</li><li>Rows inside customer databases</li><li>Data stored on disks or volumes</li><li>Lambda environment variables or secret values</li><li>Long-lived AWS access keys</li></ul></article></section>
    <section className="security-section"><h2>How to revoke access</h2><ol><li>Disconnect the account from CloudRoute's account settings.</li><li>In AWS IAM, remove or disable the customer-created role's trust relationship for CloudRoute.</li><li>Review CloudTrail for role assumptions if you need an audit of access.</li></ol><p>Disconnecting stops future CloudRoute syncs. It does not change any AWS resource. Data deletion and retention are handled by the documented account-deletion process.</p></section>
    <footer className="security-footer"><span>CloudRoute · Security overview</span><a href="/signup">Get started →</a></footer>
  </main>;
}
