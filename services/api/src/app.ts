import express from "express";

export const app = express();

app.use(express.json());

app.get("/health", (_request, response) => {
  response.status(200).json({
    status: "ok",
    service: "goxai-api"
  });
});

app.get("/api/status", (_request, response) => {
  response.status(200).json({
    status: "online",
    service: "goxai-api",
    uptime: process.uptime()
  });
});
