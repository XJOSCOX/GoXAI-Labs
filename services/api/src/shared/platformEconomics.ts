import { getPrismaClient, Prisma } from "@goxai/database";

export type PlatformTaskEconomics = {
  freeTaskPostingFeeCredits: number;
  platformFeeRate: number;
};

const platformTaskEconomicsKey = "platform.task_economics";

export const defaultPlatformTaskEconomics: PlatformTaskEconomics = {
  freeTaskPostingFeeCredits: 0,
  platformFeeRate: 0.3
};

export async function getPlatformTaskEconomics(): Promise<PlatformTaskEconomics> {
  try {
    const setting = await getPrismaClient().platformSetting.findUnique({
      where: {
        key: platformTaskEconomicsKey
      },
      select: {
        value: true
      }
    });

    return parsePlatformTaskEconomics(setting?.value);
  } catch (reason) {
    if (isMissingPlatformSettingsTable(reason)) {
      return defaultPlatformTaskEconomics;
    }

    throw reason;
  }
}

export async function updatePlatformTaskEconomics(input: PlatformTaskEconomics & { updatedById: string }) {
  const value = parsePlatformTaskEconomics(input);
  const setting = await getPrismaClient().platformSetting.upsert({
    where: {
      key: platformTaskEconomicsKey
    },
    create: {
      description: "Global economics applied when creators fund task work.",
      key: platformTaskEconomicsKey,
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

  return parsePlatformTaskEconomics(setting.value);
}

export function parsePlatformTaskEconomics(value: unknown): PlatformTaskEconomics {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaultPlatformTaskEconomics;
  }

  const record = value as Record<string, unknown>;
  const platformFeeRate = getPercentDecimal(record.platformFeeRate, defaultPlatformTaskEconomics.platformFeeRate);
  const freeTaskPostingFeeCredits = getWholeCredits(record.freeTaskPostingFeeCredits, defaultPlatformTaskEconomics.freeTaskPostingFeeCredits);

  return {
    freeTaskPostingFeeCredits,
    platformFeeRate
  };
}

function getPercentDecimal(value: unknown, fallback: number) {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;

  return Number.isFinite(numberValue) ? Math.max(0, Math.min(1, numberValue)) : fallback;
}

function getWholeCredits(value: unknown, fallback: number) {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;

  return Number.isInteger(numberValue) && numberValue >= 0 && numberValue <= 1_000_000 ? numberValue : fallback;
}

function isMissingPlatformSettingsTable(reason: unknown) {
  return reason instanceof Prisma.PrismaClientKnownRequestError && reason.code === "P2021";
}
