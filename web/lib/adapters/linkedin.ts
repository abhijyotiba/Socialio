import { z } from "zod";

const TokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
  refresh_token_expires_in: z.number().optional(),
  scope: z.string(),
});

export type LinkedInTokenResponse = z.infer<typeof TokenResponseSchema>;

const UserInfoSchema = z.object({
  sub: z.string(),
  name: z.string().optional(),
  given_name: z.string().optional(),
  family_name: z.string().optional(),
  email: z.string().optional(),
  picture: z.string().optional(),
});

export type LinkedInUserInfo = z.infer<typeof UserInfoSchema>;

export function buildAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.LINKEDIN_CLIENT_ID!,
    redirect_uri: process.env.LINKEDIN_REDIRECT_URI!,
    // openid + profile + email for userinfo; w_member_social for UGC posting (requires LinkedIn partner approval)
    scope: "openid profile email w_member_social",
    state,
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${params}`;
}

export async function exchangeCodeForTokens(
  code: string
): Promise<LinkedInTokenResponse> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: process.env.LINKEDIN_REDIRECT_URI!,
    client_id: process.env.LINKEDIN_CLIENT_ID!,
    client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
  });

  const response = await fetch(
    "https://www.linkedin.com/oauth/v2/accessToken",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    }
  );

  if (!response.ok) {
    throw new Error(`LinkedIn token exchange failed: ${response.status}`);
  }

  return TokenResponseSchema.parse(await response.json());
}

export async function getUserInfo(
  accessToken: string
): Promise<LinkedInUserInfo> {
  const response = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`LinkedIn userinfo fetch failed: ${response.status}`);
  }

  return UserInfoSchema.parse(await response.json());
}

export async function publishLinkedInPost(
  accessToken: string,
  authorUrn: string,
  text: string,
  idempotencyKey: string
): Promise<{ platformPostId: string; platformPostUrl: string }> {
  const body = {
    author: authorUrn,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text },
        shareMediaCategory: "NONE",
      },
    },
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
    },
  };

  const response = await fetch("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
      "X-RestLi-Request-Id": idempotencyKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- error body shape varies
    const errorBody = await response.json().catch(() => ({}) as any);
    const errorCode = classifyLinkedInError(response.status, errorBody);
    throw Object.assign(
      new Error(`LinkedIn publish failed: ${response.status}`),
      { errorCode }
    );
  }

  const postUrn = response.headers.get("x-restli-id") ?? "";
  return {
    platformPostId: postUrn,
    platformPostUrl: `https://www.linkedin.com/feed/update/${postUrn}/`,
  };
}

function classifyLinkedInError(status: number, _body: unknown): string {
  if (status === 401) return "TOKEN_EXPIRED";
  if (status === 429) return "RATE_LIMITED";
  if (status === 422 || status === 400) return "CONTENT_POLICY";
  if (status >= 500) return "SERVER_ERROR";
  return "UNKNOWN";
}
