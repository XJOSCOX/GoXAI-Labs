import { createSupabaseUserClient, getPrismaClient, getSupabaseConfig } from "@goxai/database";
import type { Request, Response, NextFunction } from "express";

export interface AuthenticatedRequest extends Request {
  currentUser?: Awaited<ReturnType<typeof syncUserFromAccessToken>>;
}

export async function getUserFromAccessToken(accessToken: string) {
  const config = getSupabaseConfig();
  const supabase = createSupabaseUserClient(accessToken, config);
  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error) {
    throw error;
  }

  return data.user;
}

export async function syncUserFromAccessToken(accessToken: string) {
  const authUser = await getUserFromAccessToken(accessToken);

  if (!authUser.email) {
    throw new Error("Supabase user is missing an email address.");
  }

  const prisma = getPrismaClient();
  const profile = getUserProfile(authUser);
  const now = new Date();

  return prisma.user.upsert({
    where: {
      supabaseAuthId: authUser.id
    },
    create: {
      supabaseAuthId: authUser.id,
      email: authUser.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
      avatarUrl: profile.avatarUrl,
      lastLoginAt: now
    },
    update: {
      email: authUser.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
      avatarUrl: profile.avatarUrl,
      lastLoginAt: now
    }
  });
}

export function getBearerToken(authorizationHeader: string | undefined) {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    return null;
  }

  return authorizationHeader.slice("Bearer ".length).trim() || null;
}

export async function requireAuthenticatedUser(
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction
) {
  const accessToken = getBearerToken(request.header("authorization"));

  if (!accessToken) {
    response.status(401).json({
      error: "Missing bearer token."
    });
    return;
  }

  try {
    request.currentUser = await syncUserFromAccessToken(accessToken);
    next();
  } catch (error) {
    response.status(401).json({
      error: error instanceof Error ? error.message : "Unable to verify Supabase token."
    });
  }
}

function getUserProfile(user: {
  user_metadata: Record<string, unknown>;
}) {
  const metadata = user.user_metadata;
  const fullName = getMetadataString(metadata.name) ?? getMetadataString(metadata.full_name);
  const [firstFromName, ...restFromName] = fullName?.split(" ").filter(Boolean) ?? [];
  const lastName = getMetadataString(metadata.last_name) ?? restFromName.join(" ");

  return {
    firstName: getMetadataString(metadata.first_name) ?? firstFromName,
    lastName: lastName || undefined,
    avatarUrl: getMetadataString(metadata.avatar_url) ?? getMetadataString(metadata.picture)
  };
}

function getMetadataString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
