import cors from "cors";
import express from "express";
import { getPrismaClient, getSupabaseConfig } from "@goxai/database";
import { adminRouter } from "../modules/admin/admin.js";
import { aiRouter } from "../modules/ai/ai.js";
import { annotationTemplatesRouter } from "../modules/labeling/annotationTemplates.js";
import { applicationsRouter } from "../modules/applications/applications.js";
import { assetsRouter } from "../modules/assets/assets.js";
import { getBearerToken, requireAuthenticatedUser, syncUserFromAccessToken, type AuthenticatedRequest } from "../shared/auth.js";
import { billingRouter, paypalWebhookRouter, stripeWebhookRouter } from "../modules/billing/billing.js";
import { datasetsRouter } from "../modules/datasets/datasets.js";
import { exportsRouter } from "../modules/exports/exports.js";
import { apiRequestLogger, logApiException } from "../shared/logging.js";
import { logsRouter } from "../modules/logs/logs.js";
import { notificationsRouter } from "../modules/notifications/notifications.js";
import { organizationsRouter } from "../modules/organizations/organizations.js";
import { getPlatformTaskEconomics } from "../shared/platformEconomics.js";
import { getPlatformFeatures } from "../shared/platformFeatures.js";
import {
  createCorsOriginValidator,
  createRateLimiter,
  getAllowedWebOrigins,
  getPositiveIntegerEnv,
  getTrustProxySetting,
  securityHeaders
} from "../shared/security.js";
import { projectsRouter } from "../modules/projects/projects.js";
import { tasksRouter } from "../modules/tasks/tasks.js";

export const app = express();
const trustProxy = getTrustProxySetting();

if (trustProxy !== false) {
  app.set("trust proxy", trustProxy);
}

app.use(securityHeaders);
app.use(
  cors({
    origin: createCorsOriginValidator(getAllowedWebOrigins()),
    credentials: true
  })
);
app.use(apiRequestLogger);
app.use(
  createRateLimiter({
    keyPrefix: "api",
    maxRequests: getPositiveIntegerEnv("API_RATE_LIMIT_PER_MINUTE", 600),
    windowMs: 60_000
  })
);
app.use(
  "/api/auth",
  createRateLimiter({
    keyPrefix: "auth",
    maxRequests: getPositiveIntegerEnv("AUTH_RATE_LIMIT_PER_MINUTE", 60),
    message: "Too many authentication requests. Try again shortly.",
    windowMs: 60_000
  })
);
app.use(
  "/api/billing",
  createRateLimiter({
    keyPrefix: "billing",
    maxRequests: getPositiveIntegerEnv("BILLING_RATE_LIMIT_PER_MINUTE", 180),
    message: "Too many billing requests. Try again shortly.",
    windowMs: 60_000
  })
);
app.use(
  "/api/admin",
  createRateLimiter({
    keyPrefix: "admin",
    maxRequests: getPositiveIntegerEnv("ADMIN_RATE_LIMIT_PER_MINUTE", 120),
    message: "Too many admin requests. Try again shortly.",
    windowMs: 60_000
  })
);
app.use("/api/billing", paypalWebhookRouter);
app.use("/api/billing", stripeWebhookRouter);
app.use(express.json({ limit: process.env.API_JSON_BODY_LIMIT ?? "1mb" }));

app.get("/health", (_request, response) => {
  response.status(200).json({
    status: "ok",
    service: "goxai-api"
  });
});

app.get("/api/status", (_request, response) => {
  const supabase = getSupabaseConfig();

  response.status(200).json({
    status: "online",
    service: "goxai-api",
    supabase: {
      configured: supabase.isConfigured,
      missing: supabase.missing
    },
    uptime: process.uptime()
  });
});

app.get("/api/config", async (request, response) => {
  const supabase = getSupabaseConfig();

  if (!supabase.isConfigured) {
    response.status(503).json({
      error: "Supabase is not configured.",
      missing: supabase.missing
    });
    return;
  }

  try {
    response.status(200).json({
      economics: await getPlatformTaskEconomics(),
      features: await getPlatformFeatures(),
      supabase: {
        url: supabase.url,
        anonKey: supabase.anonKey
      }
    });
  } catch (reason) {
    void logApiException(request, reason);
    response.status(200).json({
      economics: {
        freeTaskPostingFeeCredits: 0,
        platformFeeRate: 0.3
      },
      features: {
        aiEnabled: false,
        payments: {
          paypalEnabled: true,
          plaidEnabled: false,
          stripeEnabled: false
        }
      },
      supabase: {
        url: supabase.url,
        anonKey: supabase.anonKey
      }
    });
  }
});

app.get("/api/auth/login-identifier", async (request, response) => {
  const identifier = typeof request.query.identifier === "string" ? request.query.identifier.trim().toLowerCase() : "";

  if (!identifier) {
    response.status(400).json({ error: "Email is required." });
    return;
  }

  const prisma = getPrismaClient();
  const organization = await prisma.organization.findUnique({
    where: {
      email: identifier
    },
    select: {
      owner: {
        select: {
          email: true
        }
      }
    }
  });

  response.status(200).json({
    email: organization?.owner.email ?? identifier
  });
});

app.post("/api/auth/sync", async (request, response) => {
  const accessToken = getBearerToken(request.header("authorization"));

  if (!accessToken) {
    response.status(401).json({
      error: "Missing bearer token."
    });
    return;
  }

  try {
    const user = await syncUserFromAccessToken(accessToken);

    response.status(200).json({
      user: serializeUser(user)
    });
  } catch (error) {
    response.status(401).json({
      error: error instanceof Error ? error.message : "Unable to verify Supabase token."
    });
  }
});

app.patch("/api/auth/profile", requireAuthenticatedUser, async (request: AuthenticatedRequest, response) => {
  const user = request.currentUser;

  if (!user) {
    response.status(401).json({ error: "Authentication required." });
    return;
  }

  const data: {
    firstName?: string | null;
    lastName?: string | null;
    jobTitle?: string | null;
  } = {};

  if (typeof request.body?.firstName === "string") {
    const firstName = request.body.firstName.trim();
    data.firstName = firstName || null;
  }

  if (typeof request.body?.lastName === "string") {
    const lastName = request.body.lastName.trim();
    data.lastName = lastName || null;
  }

  if (typeof request.body?.jobTitle === "string") {
    const jobTitle = request.body.jobTitle.trim();
    data.jobTitle = jobTitle || null;
  }

  const prisma = getPrismaClient();
  const updated = await prisma.user.update({
    where: {
      id: user.id
    },
    data
  });

  response.status(200).json({
    user: serializeUser(updated)
  });
});

function serializeUser(user: Awaited<ReturnType<typeof syncUserFromAccessToken>>) {
  return {
    id: user.id,
    supabaseAuthId: user.supabaseAuthId,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    jobTitle: user.jobTitle,
    avatarUrl: user.avatarUrl,
    referralCode: user.referralCode,
    apiCode: user.apiCode,
    isVerified: user.isVerified,
    verificationStatus: user.verificationStatus,
    creatorStatus: user.creatorStatus,
    verifiedAt: user.verifiedAt,
    verifiedById: user.verifiedById,
    globalRole: user.globalRole,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

app.use("/api/organizations", organizationsRouter);
app.use("/api/billing", billingRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/datasets", datasetsRouter);
app.use("/api/assets", assetsRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/exports", exportsRouter);
app.use("/api/applications", applicationsRouter);
app.use("/api/ai", aiRouter);
app.use("/api/admin", adminRouter);
app.use("/api/annotation-templates", annotationTemplatesRouter);
app.use("/api/logs", logsRouter);
app.use("/api/notifications", notificationsRouter);

app.use(
  (
    error: unknown,
    request: express.Request,
    response: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(error);
    void logApiException(request, error);

    if (response.headersSent) {
      return;
    }

    response.status(500).json({
      error: "Something went wrong while processing the request."
    });
  }
);
