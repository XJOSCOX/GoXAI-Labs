
export interface ApiUser {
  id: string;
  supabaseAuthId: string | null;
  email: string;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  avatarUrl: string | null;
  referralCode: string | null;
  apiCode: string | null;
  isVerified: boolean;
  verificationStatus: string;
  creatorStatus: string;
  verifiedAt: string | null;
  verifiedById: string | null;
  globalRole: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformFeatures {
  aiEnabled: boolean;
  payments: {
    paypalEnabled: boolean;
    plaidEnabled: boolean;
    stripeEnabled: boolean;
  };
}

export interface BackendConfig {
  economics: PlatformTaskEconomics;
  features: PlatformFeatures;
  supabase: {
    url: string;
    anonKey: string;
  };
}

export interface NotificationSummary {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string | null;
  readAt: string | null;
  metadata: Record<string, unknown> | null;
  actionUrl: string | null;
  actionLabel: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationsResult {
  notifications: NotificationSummary[];
  unreadCount: number;
}

export interface NotificationPreferenceSummary {
  description: string;
  email: boolean;
  event: string;
  inApp: boolean;
  label: string;
  updatedAt: string | null;
}

export interface UserApplicationSummary {
  id: string;
  userId: string;
  status: string;
  reason: string;
  intendedUse: string | null;
  reviewerNotes: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUserSummary {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  name: string;
  jobTitle: string | null;
  isVerified: boolean;
  verificationStatus: string;
  creatorStatus: string;
  globalRole: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminApplicationSummary extends UserApplicationSummary {
  type: "verification" | "creator";
  user: AdminUserSummary | null;
}

export interface AdminPayoutSummary {
  adminNotes: string | null;
  amount: number;
  createdAt: string;
  currency: string;
  id: string;
  provider: string | null;
  providerRef: string | null;
  receiptCount: number;
  reviewedAt: string | null;
  status: string;
  taskCreditEventCount: number;
  updatedAt: string;
  user: AdminUserSummary | null;
  userId: string;
  walletId: string;
}

export interface AdminPayoutCreditEventSummary {
  amount: number;
  approvedAt: string | null;
  assetName: string | null;
  availableAt: string | null;
  createdAt: string;
  credits: number;
  currency: string;
  datasetId: string | null;
  datasetName: string | null;
  eventType: string;
  id: string;
  points: number;
  projectId: string | null;
  projectName: string | null;
  status: string;
  taskId: string | null;
  withdrawnAt: string | null;
}

export interface AdminPayoutAuditEntry {
  action: string;
  createdAt: string;
  id: string;
  metadata: Record<string, unknown> | null;
}

export interface AdminPayoutDetail extends AdminPayoutSummary {
  auditTrail: AdminPayoutAuditEntry[];
  creditEvents: AdminPayoutCreditEventSummary[];
}

export interface AdminPaymentIntentSummary {
  amount: number;
  canCancel: boolean;
  cancelledAt: string | null;
  clientRequestId: string | null;
  completedAt: string | null;
  createdAt: string;
  createdBy: AdminUserSummary | null;
  createdById: string | null;
  currency: string;
  description: string | null;
  id: string;
  organization: {
    id: string;
    name: string;
    slug: string;
  } | null;
  organizationId: string | null;
  provider: string;
  providerRef: string | null;
  purpose: string;
  reconciliationSummary: {
    issueCount: number;
    netLedgerAmount: number;
    netReceiptAmount: number;
    severity: "blocked" | "none" | "warning";
    status: "balanced" | "warning";
  };
  receiptCount: number;
  staleAgeMinutes: number;
  staleReason: string | null;
  status: string;
  statusGroup: "closed" | "open" | "settled" | "stale";
  updatedAt: string;
  walletId: string;
}

export interface AdminPaymentReceiptSummary {
  amount: number;
  createdAt: string;
  currency: string;
  description: string | null;
  id: string;
  issuedAt: string;
  ledgerEntryId: string | null;
  organization: {
    id: string;
    name: string;
    slug: string;
  } | null;
  paymentIntentId: string | null;
  provider: string;
  providerRef: string | null;
  receiptNumber: string;
  type: string;
  user: AdminUserSummary | null;
}

export interface AdminPaymentLedgerEntrySummary {
  amount: number;
  createdAt: string;
  currency: string;
  description: string | null;
  id: string;
  organization: {
    id: string;
    name: string;
    slug: string;
  } | null;
  referenceId: string | null;
  type: string;
  user: AdminUserSummary | null;
  walletId: string;
}

export interface AdminPaymentIntentAuditEntry {
  action: string;
  actor: AdminUserSummary | null;
  createdAt: string;
  description: string;
  entityId: string | null;
  entityType: string | null;
  id: string;
  metadata: Record<string, unknown> | null;
}

export interface AdminPaymentIntentDetail extends AdminPaymentIntentSummary {
  auditTrail: AdminPaymentIntentAuditEntry[];
  ledgerEntries: AdminPaymentLedgerEntrySummary[];
  receipts: AdminPaymentReceiptSummary[];
  reconciliation: {
    expectedTopUpAmount: number;
    issueCount: number;
    issues: Array<{
      code: string;
      message: string;
      severity: "blocked" | "warning";
    }>;
    netLedgerAmount: number;
    netReceiptAmount: number;
    paymentAmount: number;
    refundLedgerAmount: number;
    refundReceiptAmount: number;
    status: "balanced" | "warning";
    topUpLedgerAmount: number;
    topUpReceiptAmount: number;
  };
  refundReadiness: {
    refundableAmount: number;
    refundedAmount: number;
    reason: string;
    status: "fully_refunded" | "needs_provider_reference" | "needs_reconciliation" | "not_refundable" | "ready";
  };
  webhookEvents: AdminProviderWebhookEventSummary[];
}

export interface AdminFundingSourceSummary {
  accountMask: string | null;
  accountName: string | null;
  accountSubtype: string | null;
  accountType: string | null;
  createdAt: string;
  currency: string;
  disabledAt: string | null;
  id: string;
  institutionName: string | null;
  organization: {
    id: string;
    name: string;
    slug: string;
  } | null;
  organizationId: string | null;
  processor: string | null;
  processorRef: string | null;
  provider: string;
  providerRef: string | null;
  status: string;
  updatedAt: string;
  user: AdminUserSummary | null;
  userId: string | null;
  walletId: string;
}

export interface AdminWebhookHealthSummary {
  count24h: number;
  duplicateCount: number;
  lastEventAgeMinutes: number | null;
  lastDuplicateAt: string | null;
  lastEventId: string | null;
  lastEventType: string | null;
  lastReceivedAt: string | null;
  lastTransmissionId: string | null;
  provider: "paypal" | "stripe";
  recentEvents: AdminProviderWebhookEventSummary[];
  status: "quiet" | "receiving" | "retrying";
  statusLabel: string;
}

export interface AdminProviderWebhookEventSummary {
  action: string | null;
  duplicateCount: number;
  eventId: string;
  eventType: string | null;
  id: string;
  idempotencyKey: string | null;
  lastDuplicateAt: string | null;
  paymentIntentId: string | null;
  providerRef: string | null;
  receivedAt: string;
  transmissionId: string | null;
  updatedAt: string;
}

export interface AdminPlatformRevenueTotal {
  collectedAmount: number;
  currency: string;
  pendingAmount: number;
  totalAmount: number;
}

export interface AdminPlatformRevenueBucket {
  collectedAmount: number;
  currency: string;
  id: string;
  name: string;
  pendingAmount: number;
  slug: string | null;
  taskCount: number;
  totalAmount: number;
}

export interface AdminPlatformRevenueFee {
  amount: number;
  createdAt: string;
  creator: {
    id: string;
    name: string;
    slug: string;
  } | null;
  currency: string;
  dataset: {
    id: string;
    name: string;
  } | null;
  description: string | null;
  id: string;
  project: {
    id: string;
    name: string;
  } | null;
  referenceId: string | null;
  reviewId: string | null;
  taskId: string | null;
}

export interface AdminPlatformRevenueSummary {
  byCreator: AdminPlatformRevenueBucket[];
  byDataset: AdminPlatformRevenueBucket[];
  byProject: AdminPlatformRevenueBucket[];
  recentFees: AdminPlatformRevenueFee[];
  totals: AdminPlatformRevenueTotal[];
}

export interface AdminPaymentAuditItem {
  actor: string | null;
  amount: number | null;
  createdAt: string;
  currency: string | null;
  description: string;
  id: string;
  kind: "audit_log" | "ledger_entry" | "payment_intent" | "receipt" | "webhook";
  organization: string | null;
  provider: string | null;
  reference: string;
  sourceId: string;
  status: string;
  title: string;
}

export interface AdminOverview {
  counts: {
    users: number;
    pendingVerification: number;
    verifiedUsers: number;
    pendingCreators: number;
    approvedCreators: number;
    organizations: number;
    projects: number;
    datasets: number;
    requestedPayouts: number;
    processingPayouts: number;
    paidPayouts: number;
    failedPayouts: number;
  };
  people?: {
    totalUsers: number;
    admins: number;
    creators: number;
    annotators: number;
    reviewers: number;
    pendingVerification: number;
  };
  payments: {
    auditTrail: AdminPaymentAuditItem[];
    fundingSources: AdminFundingSourceSummary[];
    paymentIntents: AdminPaymentIntentSummary[];
    platformRevenue: AdminPlatformRevenueSummary;
    webhookHealth: AdminWebhookHealthSummary[];
  };
  payouts: AdminPayoutSummary[];
  settings: {
    economics: PlatformTaskEconomics;
    features: PlatformFeatures;
    paymentProviders: Record<"paypal" | "plaid" | "stripe", AdminPaymentProviderStatus>;
  };
  users: AdminUserSummary[];
  verificationApplications: AdminApplicationSummary[];
  creatorApplications: AdminApplicationSummary[];
}

export interface PlatformTaskEconomics {
  freeTaskPostingFeeCredits: number;
  platformFeeRate: number;
}

export interface AdminPaymentProviderStatus {
  configured: boolean;
  enabled: boolean;
  environment: string;
  missing: string[];
}

export interface CreatorWalletSummary {
  availableBalance: number;
  currency: string;
  datasetReports: CreatorWalletDatasetReport[];
  ledgerEntries: CreatorWalletLedgerEntry[];
  paidToAnnotators: number;
  refundedBalance: number;
  reservedBalance: number;
  underReviewBalance: number;
  walletCount: number;
}

export interface CreatorWalletDatasetReport {
  currency: string;
  datasetId: string | null;
  datasetName: string;
  heldBalance: number;
  lastActivityAt: string;
  paidBalance: number;
  reconciliationDelta: number;
  reconciliationStatus: "balanced" | "warning";
  refundedBalance: number;
  reservedBalance: number;
  taskCount: number;
}

export interface CreatorWalletLedgerEntry {
  approvedCredits: number;
  amount: number;
  createdAt: string;
  currency: string;
  datasetId: string | null;
  datasetName: string | null;
  description: string | null;
  escrowCredits: number;
  escrowLedgerEntryId: string | null;
  feeCredits: number;
  id: string;
  isTopUpRefund: boolean;
  originalPaymentProvider: string | null;
  paymentIntentId: string | null;
  platformFeeRate: number;
  providerRef: string | null;
  referenceId: string | null;
  refundCredits: number;
  refundKind: string | null;
  reviewId: string | null;
  taskCount: number;
  taskId: string | null;
  type: string;
}

export interface CreatorWalletTopUpResult {
  ledgerEntryId: string;
  paymentIntentId: string;
  receiptId: string;
  receiptNumber: string;
  wallet: CreatorWalletSummary;
}

export interface CreatorWalletPayPalOrderResult {
  approvalUrl: string;
  orderId: string;
  paymentIntentId: string;
  reused?: boolean;
}

export interface CreatorWalletPayPalCaptureResult {
  paymentIntentId: string;
  receiptId: string | null;
  receiptNumber: string | null;
  wallet: CreatorWalletSummary;
}

export interface CreatorWalletStripeCheckoutResult {
  checkoutUrl: string;
  paymentIntentId: string;
  reused?: boolean;
  sessionId: string;
}

export interface CreatorWalletStripeCompleteResult {
  paymentIntentId: string;
  receiptId: string | null;
  receiptNumber: string | null;
  wallet: CreatorWalletSummary;
}

export interface CreatorWalletPlaidLinkTokenResult {
  expiration: string | null;
  linkToken: string;
  requestId: string | null;
}

export interface CreatorWalletPlaidBankLinkResult {
  fundingSource: CreatorWalletFundingSourceSummary;
  linked: boolean;
  requestId: string | null;
}

export interface CreatorWalletFundingSourceSummary {
  accountMask: string | null;
  accountName: string | null;
  accountSubtype: string | null;
  accountType: string | null;
  createdAt: string;
  currency: string;
  disabledAt: string | null;
  id: string;
  institutionName: string | null;
  organizationId: string | null;
  processor: string | null;
  provider: string;
  status: string;
  updatedAt: string;
}

export interface CreatorWalletFundingSourceAuditEntry {
  action: string;
  createdAt: string;
  entityId: string | null;
  entityType: string | null;
  id: string;
  metadata: unknown;
  userId: string | null;
}

export interface CreatorWalletFundingSourceDetail {
  auditTrail: CreatorWalletFundingSourceAuditEntry[];
  fundingSource: CreatorWalletFundingSourceSummary;
  paymentIntents: CreatorWalletPaymentIntentSummary[];
}

export interface CreatorWalletPaymentIntentSummary {
  amount: number;
  cancelledAt: string | null;
  clientRequestId: string | null;
  completedAt: string | null;
  createdAt: string;
  currency: string;
  description: string | null;
  id: string;
  provider: string;
  providerRef: string | null;
  status: string;
  updatedAt: string;
}

export interface WalletReceiptSummary {
  amount: number;
  createdAt: string;
  currency: string;
  description: string | null;
  id: string;
  issuedAt: string;
  organization: {
    id: string;
    name: string;
    slug: string;
  } | null;
  provider: string;
  providerRef: string | null;
  receiptNumber: string;
  type: string;
  user: {
    email: string;
    id: string;
    name: string;
  } | null;
}

export type CreatorWalletExportFormat = "csv" | "json";
export type CreatorLedgerFilter = "all" | "credit" | "escrow" | "fee" | "paid" | "refund";

export interface DownloadFileResult {
  blob: Blob;
  fileName: string;
}

export interface CreatorLedgerPageResult {
  entries: CreatorWalletLedgerEntry[];
  filterCounts: Record<CreatorLedgerFilter, number>;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  wallet: CreatorWalletSummary;
}

export interface WorkerCreditEventSummary {
  amount: number;
  annotationId: string | null;
  approvedAt: string | null;
  assetName: string | null;
  availableAt: string | null;
  createdAt: string;
  credits: number;
  currency: string;
  datasetName: string | null;
  eventType: string;
  id: string;
  projectName: string | null;
  referenceKey: string;
  reviewId: string | null;
  status: string;
  taskId: string | null;
  withdrawnAt: string | null;
}

export interface WorkerPayoutSummary {
  amount: number;
  createdAt: string;
  currency: string;
  id: string;
  status: string;
  updatedAt: string;
}

export interface WorkerWalletSummary {
  approvedBalance: number;
  approvedCreditCount: number;
  availableBalance: number;
  availableCreditCount: number;
  currency: string;
  holdDays: number;
  nextAvailableAt: string | null;
  paidWithdrawalBalance: number;
  pendingWithdrawalBalance: number;
  pendingWithdrawalCount: number;
  payouts: WorkerPayoutSummary[];
  recentEvents: WorkerCreditEventSummary[];
  totalEarnedBalance: number;
  underReviewBalance: number;
  underReviewCreditCount: number;
  withdrawnBalance: number;
}

export interface WorkerWithdrawalResult {
  payoutIds: string[];
  wallet: WorkerWalletSummary;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  email: string | null;
  description: string | null;
  onboardingComplete: boolean;
  type: string;
  accessMode: string;
  joinCode?: string | null;
  joinCodeEnabled: boolean;
  joinRequiresApproval: boolean;
  planTier: string;
  role: string;
  capabilities: OrganizationCapabilities;
  counts: {
    owners: number;
    members: number;
    projects: number;
    datasets: number;
  };
  workspace: {
    id: string;
    name: string;
    slug: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationCapabilities {
  canUpdate: boolean;
  canDelete: boolean;
  canManageMembers: boolean;
  canGrantOwnerRole: boolean;
  canCreateProjects: boolean;
  canViewMembers: boolean;
}

export interface MembershipSummary {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  role: string;
  status: string;
  joinedAt: string | null;
  user: {
    id: string;
    email: string;
    name: string;
  };
  workspace: {
    id: string;
    name: string;
    slug: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrganizationDetail extends Omit<OrganizationSummary, "role" | "workspace"> {
  currentUserRole: string;
  workspaces: Array<{
    id: string;
    organizationId: string;
    name: string;
    slug: string;
    description: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  memberships: MembershipSummary[];
}

export interface CreateOrganizationInput {
  organizationName: string;
  workspaceName: string;
  organizationEmail?: string;
  description?: string;
  organizationType: string;
  planTier: string;
}

export interface UpdateOrganizationInput {
  name?: string;
  email?: string;
  description?: string;
  type?: string;
  accessMode?: string;
  joinCodeEnabled?: boolean;
  joinRequiresApproval?: boolean;
  planTier?: string;
  completeOnboarding?: boolean;
}

export interface AddMemberInput {
  email: string;
  role: string;
}

export interface UpdateMemberInput {
  role?: string;
  status?: string;
}

export interface ProjectSummary {
  id: string;
  organizationId: string;
  workspaceId: string | null;
  createdById: string;
  name: string;
  slug: string;
  description: string | null;
  dataType: string;
  status: string;
  accessMode: string;
  memberLimit: number | null;
  allowExternalMembers: boolean;
  joinCode: string | null;
  joinCodeEnabled: boolean;
  instructions: string | null;
  currentUserRole: string | null;
  canManage: boolean;
  canCreateDataset: boolean;
  counts: {
    members: number;
    datasets: number;
    tasks: number;
  };
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  workspace: {
    id: string;
    name: string;
    slug: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectInput {
  organizationId: string;
  workspaceId?: string;
  name: string;
  description?: string;
  dataType: string;
  accessMode?: string;
  memberLimit?: number;
  allowExternalMembers?: boolean;
  joinCodeEnabled?: boolean;
  instructions?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  status?: string;
  accessMode?: string;
  memberLimit?: number | null;
  allowExternalMembers?: boolean;
  joinCodeEnabled?: boolean;
  instructions?: string;
}

export interface AnnotationTemplateSummary {
  canManage?: boolean;
  category?: {
    id: string;
    name: string;
    organizationId: string | null;
  } | null;
  categoryId: string | null;
  id: string;
  name: string;
  description: string | null;
  dataType: string;
  configJson: Record<string, unknown>;
  organization?: {
    id: string;
    name: string;
    slug: string;
  } | null;
  organizationId?: string | null;
  subtype?: string | null;
}

export interface BuiltInAnnotationTemplateSummary {
  category: string;
  categoryId: string;
  configCode: string;
  configJson: Record<string, unknown>;
  configPath: string;
  dataType: string;
  description: string;
  details: string | null;
  id: string;
  image: string | null;
  labels: string[];
  name: string;
  order: number;
  source: "builtin";
  sourceRepo: string | null;
  subtype: string;
  tools: string[];
  type: string;
}

export interface BuiltInAnnotationTemplateGroup {
  description: string;
  id: string;
  name: string;
  order: number;
}

export interface AnnotationCategorySummary {
  canManage: boolean;
  createdAt: string;
  createdBy: {
    id: string;
    email: string;
    name: string;
  } | null;
  description: string | null;
  id: string;
  name: string;
  organization: {
    id: string;
    name: string;
    slug: string;
  } | null;
  organizationId: string | null;
  templateCount: number;
  updatedAt: string;
}

export interface DatasetLabelSummary {
  id: string;
  name: string;
  color: string;
  shortcutKey: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface DatasetToolSummary {
  id: string;
  tool: string;
  enabled: boolean;
  configJson: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface DatasetLabelInput {
  color?: string;
  name: string;
  shortcutKey?: string;
}

export interface DatasetToolInput {
  configJson?: Record<string, unknown>;
  enabled?: boolean;
  tool: string;
}

export interface DatasetSummary {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  description: string | null;
  version: number;
  status: string;
  annotationTemplateId: string | null;
  labelingConfig: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  annotationTemplate: AnnotationTemplateSummary | null;
  labels: DatasetLabelSummary[];
  tools: DatasetToolSummary[];
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  project: {
    id: string;
    name: string;
    slug: string;
    dataType: string;
    status: string;
    createdById?: string;
  };
  counts: {
    assetCount: number;
    taskCount: number;
  };
  canManage: boolean;
  canManageAssets: boolean;
  canGenerateTasks: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DatasetVersionSummary {
  id: string;
  datasetId: string;
  version: number;
  summary: {
    reason: string;
    labelCount: number;
    toolCount: number;
    assetCount: number;
    taskCount: number;
    datasetName: string;
    datasetStatus: string;
    templateName: string | null;
    restoredFromVersion: number | null;
  };
  createdById: string | null;
  createdBy: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  } | null;
  createdAt: string;
}

export interface CreateDatasetInput {
  projectId: string;
  name: string;
  description?: string;
}

export interface UpdateDatasetInput {
  name?: string;
  description?: string;
  annotationTemplateId?: string | null;
  status?: string;
  labelingConfig?: Record<string, unknown> | null;
  labels?: DatasetLabelInput[];
  tools?: DatasetToolInput[];
}

export interface AssetSummary {
  id: string;
  organizationId: string;
  projectId: string | null;
  datasetId: string | null;
  provider: string;
  bucket: string;
  objectKey: string;
  fileName: string;
  mimeType: string;
  fileSize: string;
  checksum: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  metadata: Record<string, unknown> | null;
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  project: {
    id: string;
    name: string;
    slug: string;
  } | null;
  dataset: {
    id: string;
    metadata?: Record<string, unknown> | null;
    name: string;
    version: number;
    labelingConfig: Record<string, unknown> | null;
    labels: DatasetLabelSummary[];
    tools: DatasetToolSummary[];
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAssetInput {
  datasetId: string;
  bucket?: string;
  objectKey: string;
  fileName: string;
  mimeType: string;
  fileSize: string;
  checksum?: string;
  width?: string;
  height?: string;
  duration?: string;
  metadata?: Record<string, unknown>;
}

export interface AssetUploadRequest {
  datasetId: string;
  objectKey?: string;
  fileName: string;
  mimeType: string;
  fileSize: string;
}

export interface AssetUploadUrl {
  upload: {
    uploadUrl: string;
    method: "PUT";
    expiresInSeconds: number;
    headers: Record<string, string>;
  };
  asset: CreateAssetInput;
}

export interface MultipartUploadPartUrl {
  uploadUrl: string;
  method: "PUT";
  expiresInSeconds: number;
  headers: Record<string, string>;
  partNumber: number;
}

export interface AssetMultipartUpload {
  upload: {
    bucket: string;
    objectKey: string;
    uploadId: string;
    partSize: number;
    partCount: number;
    expiresInSeconds: number;
    parts: MultipartUploadPartUrl[];
  };
  asset: CreateAssetInput;
}

export interface CompletedMultipartPart {
  etag: string;
  partNumber: number;
}

export interface AssetAccessUrl {
  accessUrl: string;
  expiresInSeconds: number;
}

export interface ExportJobSummary {
  completedAt: string | null;
  createdAt: string;
  dataset: {
    id: string;
    name: string;
    version: number;
  } | null;
  datasetId: string | null;
  errorMessage: string | null;
  format: string;
  id: string;
  metadata: Record<string, unknown> | null;
  outputAsset: {
    id: string;
    bucket: string;
    fileName: string;
    fileSize: string;
    mimeType: string;
    objectKey: string;
    provider: string;
  } | null;
  outputAssetId: string | null;
  project: {
    id: string;
    name: string;
    slug: string;
  };
  projectId: string;
  requestedBy: {
    id: string;
    email: string;
    name: string;
  } | null;
  requestedById: string | null;
  startedAt: string | null;
  status: string;
  updatedAt: string;
}

export type ExportFormat = "ASR_JSONL" | "COCO" | "CONLL_2003" | "CSV" | "JSON" | "JSON_MIN" | "PASCAL_VOC" | "TSV" | "YOLO";

export interface ExportDownloadUrl {
  downloadUrl: string;
  expiresInSeconds: number;
  export: ExportJobSummary;
}

export interface DeleteAssetsResult {
  deletedCount: number;
}

export interface TaskSummary {
  id: string;
  projectId: string;
  datasetId: string | null;
  assetId: string | null;
  status: string;
  priority: number;
  assignedToId: string | null;
  reviewerId: string | null;
  qualityFlags?: string[];
  metadata: Record<string, unknown> | null;
  dueAt: string | null;
  project: {
    id: string;
    name: string;
    slug: string;
    organizationId: string;
    status: string;
  };
  dataset: {
    id: string;
    metadata?: Record<string, unknown> | null;
    name: string;
    version: number;
    labelingConfig: Record<string, unknown> | null;
    labels: DatasetLabelSummary[];
    tools: DatasetToolSummary[];
  } | null;
  asset: {
    id: string;
    fileName: string;
    objectKey: string;
    mimeType: string;
    fileSize: string;
    width: number | null;
    height: number | null;
    metadata: Record<string, unknown> | null;
  } | null;
  assignedTo: {
    id: string;
    email: string;
    name: string;
  } | null;
  reviewer: {
    id: string;
    email: string;
    name: string;
  } | null;
  payment: {
    annotationCredits: number;
    currency: string;
    platformFeeCredits: number;
    reviewCredits: number;
    totalCredits: number;
    workerCredits: number;
  };
  canManage: boolean;
  canReview: boolean;
  canWork: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AnnotationRegionSummary {
  id: string;
  type: string;
  label: string | null;
  geometryJson: Record<string, unknown>;
  confidence: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface AnnotationSummary {
  id: string;
  taskId: string;
  projectId: string;
  userId: string;
  status: string;
  resultJson: Record<string, unknown>;
  leadTimeSeconds: number | null;
  version: number;
  submittedAt: string | null;
  user: {
    id: string;
    email: string;
    name: string;
  };
  regions: AnnotationRegionSummary[];
  createdAt: string;
  updatedAt: string;
}

export interface ReviewSummary {
  annotation: {
    id: string;
    status: string;
    version: number;
  };
  annotationId: string;
  createdAt: string;
  feedback: string | null;
  id: string;
  metadata: Record<string, unknown> | null;
  reviewer: {
    id: string;
    email: string;
    name: string;
  };
  reviewerId: string;
  score: number | null;
  status: string;
  taskId: string;
  updatedAt: string;
}

export interface CommentSummary {
  annotationId: string | null;
  body: string;
  createdAt: string;
  id: string;
  metadata: Record<string, unknown> | null;
  parentId: string | null;
  resolved: boolean;
  taskId: string | null;
  updatedAt: string;
  user: {
    id: string;
    email: string;
    name: string;
  };
  userId: string;
}

export interface TaskDetailResult {
  annotation: AnnotationSummary | null;
  annotationHistory: AnnotationSummary[];
  comments: CommentSummary[];
  reviews: ReviewSummary[];
  task: TaskSummary;
}

export interface AIPredictionRegionSummary {
  confidence: number | null;
  geometry: SaveAnnotationInput["regions"][number]["geometry"];
  label: string | null;
  metadata: Record<string, unknown> | null;
  type: "BBOX" | "POLYGON";
}

export interface AIPredictionOutputSummary {
  predictions?: {
    regions?: AIPredictionRegionSummary[];
    results?: SaveAnnotationInput["results"];
    score?: number | null;
    summary?: string | null;
  };
}

export interface ModelProviderSummary {
  active: boolean;
  configJson: Record<string, unknown> | null;
  createdAt: string;
  createdById: string | null;
  id: string;
  name: string;
  organizationId: string;
  projectId: string | null;
  type: string;
  updatedAt: string;
}

export interface AIJobSummary {
  completedAt: string | null;
  createdAt: string;
  dataset: {
    id: string;
    name: string;
  } | null;
  datasetId: string | null;
  errorMessage: string | null;
  id: string;
  inputJson: Record<string, unknown> | null;
  modelProvider: {
    id: string;
    name: string;
    type: string;
  } | null;
  modelProviderId: string | null;
  outputJson: AIPredictionOutputSummary | null;
  project: {
    id: string;
    name: string;
  } | null;
  projectId: string | null;
  requestedBy: {
    id: string;
    email: string;
    name: string;
  } | null;
  requestedById: string | null;
  startedAt: string | null;
  status: string;
  task: {
    id: string;
  } | null;
  taskId: string | null;
  type: string;
  updatedAt: string;
}

export interface DatasetAIPredictionImportResult {
  errors: {
    assetName?: string;
    error: string;
    row: number;
    taskId?: string;
  }[];
  importedCount: number;
  jobs: AIJobSummary[];
  rowCount: number;
  skippedCount: number;
  totalRegions: number;
}

export interface NextTaskResult {
  task: TaskSummary | null;
}

export interface ReviewTaskResult {
  annotation: AnnotationSummary | null;
  comment: CommentSummary | null;
  review: ReviewSummary;
  settlement: TaskReviewPaymentSettlement | null;
  task: TaskSummary;
}

export interface TaskReviewPaymentSettlement {
  approvedCredits: number;
  currency: string;
  escrowCredits: number;
  feeCredits: number;
  refundCredits: number;
}

export interface AuditLogSummary {
  action: string;
  createdAt: string;
  entityId: string | null;
  entityType: string | null;
  id: string;
  metadata: Record<string, unknown> | null;
  project: {
    id: string;
    name: string;
    slug: string;
  } | null;
  projectId: string | null;
  user: {
    id: string;
    email: string;
    name: string;
  } | null;
  userId: string | null;
}

export interface AuditLogsResult {
  logs: AuditLogSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AuditCleanupResult {
  actions: string[];
  deletedCount: number;
  dryRun: boolean;
  matchedCount: number;
}

export interface SaveAnnotationInput {
  leadTimeSeconds?: number;
  results?: {
    fromName: string;
    toName: string;
    type: string;
    value: Record<string, unknown>;
  }[];
  regions: {
    confidence?: number | null;
    geometry:
      | {
          height: number;
          ocrBlockId?: string;
          page?: number;
          sourceName?: string;
          text?: string;
          width: number;
          x: number;
          y: number;
        }
      | {
          ocrBlockId?: string;
          page?: number;
          points: {
            x: number;
            y: number;
          }[];
          sourceName?: string;
          text?: string;
        };
    label?: string | null;
    metadata?: Record<string, unknown> | null;
    type?: string;
  }[];
}

export interface GenerateTasksResult {
  createdCount: number;
  skippedCount: number;
  remainingCount?: number;
  tasks: TaskSummary[];
}

export interface DatasetWorkflowResult {
  tasks: TaskSummary[];
  updatedCount: number;
}

export interface DatasetAssignmentResult {
  assignedCount: number;
}

export interface BulkTaskWorkflowResult {
  requestedCount: number;
  updatedCount: number;
}

export interface TaskParticipantSummary {
  canReview: boolean;
  canWork: boolean;
  email: string;
  id: string;
  name: string;
  roles: string[];
}

export interface TaskWorkflowInput {
  annotationCredits?: number;
  assignmentMode?: "round_robin" | "single" | "unassigned";
  assignedToId?: string | null;
  assigneeIds?: string[];
  autoSampleReview?: boolean;
  currency?: string;
  datasetBudgetCredits?: number;
  dueAt?: string | null;
  minAgreementRate?: number;
  minQualityScore?: number;
  priority?: number;
  requireConsensusBeforeApproval?: boolean;
  reviewBudgetShare?: number;
  reviewCredits?: number;
  reviewerId?: string | null;
  samplingTargetRate?: number;
  saveDefaults?: boolean;
  taskBudgetBasis?: number;
}

export interface TaskPageResult {
  page: number;
  pageSize: number;
  queueCounts?: Partial<Record<NonNullable<TaskQueueFilters["quality"]>, number>>;
  tasks: TaskSummary[];
  total: number;
  totalPages: number;
}

export type TaskAssignmentFilter = "all" | "mine" | "unassigned";
export type TaskDueFilter = "any" | "overdue" | "soon" | "none";

export interface TaskQueueFilters {
  assignment?: TaskAssignmentFilter;
  due?: TaskDueFilter;
  minPriority?: number;
  quality?: "ai_assisted" | "ai_edited" | "ai_low_confidence" | "disagreement" | "due_soon" | "missing_review" | "needs_fixes" | "overdue" | "sampled" | "urgent_priority" | "";
  search?: string;
  status?: string;
}

export interface TaskSavedView {
  createdAt: string;
  datasetId: string | null;
  filters: TaskQueueFilters;
  id: string;
  isDefault: boolean;
  name: string;
  projectId: string | null;
  queue: "review" | "work";
  sort?: unknown | null;
  updatedAt: string;
}

export interface TaskSavedViewsResult {
  views: TaskSavedView[];
}

export type TaskQueueColumnKey = "action" | "assigned" | "due" | "price" | "priority" | "quality" | "reviewer" | "status";

export interface TaskColumnSettingsResult {
  columns: TaskQueueColumnKey[];
}

export interface TaskProjectFolderSummary {
  active: number;
  assignedAnnotatorCount: number;
  approved: number;
  datasetCount: number;
  done: number;
  earnings: TaskFolderEarningSummary[];
  pending: number;
  projectId: string;
  projectName: string;
  projectSlug: string;
  projectStatus: string;
  rejected: number;
  review: number;
  total: number;
  unassigned: number;
}

export interface TaskDatasetFolderSummary {
  active: number;
  assignedAnnotatorCount: number;
  approved: number;
  datasetId: string;
  datasetName: string;
  done: number;
  earnings: TaskFolderEarningSummary[];
  pending: number;
  projectId: string;
  projectName: string;
  projectSlug: string;
  readyLabel: string;
  rejected: number;
  review: number;
  total: number;
  unassigned: number;
  versionLabel: string;
}

export interface TaskFolderEarningSummary {
  credits: number;
  currency: string;
}

export interface TaskFoldersResult {
  datasets?: TaskDatasetFolderSummary[];
  project?: {
    id: string;
    name: string;
    slug: string;
    status: string;
  };
  projects?: TaskProjectFolderSummary[];
}

export interface TaskStatsSummary {
  active: number;
  approved: number;
  done: number;
  pending: number;
  rejected: number;
  review: number;
  total: number;
  unassigned: number;
}

export interface QualityStatsResult {
  annotators: QualityPersonStats[];
  ai: {
    acceptedRegions: number;
    assistedTasks: number;
    averageConfidence: number | null;
    datasetBreakdown: QualityAIDatasetStats[];
    editedRegions: number;
    predictionRegions: number;
    providerBreakdown: QualityAIProviderStats[];
    removedRegions: number;
  };
  consensus: {
    agreementRate: number | null;
    comparedPairs: number;
    labelAgreementRate: number | null;
    overlapTasks: number;
  };
  credits: {
    approvedCredits: number;
    availableCredits: number;
    datasets: QualityCreditDatasetStats[];
    eventCount: number;
    events: QualityCreditEventStats[];
    leaderboard: QualityCreditPersonStats[];
    totalCredits: number;
    totalPoints: number;
    underReviewCredits: number;
    voidedCredits: number;
    withdrawnCredits: number;
  };
  datasets: QualityDatasetScore[];
  disagreements: QualityDisagreementSummary[];
  rejectionReasons: QualityReasonStats[];
  reasons: QualityCount[];
  reviewers: QualityPersonStats[];
  sampling: {
    pendingReview: number;
    reviewableTasks: number;
    reviewedTasks: number;
    sampleRate: number;
    targetRate: number;
  };
  samplingCandidates: QualitySamplingCandidate[];
  severity: QualityCount[];
  summary: {
    acceptanceRate: number;
    approved: number;
    averageScore: number | null;
    datasetQualityScore: number;
    rejected: number;
    reviewed: number;
  };
  trend: Array<{
    approved: number;
    date: string;
    rejected: number;
    total: number;
  }>;
}

export interface QualityAIProviderStats {
  id: string | null;
  name: string;
  regions: number;
  tasks: number;
  type: string | null;
}

export interface QualityAIDatasetStats {
  acceptedRegions: number;
  assistedTasks: number;
  averageConfidence: number | null;
  editedRegions: number;
  id: string | null;
  name: string;
  predictionRegions: number;
  removedRegions: number;
}

export interface QualityCreditPersonStats {
  annotationsApproved: number;
  annotationsSubmitted: number;
  approvedCredits: number;
  availableCredits: number;
  eventCount: number;
  id: string;
  lastCreditedAt: string;
  name: string;
  points: number;
  reviewsCompleted: number;
  underReviewCredits: number;
  voidedCredits: number;
  withdrawnCredits: number;
}

export interface QualityCreditEventStats {
  count: number;
  label: string;
  points: number;
}

export interface QualityCreditDatasetStats {
  approvedCredits: number;
  availableCredits: number;
  id: string | null;
  name: string;
  points: number;
  underReviewCredits: number;
  withdrawnCredits: number;
}

export interface QualityPersonStats {
  acceptanceRate: number;
  approved: number;
  averageLeadTimeSeconds: number | null;
  averageScore: number | null;
  id: string;
  name: string;
  qualityScore: number;
  rejected: number;
  rejectionRate: number;
  reviewed: number;
  submitted: number;
  total: number;
}

export interface QualityCount {
  count: number;
  label: string;
}

export interface QualityReasonStats extends QualityCount {
  share: number;
}

export interface QualityDatasetScore {
  acceptanceRate: number | null;
  agreementRate: number | null;
  approved: number;
  averageScore: number | null;
  id: string | null;
  name: string;
  qualityScore: number;
  rejected: number;
  reviewed: number;
  samplingRate: number | null;
  totalTasks: number;
}

export interface QualitySamplingCandidate {
  assetName: string;
  datasetId: string | null;
  datasetName: string;
  dueAt: string | null;
  priority: number;
  status: string;
  taskId: string;
}

export interface QualityDisagreementSummary {
  agreementRate: number;
  annotators: string[];
  assetName: string;
  datasetId: string | null;
  datasetName: string;
  labelAgreementRate: number;
  taskId: string;
}

export interface ClientLogInput {
  entityId?: string;
  entityType?: string;
  event: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  metadata?: Record<string, unknown>;
}
