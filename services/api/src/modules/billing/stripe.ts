import { createHmac, timingSafeEqual } from "node:crypto";

type StripeCheckoutSessionResponse = {
  amount_total?: number | null;
  currency?: string | null;
  id: string;
  metadata?: Record<string, string> | null;
  payment_intent?: string | null;
  payment_status?: string | null;
  status?: string | null;
  url?: string | null;
};

type StripeEvent = {
  id?: string;
  type?: string;
  data?: {
    object?: unknown;
  };
};

type StripeCustomerResponse = {
  id: string;
};

type StripeBankAccountResponse = {
  account_holder_name?: string | null;
  account_holder_type?: string | null;
  bank_name?: string | null;
  country?: string | null;
  currency?: string | null;
  fingerprint?: string | null;
  id: string;
  last4?: string | null;
  routing_number?: string | null;
  status?: string | null;
};

export type StripeCheckoutSessionSummary = {
  amount: string;
  currency: string;
  paymentIntentId: string | null;
  providerPaymentIntentId: string | null;
  sessionId: string;
  status: string;
};

export class StripeConfigurationError extends Error {
  constructor(message = "Stripe is not configured. Add STRIPE_SECRET_KEY.") {
    super(message);
  }
}

export class StripeRequestError extends Error {
  constructor(message: string, readonly status = 502, readonly payload: unknown = null) {
    super(message);
  }
}

export function getStripeApiBaseUrl(override = process.env.STRIPE_API_BASE_URL) {
  return override?.trim() ? override.trim().replace(/\/$/, "") : "https://api.stripe.com";
}

export async function createStripeCheckoutSession(input: {
  amount: string;
  cancelUrl: string;
  currency: string;
  customerId?: string | null;
  description: string;
  fundingSourceId?: string | null;
  paymentMethodTypes?: string[];
  paymentIntentId: string;
  requestId: string;
  successUrl: string;
}) {
  const amountCents = Math.round(Number(input.amount) * 100);

  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new StripeRequestError("Stripe checkout amount is invalid.", 400);
  }

  const params = new URLSearchParams({
    cancel_url: input.cancelUrl,
    client_reference_id: input.paymentIntentId,
    "line_items[0][price_data][currency]": input.currency.toLowerCase(),
    "line_items[0][price_data][product_data][name]": input.description,
    "line_items[0][price_data][unit_amount]": String(amountCents),
    "line_items[0][quantity]": "1",
    "metadata[paymentIntentId]": input.paymentIntentId,
    mode: "payment",
    "payment_intent_data[description]": input.description,
    "payment_intent_data[metadata][paymentIntentId]": input.paymentIntentId,
    success_url: input.successUrl
  });

  if (input.customerId) {
    params.set("customer", input.customerId);
  }

  if (input.fundingSourceId) {
    params.set("metadata[fundingSourceId]", input.fundingSourceId);
    params.set("payment_intent_data[metadata][fundingSourceId]", input.fundingSourceId);
  }

  const paymentMethodTypes = input.paymentMethodTypes?.length ? input.paymentMethodTypes : getStripePaymentMethodTypes();

  paymentMethodTypes.forEach((method, index) => {
    params.append(`payment_method_types[${index}]`, method);
  });

  if (paymentMethodTypes.includes("us_bank_account")) {
    params.set("payment_method_options[us_bank_account][setup_future_usage]", "on_session");
    params.append("payment_method_options[us_bank_account][financial_connections][permissions][0]", "payment_method");
    params.append("payment_method_options[us_bank_account][financial_connections][permissions][1]", "balances");
    params.append("payment_method_options[us_bank_account][financial_connections][permissions][2]", "ownership");
    params.append("payment_method_options[us_bank_account][financial_connections][prefetch][0]", "balances");
    params.append("payment_method_options[us_bank_account][financial_connections][prefetch][1]", "ownership");
  }

  const session = await postStripeForm<StripeCheckoutSessionResponse>({
    body: params,
    path: "/v1/checkout/sessions",
    requestId: input.requestId
  });

  if (!session.url) {
    throw new StripeRequestError("Stripe did not return a checkout URL.", 502, session);
  }

  return session;
}

export async function getStripeCheckoutSession(sessionId: string, requestId: string) {
  const session = await getStripe<StripeCheckoutSessionResponse>({
    path: `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    requestId
  });

  return session;
}

export async function createStripeCustomer(input: { email: string; name?: string | null; requestId: string; userId: string }) {
  const params = new URLSearchParams({
    email: input.email,
    "metadata[userId]": input.userId
  });

  if (input.name) {
    params.set("name", input.name);
  }

  return postStripeForm<StripeCustomerResponse>({
    body: params,
    path: "/v1/customers",
    requestId: input.requestId
  });
}

export async function attachStripeBankAccountToken(input: { customerId: string; requestId: string; stripeBankAccountToken: string }) {
  const params = new URLSearchParams({
    source: input.stripeBankAccountToken
  });

  return postStripeForm<StripeBankAccountResponse>({
    body: params,
    path: `/v1/customers/${encodeURIComponent(input.customerId)}/sources`,
    requestId: input.requestId
  });
}

export function parseStripeWebhookEvent(rawBody: Buffer, signature: string | undefined) {
  verifyStripeWebhookSignature(rawBody, signature);

  return JSON.parse(rawBody.toString("utf8")) as StripeEvent;
}

export function verifyStripeWebhookSignature(rawBody: Buffer, signature: string | undefined, now = Math.floor(Date.now() / 1000)) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();

  if (!webhookSecret) {
    throw new StripeConfigurationError("Stripe webhook verification is not configured. Add STRIPE_WEBHOOK_SECRET.");
  }

  const parts = new Map<string, string[]>();

  for (const segment of signature?.split(",") ?? []) {
    const [key, value] = segment.split("=");

    if (!key || !value) {
      continue;
    }

    const values = parts.get(key) ?? [];
    values.push(value);
    parts.set(key, values);
  }

  const timestamp = Number(parts.get("t")?.[0]);
  const signatures = parts.get("v1") ?? [];

  if (!Number.isFinite(timestamp) || signatures.length === 0) {
    throw new StripeRequestError("Stripe webhook signature header is malformed.", 400);
  }

  if (Math.abs(now - timestamp) > 300) {
    throw new StripeRequestError("Stripe webhook signature timestamp is outside the tolerance window.", 400);
  }

  const expected = createHmac("sha256", webhookSecret).update(`${timestamp}.${rawBody.toString("utf8")}`).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const matched = signatures.some((candidate) => {
    const candidateBuffer = Buffer.from(candidate, "hex");

    return candidateBuffer.length === expectedBuffer.length && timingSafeEqual(candidateBuffer, expectedBuffer);
  });

  if (!matched) {
    throw new StripeRequestError("Stripe webhook signature verification failed.", 401);
  }
}

export function getStripeCheckoutSessionSummary(session: unknown): StripeCheckoutSessionSummary | null {
  if (!isPlainObject(session)) {
    return null;
  }

  const amountTotal = typeof session.amount_total === "number" ? session.amount_total : null;
  const currency = getString(session.currency)?.toUpperCase();
  const metadata = isPlainObject(session.metadata) ? session.metadata : null;
  const paymentIntentId = getString(metadata?.paymentIntentId);
  const providerPaymentIntentId = getString(session.payment_intent);
  const sessionId = getString(session.id);
  const status = getString(session.payment_status) ?? getString(session.status);

  if (!amountTotal || !currency || !sessionId || !status) {
    return null;
  }

  return {
    amount: (amountTotal / 100).toFixed(2),
    currency,
    paymentIntentId,
    providerPaymentIntentId,
    sessionId,
    status
  };
}

export function getStripeWebhookCheckoutSession(event: unknown) {
  if (!isPlainObject(event) || !isCheckoutSessionWebhookType(event.type)) {
    return null;
  }

  const data = isPlainObject(event.data) ? event.data : null;

  return data?.object ?? null;
}

function isCheckoutSessionWebhookType(type: unknown) {
  return (
    type === "checkout.session.completed" ||
    type === "checkout.session.async_payment_succeeded" ||
    type === "checkout.session.async_payment_failed" ||
    type === "checkout.session.expired"
  );
}

function getStripePaymentMethodTypes() {
  const configured = process.env.STRIPE_CHECKOUT_PAYMENT_METHODS?.split(",")
    .map((method) => method.trim().toLowerCase())
    .filter(Boolean);

  return configured?.length ? configured : ["card"];
}

function getStripeSecretKey() {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();

  if (!secretKey) {
    throw new StripeConfigurationError();
  }

  return secretKey;
}

async function getStripe<T>(input: { path: string; requestId: string }) {
  const response = await fetch(`${getStripeApiBaseUrl()}${input.path}`, {
    headers: {
      Authorization: `Bearer ${getStripeSecretKey()}`,
      "Idempotency-Key": input.requestId
    },
    method: "GET"
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };

  if (!response.ok) {
    throw new StripeRequestError(payload.error?.message ?? "Stripe request failed.", response.status, payload);
  }

  return payload;
}

async function postStripeForm<T>(input: { body: URLSearchParams; path: string; requestId: string }) {
  const response = await fetch(`${getStripeApiBaseUrl()}${input.path}`, {
    body: input.body,
    headers: {
      Authorization: `Bearer ${getStripeSecretKey()}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": input.requestId
    },
    method: "POST"
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error?: { message?: string } };

  if (!response.ok) {
    throw new StripeRequestError(payload.error?.message ?? "Stripe request failed.", response.status, payload);
  }

  return payload;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
