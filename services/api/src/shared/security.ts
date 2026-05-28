import type { NextFunction, Request, Response } from "express";

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type RateLimiterInput = {
  keyPrefix: string;
  maxRequests: number;
  message?: string;
  windowMs: number;
};

export function getAllowedWebOrigins(value = process.env.WEB_ORIGIN) {
  return (value ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

export function createCorsOriginValidator(allowedOrigins = getAllowedWebOrigins()) {
  return (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
    if (!origin) {
      callback(null, true);
      return;
    }

    const normalizedOrigin = origin.replace(/\/$/, "");

    if (allowedOrigins.includes("*") || allowedOrigins.includes(normalizedOrigin)) {
      callback(null, true);
      return;
    }

    callback(new Error("Origin is not allowed by CORS."));
  };
}

export function securityHeaders(request: Request, response: Response, next: NextFunction) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Cross-Origin-Resource-Policy", "same-site");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("X-Permitted-Cross-Domain-Policies", "none");

  if (request.secure || process.env.NODE_ENV === "production") {
    response.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  next();
}

export function createRateLimiter({
  keyPrefix,
  maxRequests,
  message = "Too many requests. Try again shortly.",
  windowMs
}: RateLimiterInput) {
  const buckets = new Map<string, RateLimitBucket>();
  let nextSweepAt = Date.now() + windowMs;

  return (request: Request, response: Response, next: NextFunction) => {
    if (!Number.isFinite(maxRequests) || maxRequests <= 0) {
      next();
      return;
    }

    const now = Date.now();

    if (now >= nextSweepAt) {
      for (const [key, bucket] of buckets.entries()) {
        if (bucket.resetAt <= now) {
          buckets.delete(key);
        }
      }

      nextSweepAt = now + windowMs;
    }

    const key = `${keyPrefix}:${getRequestAddress(request)}`;
    const bucket = buckets.get(key);
    const activeBucket = bucket && bucket.resetAt > now
      ? bucket
      : {
          count: 0,
          resetAt: now + windowMs
        };

    activeBucket.count += 1;
    buckets.set(key, activeBucket);

    const remaining = Math.max(0, maxRequests - activeBucket.count);
    const retryAfterSeconds = Math.max(1, Math.ceil((activeBucket.resetAt - now) / 1000));

    response.setHeader("RateLimit-Limit", String(maxRequests));
    response.setHeader("RateLimit-Remaining", String(remaining));
    response.setHeader("RateLimit-Reset", String(Math.ceil(activeBucket.resetAt / 1000)));

    if (activeBucket.count > maxRequests) {
      response.setHeader("Retry-After", String(retryAfterSeconds));
      response.status(429).json({
        error: message,
        retryAfterSeconds
      });
      return;
    }

    next();
  };
}

export function getTrustProxySetting(value = process.env.TRUST_PROXY) {
  const normalized = value?.trim().toLowerCase();

  if (!normalized || normalized === "false" || normalized === "0") {
    return false;
  }

  if (normalized === "true") {
    return true;
  }

  const hopCount = Number(normalized);

  return Number.isInteger(hopCount) && hopCount > 0 ? hopCount : normalized;
}

export function getPositiveIntegerEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);

  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function getRequestAddress(request: Request) {
  return request.ip || request.socket.remoteAddress || "unknown";
}
