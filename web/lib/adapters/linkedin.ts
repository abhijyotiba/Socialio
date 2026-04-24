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

// Exported for testing. Builds the UGC post request body.
export function buildLinkedInPostBody(
  authorUrn: string,
  text: string,
  mediaUrns?: string[]
) {
  const shareContent: Record<string, unknown> = {
    shareCommentary: { text },
    shareMediaCategory: mediaUrns && mediaUrns.length > 0 ? "IMAGE" : "NONE",
  };

  if (mediaUrns && mediaUrns.length > 0) {
    shareContent.media = mediaUrns.map((urn) => ({
      status: "READY",
      media: urn,
    }));
  }

  return {
    author: authorUrn,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": shareContent,
    },
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
    },
  };
}

const RegisterUploadResponseSchema = z.object({
  value: z.object({
    uploadMechanism: z.object({
      "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest": z.object({
        uploadUrl: z.string(),
      }),
    }),
    asset: z.string(), // e.g. "urn:li:digitalmediaAsset:ABC123"
  }),
});

// Step 1 of LinkedIn media upload: register and get upload URL + asset URN.
export async function registerLinkedInUpload(
  accessToken: string,
  authorUrn: string,
  fileSizeBytes: number
): Promise<{ uploadUrl: string; assetUrn: string }> {
  const body = {
    registerUploadRequest: {
      recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
      owner: authorUrn,
      serviceRelationships: [
        {
          relationshipType: "OWNER",
          identifier: "urn:li:userGeneratedContent",
        },
      ],
      supportedUploadMechanism: ["SYNCHRONOUS_UPLOAD"],
      fileSize: fileSizeBytes,
    },
  };

  const response = await fetch(
    "https://api.linkedin.com/v2/assets?action=registerUpload",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    throw new Error(`LinkedIn registerUpload failed: ${response.status}`);
  }

  const parsed = RegisterUploadResponseSchema.parse(await response.json());
  return {
    uploadUrl:
      parsed.value.uploadMechanism[
        "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"
      ].uploadUrl,
    assetUrn: parsed.value.asset,
  };
}

// Step 2 of LinkedIn media upload: PUT the image bytes to the pre-signed upload URL.
// No Authorization header — LinkedIn pre-signs the URL.
export async function uploadBytesToLinkedIn(
  uploadUrl: string,
  imageBytes: Buffer
): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: new Uint8Array(imageBytes),
  });

  if (!response.ok) {
    throw new Error(`LinkedIn binary upload failed: ${response.status}`);
  }
}

export async function publishLinkedInPost(
  accessToken: string,
  authorUrn: string,
  text: string,
  idempotencyKey: string,
  mediaUrns?: string[]
): Promise<{ platformPostId: string; platformPostUrl: string }> {
  const body = buildLinkedInPostBody(authorUrn, text, mediaUrns);

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

export async function getPostMetrics(
  accessToken: string,
  authorUrn: string,
  platformPostId: string // e.g. urn:li:share:123456
): Promise<{ impressions: number; likes: number; comments: number; shares: number }> {
  // LinkedIn requires fetching Organizational Entity Share Statistics or relying on 
  // Member organizational stats depending on the URN type.
  // For V1, this simulates fetching from the LinkedIn Network Statistics endpoint
  const url = `https://api.linkedin.com/rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(
    authorUrn
  )}&shares[0]=${encodeURIComponent(platformPostId)}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-Restli-Protocol-Version": "2.0.0",
      "LinkedIn-Version": "202304", // Set required API version header
    },
  });

  if (!response.ok) {
    if (response.status === 404) throw new Error("POST_DELETED");
    if (response.status === 401) throw new Error("TOKEN_EXPIRED");
    throw new Error(`LinkedIn metrics fetch failed: ${response.status}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = await response.json();
  const metrics = body?.elements?.[0]?.totalShareStatistics || {};

  return {
    impressions: metrics.impressionCount || 0,
    likes: metrics.likeCount || 0,
    comments: metrics.commentCount || 0,
    shares: metrics.shareCount || 0,
  };
}

function classifyLinkedInError(status: number, _body: unknown): string {
  if (status === 401) return "TOKEN_EXPIRED";
  if (status === 429) return "RATE_LIMITED";
  if (status === 422 || status === 400) return "CONTENT_POLICY";
  if (status >= 500) return "SERVER_ERROR";
  return "UNKNOWN";
}

const RefreshResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
});

export type LinkedInRefreshResponse = z.infer<typeof RefreshResponseSchema>;

export async function refreshLinkedInToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresIn: number; newRefreshToken?: string }> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: process.env.LINKEDIN_CLIENT_ID!,
    client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
  });

  const response = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(`LinkedIn token refresh failed: ${response.status}`);
  }

  const data = RefreshResponseSchema.parse(await response.json());
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
    newRefreshToken: data.refresh_token,
  };
}
