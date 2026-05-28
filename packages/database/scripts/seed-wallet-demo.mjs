import {
  AnnotationStatus,
  DataType,
  DatasetStatus,
  LedgerEntryType,
  MembershipRole,
  PaymentIntentStatus,
  PayoutStatus,
  PrismaClient,
  ProjectStatus,
  StorageProvider,
  TaskCreditEventType,
  TaskCreditStatus,
  TaskStatus,
  WalletOwnerType,
  WalletReceiptType
} from "@prisma/client";

const prisma = new PrismaClient();
const now = new Date();

function receiptNumber(prefix, id) {
  const dateStamp = now.toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = id.replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase();

  return `${prefix}-${dateStamp}-${suffix}`;
}

async function main() {
  const creator = await prisma.user.upsert({
    where: { email: "creator.demo@goxailab.local" },
    update: {},
    create: {
      email: "creator.demo@goxailab.local",
      firstName: "Creator",
      isVerified: true,
      lastName: "Demo"
    }
  });
  const worker = await prisma.user.upsert({
    where: { email: "worker.demo@goxailab.local" },
    update: {},
    create: {
      email: "worker.demo@goxailab.local",
      firstName: "Worker",
      isVerified: true,
      lastName: "Demo"
    }
  });
  const reviewer = await prisma.user.upsert({
    where: { email: "reviewer.demo@goxailab.local" },
    update: {},
    create: {
      email: "reviewer.demo@goxailab.local",
      firstName: "Reviewer",
      isVerified: true,
      lastName: "Demo"
    }
  });

  const organization = await prisma.organization.upsert({
    where: { slug: "wallet-demo-org" },
    update: {},
    create: {
      name: "Wallet Demo Org",
      ownerId: creator.id,
      slug: "wallet-demo-org"
    }
  });
  const workspace = await prisma.workspace.upsert({
    where: { organizationId_slug: { organizationId: organization.id, slug: "default" } },
    update: {},
    create: {
      name: "Default",
      organizationId: organization.id,
      slug: "default"
    }
  });

  await prisma.membership.upsert({
    where: { userId_organizationId_workspaceId: { organizationId: organization.id, userId: creator.id, workspaceId: workspace.id } },
    update: { role: MembershipRole.OWNER },
    create: {
      joinedAt: now,
      organizationId: organization.id,
      role: MembershipRole.OWNER,
      userId: creator.id,
      workspaceId: workspace.id
    }
  });

  const project = await prisma.project.upsert({
    where: { organizationId_slug: { organizationId: organization.id, slug: "wallet-demo-project" } },
    update: { status: ProjectStatus.ACTIVE },
    create: {
      createdById: creator.id,
      dataType: DataType.IMAGE,
      description: "Seeded wallet lifecycle project.",
      name: "Wallet Demo Project",
      organizationId: organization.id,
      slug: "wallet-demo-project",
      status: ProjectStatus.ACTIVE,
      workspaceId: workspace.id
    }
  });
  const dataset = await prisma.dataset.upsert({
    where: { id: "wallet-demo-dataset" },
    update: { status: DatasetStatus.READY },
    create: {
      createdById: creator.id,
      description: "Seeded wallet lifecycle dataset.",
      id: "wallet-demo-dataset",
      metadata: {
        paymentPolicy: {
          annotationCredits: 20,
          currency: "USD",
          reviewCredits: 8
        }
      },
      name: "Wallet Demo Dataset",
      organizationId: organization.id,
      projectId: project.id,
      status: DatasetStatus.READY
    }
  });
  const asset = await prisma.storageAsset.upsert({
    where: { provider_bucket_objectKey: { bucket: "demo", objectKey: "wallet-demo/image-1.png", provider: StorageProvider.LOCAL } },
    update: {},
    create: {
      bucket: "demo",
      datasetId: dataset.id,
      fileName: "wallet-demo-image-1.png",
      fileSize: 1024n,
      mimeType: "image/png",
      objectKey: "wallet-demo/image-1.png",
      organizationId: organization.id,
      projectId: project.id,
      provider: StorageProvider.LOCAL,
      uploadedById: creator.id
    }
  });

  const creatorWallet = await prisma.wallet.upsert({
    where: { id: "wallet-demo-creator-wallet" },
    update: {},
    create: {
      balance: "72.00",
      currency: "USD",
      id: "wallet-demo-creator-wallet",
      organizationId: organization.id,
      ownerType: WalletOwnerType.ORGANIZATION
    }
  });
  const workerWallet = await prisma.wallet.upsert({
    where: { id: "wallet-demo-worker-wallet" },
    update: {},
    create: {
      balance: "0.00",
      currency: "USD",
      id: "wallet-demo-worker-wallet",
      ownerType: WalletOwnerType.USER,
      userId: worker.id
    }
  });

  const paymentIntent = await prisma.paymentIntent.upsert({
    where: { id: "wallet-demo-topup-intent" },
    update: {},
    create: {
      amount: "100.00",
      completedAt: now,
      createdById: creator.id,
      currency: "USD",
      id: "wallet-demo-topup-intent",
      metadata: { demoSeed: true },
      organizationId: organization.id,
      provider: "sandbox",
      providerRef: "sandbox-topup-100",
      purpose: "creator_wallet_top_up",
      status: PaymentIntentStatus.SUCCEEDED,
      walletId: creatorWallet.id
    }
  });
  const topUpLedger = await prisma.ledgerEntry.upsert({
    where: { id: "wallet-demo-topup-ledger" },
    update: {},
    create: {
      amount: "100.00",
      currency: "USD",
      description: "Sandbox creator wallet top-up.",
      id: "wallet-demo-topup-ledger",
      metadata: { demoSeed: true, paymentIntentId: paymentIntent.id },
      referenceId: paymentIntent.id,
      type: LedgerEntryType.CREDIT,
      walletId: creatorWallet.id
    }
  });
  await prisma.walletReceipt.upsert({
    where: { receiptNumber: receiptNumber("TOP", paymentIntent.id) },
    update: {},
    create: {
      amount: "100.00",
      currency: "USD",
      description: "Sandbox creator wallet top-up receipt.",
      ledgerEntryId: topUpLedger.id,
      metadata: { demoSeed: true },
      organizationId: organization.id,
      paymentIntentId: paymentIntent.id,
      provider: "sandbox",
      providerRef: "sandbox-topup-100",
      receiptNumber: receiptNumber("TOP", paymentIntent.id),
      type: WalletReceiptType.TOP_UP,
      userId: creator.id,
      walletId: creatorWallet.id
    }
  });

  const holdLedger = await prisma.ledgerEntry.upsert({
    where: { id: "wallet-demo-escrow-hold" },
    update: {},
    create: {
      amount: "28.00",
      currency: "USD",
      description: "Reserve demo task escrow.",
      id: "wallet-demo-escrow-hold",
      metadata: { datasetId: dataset.id, demoSeed: true, taskCount: 1 },
      referenceId: dataset.id,
      type: LedgerEntryType.HOLD,
      walletId: creatorWallet.id
    }
  });
  const task = await prisma.task.upsert({
    where: { id: "wallet-demo-task-approved" },
    update: {},
    create: {
      assetId: asset.id,
      assignedToId: worker.id,
      datasetId: dataset.id,
      id: "wallet-demo-task-approved",
      metadata: {
        demoSeed: true,
        paymentEscrowCredits: 28,
        paymentEscrowLedgerEntryId: holdLedger.id
      },
      priority: 5,
      projectId: project.id,
      reviewerId: reviewer.id,
      status: TaskStatus.APPROVED
    }
  });
  const annotation = await prisma.annotation.upsert({
    where: { taskId_userId_version: { taskId: task.id, userId: worker.id, version: 1 } },
    update: {},
    create: {
      projectId: project.id,
      resultJson: { regions: [] },
      status: AnnotationStatus.ACCEPTED,
      submittedAt: now,
      taskId: task.id,
      userId: worker.id,
      version: 1
    }
  });
  await prisma.taskCreditEvent.upsert({
    where: { referenceKey: "wallet-demo-annotation-approved" },
    update: {},
    create: {
      amount: "20.00",
      annotationId: annotation.id,
      approvedAt: now,
      availableAt: now,
      credits: 20,
      currency: "USD",
      datasetId: dataset.id,
      eventType: TaskCreditEventType.ANNOTATION_APPROVED,
      organizationId: organization.id,
      points: 20,
      projectId: project.id,
      referenceKey: "wallet-demo-annotation-approved",
      status: TaskCreditStatus.WITHDRAWN,
      taskId: task.id,
      userId: worker.id,
      withdrawnAt: now
    }
  });
  const releaseLedger = await prisma.ledgerEntry.upsert({
    where: { id: "wallet-demo-escrow-release" },
    update: {},
    create: {
      amount: "20.00",
      currency: "USD",
      description: "Release approved demo task escrow.",
      id: "wallet-demo-escrow-release",
      metadata: { approvedCredits: 20, demoSeed: true, escrowLedgerEntryId: holdLedger.id, taskId: task.id },
      referenceId: task.id,
      type: LedgerEntryType.RELEASE,
      walletId: creatorWallet.id
    }
  });
  await prisma.ledgerEntry.upsert({
    where: { id: "wallet-demo-escrow-refund" },
    update: {},
    create: {
      amount: "8.00",
      currency: "USD",
      description: "Refund unused demo task escrow.",
      id: "wallet-demo-escrow-refund",
      metadata: { demoSeed: true, escrowLedgerEntryId: holdLedger.id, refundCredits: 8, taskId: task.id },
      referenceId: task.id,
      type: LedgerEntryType.REFUND,
      walletId: creatorWallet.id
    }
  });
  const payout = await prisma.payout.upsert({
    where: { id: "wallet-demo-payout-paid" },
    update: {},
    create: {
      amount: "20.00",
      currency: "USD",
      id: "wallet-demo-payout-paid",
      metadata: {
        demoSeed: true,
        taskCreditEventIds: ["wallet-demo-annotation-approved"]
      },
      provider: "sandbox",
      providerRef: "sandbox-payout-20",
      status: PayoutStatus.PAID,
      userId: worker.id,
      walletId: workerWallet.id
    }
  });
  await prisma.ledgerEntry.upsert({
    where: { id: "wallet-demo-payout-ledger" },
    update: {},
    create: {
      amount: "20.00",
      currency: "USD",
      description: "Worker demo payout.",
      id: "wallet-demo-payout-ledger",
      metadata: { demoSeed: true, payoutId: payout.id },
      referenceId: payout.id,
      type: LedgerEntryType.PAYOUT,
      walletId: workerWallet.id
    }
  });
  await prisma.walletReceipt.upsert({
    where: { receiptNumber: receiptNumber("POUT", payout.id) },
    update: {},
    create: {
      amount: "20.00",
      currency: "USD",
      description: "Worker demo payout statement.",
      ledgerEntryId: releaseLedger.id,
      metadata: { demoSeed: true },
      payoutId: payout.id,
      provider: "sandbox",
      providerRef: "sandbox-payout-20",
      receiptNumber: receiptNumber("POUT", payout.id),
      type: WalletReceiptType.PAYOUT,
      userId: worker.id,
      walletId: workerWallet.id
    }
  });

  console.log("Seeded wallet demo lifecycle:");
  console.log(`  creator: ${creator.email}`);
  console.log(`  worker: ${worker.email}`);
  console.log(`  organization: ${organization.slug}`);
  console.log(`  dataset: ${dataset.name}`);
  console.log(`  task: ${task.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
