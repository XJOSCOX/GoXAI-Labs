import express from "express";
import { getSupabaseConfig } from "@goxai/database";

export const app = express();

app.use(express.json());

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
