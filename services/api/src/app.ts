import cors from "cors";
import express from "express";
import { getPrismaClient, getSupabaseConfig } from "@goxai/database";
import { adminRouter } from "./admin.js";
import { annotationTemplatesRouter } from "./annotationTemplates.js";
import { applicationsRouter } from "./applications.js";
import { assetsRouter } from "./assets.js";
import { getBearerToken, requireAuthenticatedUser, syncUserFromAccessToken, type AuthenticatedRequest } from "./auth.js";
import { datasetsRouter } from "./datasets.js";
import { apiRequestLogger, logApiException } from "./logging.js";
import { logsRouter } from "./logs.js";
import { organizationsRouter } from "./organizations.js";
import { projectsRouter } from "./projects.js";
import { tasksRouter } from "./tasks.js";

export const app = express();

app.use(
  cors({
    origin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
    credentials: true
  })
);
app.use(express.json());
app.use(apiRequestLogger);

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

app.get("/api/config", (_request, response) => {
  const supabase = getSupabaseConfig();

  if (!supabase.isConfigured) {
    response.status(503).json({
      error: "Supabase is not configured.",
      missing: supabase.missing
    });
    return;
  }

  response.status(200).json({
    supabase: {
      url: supabase.url,
      anonKey: supabase.anonKey
    }
  });
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
app.use("/api/projects", projectsRouter);
app.use("/api/datasets", datasetsRouter);
app.use("/api/assets", assetsRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/applications", applicationsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/annotation-templates", annotationTemplatesRouter);
app.use("/api/logs", logsRouter);

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
