import { getPrismaClient, Prisma } from "@goxai/database";

export type PlatformFeatures = {
  aiEnabled: boolean;
  payments: {
    paypalEnabled: boolean;
    plaidEnabled: boolean;
    stripeEnabled: boolean;
  };
};

const platformFeaturesKey = "platform.features";
const defaultPlatformFeatures: PlatformFeatures = {
  aiEnabled: false,
  payments: {
    paypalEnabled: true,
    plaidEnabled: false,
    stripeEnabled: false
  }
};

export async function getPlatformFeatures(): Promise<PlatformFeatures> {
  try {
    const setting = await getPrismaClient().platformSetting.findUnique({
      where: {
        key: platformFeaturesKey
      },
      select: {
        value: true
      }
    });

    return parsePlatformFeatures(setting?.value);
  } catch (reason) {
    if (isMissingPlatformSettingsTable(reason)) {
      return defaultPlatformFeatures;
    }

    throw reason;
  }
}

export async function updatePlatformFeatures(input: {
  aiEnabled: boolean;
  payments?: Partial<PlatformFeatures["payments"]>;
  updatedById: string;
}) {
  const current = await getPlatformFeatures();
  const value = {
    aiEnabled: input.aiEnabled,
    payments: {
      ...current.payments,
      ...input.payments
    }
  };
  const setting = await getPrismaClient().platformSetting.upsert({
    where: {
      key: platformFeaturesKey
    },
    create: {
      description: "Global feature switches for unfinished or gated platform modules.",
      key: platformFeaturesKey,
      updatedById: input.updatedById,
      value
    },
    update: {
      updatedById: input.updatedById,
      value
    },
    select: {
      value: true
    }
  });

  return parsePlatformFeatures(setting.value);
}

function parsePlatformFeatures(value: unknown): PlatformFeatures {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaultPlatformFeatures;
  }

  const features = value as Record<string, unknown>;

  return {
    aiEnabled: features.aiEnabled === true,
    payments: parsePaymentFeatures(features.payments)
  };
}

function parsePaymentFeatures(value: unknown): PlatformFeatures["payments"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaultPlatformFeatures.payments;
  }

  const payments = value as Record<string, unknown>;

  return {
    paypalEnabled: payments.paypalEnabled === true,
    plaidEnabled: payments.plaidEnabled === true,
    stripeEnabled: payments.stripeEnabled === true
  };
}

function isMissingPlatformSettingsTable(reason: unknown) {
  return reason instanceof Prisma.PrismaClientKnownRequestError && reason.code === "P2021";
}
