import type { LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import axios from "axios";

interface FacebookTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

interface FacebookUserResponse {
  id: string;
  name: string;
  email: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    throw new Error(`Facebook OAuth error: ${error}`);
  }

  if (!code || !state) {
    throw new Error("Missing authorization code or state parameter");
  }

  // Decode state to get session ID
  let sessionData;
  try {
    sessionData = JSON.parse(Buffer.from(state, 'base64').toString());
  } catch {
    throw new Error("Invalid state parameter");
  }

  const { sessionId } = sessionData;

  // Verify session exists
  const { session } = await authenticate.admin(request);
  if (!session || session.id !== sessionId) {
    throw new Error("Session mismatch");
  }

  // Exchange code for access token
  const facebookAppId = process.env.FACEBOOK_APP_ID;
  const facebookAppSecret = process.env.FACEBOOK_APP_SECRET;
  const redirectUri = `${process.env.SHOPIFY_APP_URL}/auth/facebook/callback`;

  if (!facebookAppId || !facebookAppSecret) {
    throw new Error("Facebook app credentials not configured");
  }

  try {
    // Get short-lived access token
    const tokenResponse = await axios.get<FacebookTokenResponse>(
      "https://graph.facebook.com/v18.0/oauth/access_token",
      {
        params: {
          client_id: facebookAppId,
          client_secret: facebookAppSecret,
          redirect_uri: redirectUri,
          code,
        },
      }
    );

    const { access_token, expires_in } = tokenResponse.data;

    // Exchange for long-lived access token
    const longLivedTokenResponse = await axios.get<FacebookTokenResponse>(
      "https://graph.facebook.com/v18.0/oauth/access_token",
      {
        params: {
          grant_type: "fb_exchange_token",
          client_id: facebookAppId,
          client_secret: facebookAppSecret,
          fb_exchange_token: access_token,
        },
      }
    );

    const longLivedToken = longLivedTokenResponse.data.access_token;
    const tokenExpiresAt = expires_in
      ? new Date(Date.now() + expires_in * 1000)
      : null;

    // Get user information
    const userResponse = await axios.get<FacebookUserResponse>(
      "https://graph.facebook.com/v18.0/me",
      {
        params: {
          access_token: longLivedToken,
          fields: "id,name,email",
        },
      }
    );

    const { id: metaUserId, name: metaUserName, email: metaEmail } = userResponse.data;

    // Store Meta data in database
    await prisma.meta.upsert({
      where: { sessionId },
      update: {
        metaUserId,
        metaUserName,
        metaEmail,
        accessToken: longLivedToken,
        tokenExpiresAt,
        permissions: JSON.stringify([]), // Will be updated after pixel selection
        pixelId: "", // Will be set during pixel selection
        updatedAt: new Date(),
      },
      create: {
        sessionId,
        metaUserId,
        metaUserName,
        metaEmail,
        accessToken: longLivedToken,
        tokenExpiresAt,
        permissions: JSON.stringify([]),
        pixelId: "", // Will be set during pixel selection
      },
    });

    // Redirect to pixel selection page
    return redirect("/app/facebook/connect");

  } catch (error) {
    console.error("Facebook OAuth callback error:", error);
    throw new Error("Failed to complete Facebook authentication");
  }
};