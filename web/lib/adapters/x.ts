import { z } from "zod";

const TokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  scope: z.string(),
});

export type XTokenResponse = z.infer<typeof TokenResponseSchema>;

const UserInfoSchema = z.object({
  data: z.object({
    id: z.string(),
    name: z.string(),
    username: z.string(),
  }),
});

export type XUserInfo = z.infer<typeof UserInfoSchema>;

const PublishResponseSchema = z.object({
  data: z.object({
    id: z.string(),
    text: z.string(),
  }),
});

export function buildAuthorizationUrl(
  state: string,
  codeChallenge: string
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.X_CLIENT_ID!,
    redirect_uri: process.env.X_REDIRECT_URI!,
    scope: "tweet.write users.read offline.access",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `https://twitter.com/i/oauth2/authorize?${params}`;
}

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string
): Promise<XTokenResponse> {
  const credentials = Buffer.from(
    `${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`
  ).toString("base64");

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: process.env.X_REDIRECT_URI!,
    code_verifier: codeVerifier,
  });

  const response = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(`X token exchange failed: ${response.status}`);
  }

  return TokenResponseSchema.parse(await response.json());
}

export async function getUserInfo(accessToken: string): Promise<XUserInfo> {
  const response = await fetch("https://api.twitter.com/2/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`X userinfo fetch failed: ${response.status}`);
  }

  return UserInfoSchema.parse(await response.json());
}

export async function publishTweet(
  accessToken: string,
  text: string
): Promise<{ platformPostId: string; platformPostUrl: string }> {
  const response = await fetch("https://api.twitter.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- error body shape varies
    const body = await response.json().catch(() => ({}) as any);
    const errorCode = classifyXError(response.status, body);
    throw Object.assign(new Error(`X publish failed: ${response.status}`), {
      errorCode,
    });
  }

  const data = PublishResponseSchema.parse(await response.json());
  const postId = data.data.id;
  return {
    platformPostId: postId,
    platformPostUrl: `https://x.com/i/web/status/${postId}`,
  };
}

function classifyXError(status: number, _body: unknown): string {
  if (status === 401) return "TOKEN_EXPIRED";
  if (status === 429) return "RATE_LIMITED";
  if (status === 403) return "CONTENT_POLICY";
  if (status >= 500) return "SERVER_ERROR";
  return "UNKNOWN";
}

const RefreshResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
});

export async function refreshXToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresIn?: number; newRefreshToken?: string }> {
  const credentials = Buffer.from(
    `${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`
  ).toString("base64");

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(`X token refresh failed: ${response.status}`);
  }

  const data = RefreshResponseSchema.parse(await response.json());
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
    newRefreshToken: data.refresh_token,
  };
}
