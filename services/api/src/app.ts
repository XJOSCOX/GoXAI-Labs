import cors from "cors";
import express from "express";
import { getSupabaseConfig } from "@goxai/database";
import { assetsRouter } from "./assets.js";
import { getBearerToken, syncUserFromAccessToken } from "./auth.js";
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
      user: {
        id: user.id,
        supabaseAuthId: user.supabaseAuthId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        avatarUrl: user.avatarUrl,
        globalRole: user.globalRole,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });
  } catch (error) {
    response.status(401).json({
      error: error instanceof Error ? error.message : "Unable to verify Supabase token."
    });
  }
});

app.use("/api/organizations", organizationsRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/datasets", datasetsRouter);
app.use("/api/assets", assetsRouter);
app.use("/api/tasks", tasksRouter);
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
