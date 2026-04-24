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

const MediaUploadResponseSchema = z.object({
  media_id_string: z.string(),
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

// Exported for testing. Builds the tweet request body.
export function buildTweetBody(
  text: string,
  mediaIds?: string[]
): Record<string, unknown> {
  const body: Record<string, unknown> = { text };
  if (mediaIds && mediaIds.length > 0) {
    body.media = { media_ids: mediaIds };
  }
  return body;
}

// Uploads image bytes to X's v1.1 media/upload endpoint.
// Returns the media_id_string to be attached to the tweet.
export async function uploadMediaToX(
  accessToken: string,
  imageBytes: Buffer,
  mimeType: string
): Promise<string> {
  const form = new FormData();
  form.append(
    "media",
    new Blob([new Uint8Array(imageBytes)], { type: mimeType }),
    "upload"
  );

  const response = await fetch(
    "https://upload.twitter.com/1.1/media/upload.json",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: form,
    }
  );

  if (!response.ok) {
    throw new Error(`X media upload failed: ${response.status}`);
  }

  const data = MediaUploadResponseSchema.parse(await response.json());
  return data.media_id_string;
}

export async function publishTweet(
  accessToken: string,
  text: string,
  mediaIds?: string[]
): Promise<{ platformPostId: string; platformPostUrl: string }> {
  const response = await fetch("https://api.twitter.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildTweetBody(text, mediaIds)),
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

export async function getPostMetrics(
  accessToken: string,
  platformPostId: string
): Promise<{ impressions: number; likes: number; comments: number; shares: number }> {
  // Uses X API v2 standard metrics payload
  const response = await fetch(
    `https://api.twitter.com/2/tweets/${platformPostId}?tweet.fields=public_metrics`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!response.ok) {
    if (response.status === 404) throw new Error("POST_DELETED");
    if (response.status === 401) throw new Error("TOKEN_EXPIRED");
    throw new Error(`X metrics fetch failed: ${response.status}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = await response.json();
  const metrics = body?.data?.public_metrics || {};

  return {
    impressions: metrics.impression_count || 0,
    likes: metrics.like_count || 0,
    comments: metrics.reply_count || 0,
    shares: metrics.retweet_count || 0,
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
