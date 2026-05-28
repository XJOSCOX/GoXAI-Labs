type PlaidLinkTokenResponse = {
  expiration?: string;
  link_token?: string;
  request_id?: string;
};

type PlaidPublicTokenExchangeResponse = {
  access_token?: string;
  item_id?: string;
  request_id?: string;
};

type PlaidStripeBankAccountTokenResponse = {
  request_id?: string;
  stripe_bank_account_token?: string;
};

export class PlaidConfigurationError extends Error {
  constructor(message = "Plaid is not configured. Add PLAID_CLIENT_ID and PLAID_SECRET.") {
    super(message);
  }
}

export class PlaidRequestError extends Error {
  constructor(message: string, readonly status = 502, readonly payload: unknown = null) {
    super(message);
  }
}

export function getPlaidApiBaseUrl(environment = process.env.PLAID_ENV, override = process.env.PLAID_API_BASE_URL) {
  if (override?.trim()) {
    return override.trim().replace(/\/$/, "");
  }

  if (environment === "production") {
    return "https://production.plaid.com";
  }

  if (environment === "development") {
    return "https://development.plaid.com";
  }

  return "https://sandbox.plaid.com";
}

export async function createPlaidLinkToken(input: { clientUserId: string; userEmail: string }) {
  const response = await postPlaid<PlaidLinkTokenResponse>({
    body: {
      client_name: "GoXAi Lab",
      country_codes: ["US"],
      language: "en",
      products: ["auth"],
      user: {
        client_user_id: input.clientUserId,
        email_address: input.userEmail
      }
    },
    path: "/link/token/create"
  });

  if (!response.link_token) {
    throw new PlaidRequestError("Plaid did not return a Link token.", 502, response);
  }

  return {
    expiration: response.expiration ?? null,
    linkToken: response.link_token,
    requestId: response.request_id ?? null
  };
}

export async function createPlaidStripeBankAccountToken(input: { accountId: string; publicToken: string }) {
  const exchange = await postPlaid<PlaidPublicTokenExchangeResponse>({
    body: {
      public_token: input.publicToken
    },
    path: "/item/public_token/exchange"
  });

  if (!exchange.access_token) {
    throw new PlaidRequestError("Plaid did not return an access token.", 502, exchange);
  }

  const stripeToken = await postPlaid<PlaidStripeBankAccountTokenResponse>({
    body: {
      access_token: exchange.access_token,
      account_id: input.accountId
    },
    path: "/processor/stripe/bank_account_token/create"
  });

  if (!stripeToken.stripe_bank_account_token) {
    throw new PlaidRequestError("Plaid did not return a Stripe bank account token.", 502, stripeToken);
  }

  return {
    itemId: exchange.item_id ?? null,
    requestId: stripeToken.request_id ?? exchange.request_id ?? null,
    stripeBankAccountToken: stripeToken.stripe_bank_account_token
  };
}

function getPlaidConfig() {
  const clientId = process.env.PLAID_CLIENT_ID?.trim();
  const secret = process.env.PLAID_SECRET?.trim();

  if (!clientId || !secret) {
    throw new PlaidConfigurationError();
  }

  return {
    baseUrl: getPlaidApiBaseUrl(),
    clientId,
    secret
  };
}

async function postPlaid<T>(input: { body: Record<string, unknown>; path: string }) {
  const config = getPlaidConfig();
  const response = await fetch(`${config.baseUrl}${input.path}`, {
    body: JSON.stringify({
      client_id: config.clientId,
      secret: config.secret,
      ...input.body
    }),
    headers: {
      "Content-Type": "application/json"
    },
    method: "POST"
  });
  const payload = (await response.json().catch(() => ({}))) as T & { error_message?: string; error_code?: string };

  if (!response.ok) {
    throw new PlaidRequestError(payload.error_message ?? payload.error_code ?? "Plaid request failed.", response.status, payload);
  }

  return payload;
}
