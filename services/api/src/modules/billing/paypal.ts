type PayPalConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
};

type PayPalLink = {
  href: string;
  method?: string;
  rel: string;
};

type PayPalOrderResponse = {
  id: string;
  links?: PayPalLink[];
  status: string;
};

type PayPalCaptureResponse = {
  id: string;
  purchase_units?: Array<{
    payments?: {
      captures?: Array<{
        amount?: {
          currency_code?: string;
          value?: string;
        };
        id: string;
        status: string;
      }>;
    };
  }>;
  status: string;
};

type PayPalWebhookVerificationResponse = {
  verification_status?: string;
};

type PayPalWebhookHeaders = {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
};

export type PayPalCaptureSummary = {
  captureId: string;
  currency: string;
  status: string;
  value: string;
};

export type PayPalWebhookCaptureSummary = {
  captureId: string;
  currency: string;
  orderId: string | null;
  paymentIntentId: string | null;
  status: string;
  value: string;
};

export class PayPalConfigurationError extends Error {
  constructor(message = "PayPal is not configured. Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.") {
    super(message);
  }
}

export class PayPalRequestError extends Error {
  constructor(message: string, readonly status = 502, readonly payload: unknown = null) {
    super(message);
  }
}

export function getPayPalApiBaseUrl(environment = process.env.PAYPAL_ENVIRONMENT, override = process.env.PAYPAL_API_BASE_URL) {
  if (override?.trim()) {
    return override.trim().replace(/\/$/, "");
  }

  return environment === "live" || environment === "production" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

export function getPayPalApprovalUrl(order: { links?: PayPalLink[] }) {
  return order.links?.find((link) => link.rel === "approve" || link.rel === "payer-action")?.href ?? null;
}

export function getPayPalCaptureSummary(capture: PayPalCaptureResponse): PayPalCaptureSummary | null {
  const completedCapture = capture.purchase_units
    ?.flatMap((unit) => unit.payments?.captures ?? [])
    .find((entry) => entry.status === "COMPLETED");

  if (!completedCapture?.amount?.currency_code || !completedCapture.amount.value) {
    return null;
  }

  return {
    captureId: completedCapture.id,
    currency: completedCapture.amount.currency_code,
    status: completedCapture.status,
    value: completedCapture.amount.value
  };
}

export function getPayPalWebhookCaptureSummary(event: unknown): PayPalWebhookCaptureSummary | null {
  if (!isPlainObject(event)) {
    return null;
  }

  const resource = event.resource;

  if (!isPlainObject(resource)) {
    return null;
  }

  const amount = isPlainObject(resource.amount) ? resource.amount : null;
  const supplementaryData = isPlainObject(resource.supplementary_data) ? resource.supplementary_data : null;
  const relatedIds = supplementaryData && isPlainObject(supplementaryData.related_ids) ? supplementaryData.related_ids : null;
  const captureId = getString(resource.id);
  const currency = getString(amount?.currency_code);
  const orderId = getString(relatedIds?.order_id);
  const paymentIntentId = getString(resource.custom_id);
  const status = getString(resource.status);
  const value = getString(amount?.value);

  if (!captureId || !currency || !status || !value) {
    return null;
  }

  return {
    captureId,
    currency,
    orderId,
    paymentIntentId,
    status,
    value
  };
}

export async function createPayPalOrder(input: {
  amount: string;
  cancelUrl: string;
  currency: string;
  description: string;
  paymentIntentId: string;
  requestId: string;
  returnUrl: string;
}) {
  const accessToken = await getPayPalAccessToken();
  const order = await postPayPal<PayPalOrderResponse>({
    accessToken,
    body: {
      intent: "CAPTURE",
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "GoXAi Lab",
            cancel_url: input.cancelUrl,
            landing_page: "NO_PREFERENCE",
            return_url: input.returnUrl,
            shipping_preference: "NO_SHIPPING",
            user_action: "PAY_NOW"
          }
        }
      },
      purchase_units: [
        {
          amount: {
            currency_code: input.currency,
            value: input.amount
          },
          custom_id: input.paymentIntentId,
          description: input.description,
          reference_id: input.paymentIntentId
        }
      ]
    },
    path: "/v2/checkout/orders",
    requestId: input.requestId
  });
  const approvalUrl = getPayPalApprovalUrl(order);

  if (!approvalUrl) {
    throw new PayPalRequestError("PayPal did not return an approval URL.", 502, order);
  }

  return {
    approvalUrl,
    order
  };
}

export async function capturePayPalOrder(orderId: string, requestId: string) {
  const accessToken = await getPayPalAccessToken();

  return postPayPal<PayPalCaptureResponse>({
    accessToken,
    body: {},
    path: `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
    requestId
  });
}

export async function verifyPayPalWebhookSignature(headers: PayPalWebhookHeaders, webhookEvent: unknown) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID?.trim();

  if (!webhookId) {
    throw new PayPalConfigurationError("PayPal webhook verification is not configured. Add PAYPAL_WEBHOOK_ID.");
  }

  const accessToken = await getPayPalAccessToken();
  const result = await postPayPal<PayPalWebhookVerificationResponse>({
    accessToken,
    body: {
      auth_algo: headers.authAlgo,
      cert_url: headers.certUrl,
      transmission_id: headers.transmissionId,
      transmission_sig: headers.transmissionSig,
      transmission_time: headers.transmissionTime,
      webhook_event: webhookEvent,
      webhook_id: webhookId
    },
    path: "/v1/notifications/verify-webhook-signature",
    requestId: headers.transmissionId
  });

  return result.verification_status === "SUCCESS";
}

function getPayPalConfig(): PayPalConfig {
  const clientId = process.env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new PayPalConfigurationError();
  }

  return {
    baseUrl: getPayPalApiBaseUrl(),
    clientId,
    clientSecret
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function getPayPalAccessToken() {
  const config = getPayPalConfig();
  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const response = await fetch(`${config.baseUrl}/v1/oauth2/token`, {
    body: new URLSearchParams({
      grant_type: "client_credentials"
    }),
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    method: "POST"
  });
  const payload = (await response.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };

  if (!response.ok || !payload.access_token) {
    throw new PayPalRequestError(payload.error_description ?? payload.error ?? "Unable to authenticate with PayPal.", 502, payload);
  }

  return payload.access_token;
}

async function postPayPal<T>(input: { accessToken: string; body: unknown; path: string; requestId: string }) {
  const config = getPayPalConfig();
  const response = await fetch(`${config.baseUrl}${input.path}`, {
    body: JSON.stringify(input.body),
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": input.requestId
    },
    method: "POST"
  });
  const payload = (await response.json().catch(() => ({}))) as T & { message?: string; name?: string };

  if (!response.ok) {
    throw new PayPalRequestError(payload.message ?? payload.name ?? "PayPal request failed.", 502, payload);
  }

  return payload;
}
