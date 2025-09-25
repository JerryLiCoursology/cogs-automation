import type { LoaderFunctionArgs } from "@remix-run/node";
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

function getSuccessHtml() {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Facebook Connection Successful</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
          .success { color: #00851a; }
          .spinner { border: 4px solid #f3f3f3; border-top: 4px solid #3498db; border-radius: 50%; width: 20px; height: 20px; animation: spin 2s linear infinite; margin: 20px auto; }
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        </style>
      </head>
      <body>
        <div class="success">
          <h2>✅ Facebook Connected Successfully!</h2>
          <div class="spinner"></div>
          <p>Redirecting back to the app...</p>
        </div>
        <script>
          setTimeout(() => {
            if (window.opener) {
              window.opener.postMessage({ type: 'FACEBOOK_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = "/app/facebook/connect";
            }
          }, 1500);
        </script>
      </body>
    </html>
  `;
}

function getErrorHtml(errorMessage: string) {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Facebook Connection Failed</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
          .error { color: #d73d32; }
        </style>
      </head>
      <body>
        <div class="error">
          <h2>❌ Facebook Connection Failed</h2>
          <p>${errorMessage}</p>
          <p>Please close this window and try again.</p>
        </div>
        <script>
          setTimeout(() => {
            if (window.opener) {
              window.opener.postMessage({ type: 'FACEBOOK_AUTH_ERROR', error: '${errorMessage}' }, '*');
              window.close();
            } else {
              window.location.href = "/app/facebook/connect?error=oauth_callback_failed";
            }
          }, 3000);
        </script>
      </body>
    </html>
  `;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    console.error("Facebook OAuth error:", error);
    return new Response(getErrorHtml("Facebook authorization was denied"), {
      headers: { "Content-Type": "text/html" },
    });
  }

  if (!code || !state) {
    console.error("Missing authorization code or state parameter");
    return new Response(getErrorHtml("Invalid authorization response"), {
      headers: { "Content-Type": "text/html" },
    });
  }

  // Decode state to get session ID
  let sessionData;
  try {
    sessionData = JSON.parse(Buffer.from(state, 'base64').toString());
  } catch {
    console.error("Invalid state parameter");
    return new Response(getErrorHtml("Invalid authentication state"), {
      headers: { "Content-Type": "text/html" },
    });
  }

  const { sessionId } = sessionData;

  // Get session from database to verify it exists
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    console.error("Session not found for ID:", sessionId);
    return new Response(getErrorHtml("Session expired. Please try connecting again."), {
      headers: { "Content-Type": "text/html" },
    });
  }

  // Exchange code for access token
  const facebookAppId = process.env.FACEBOOK_APP_ID;
  const facebookAppSecret = process.env.FACEBOOK_APP_SECRET;
  const redirectUri = process.env.FACEBOOK_REDIRECT_URI || `${process.env.SHOPIFY_APP_URL}/auth/facebook/callback`;

  if (!facebookAppId || !facebookAppSecret) {
    console.error("Facebook app credentials not configured");
    return new Response(getErrorHtml("Facebook app configuration missing"), {
      headers: { "Content-Type": "text/html" },
    });
  }

  try {
    // Get short-lived access token
    const tokenResponse = await axios.get<FacebookTokenResponse>(
      "https://graph.facebook.com/v23.0/oauth/access_token",
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
      "https://graph.facebook.com/v23.0/oauth/access_token",
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
      "https://graph.facebook.com/v23.0/me",
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

    // Return success page that closes popup and refreshes parent
    return new Response(getSuccessHtml(), {
      headers: {
        "Content-Type": "text/html",
      },
    });

  } catch (error) {
    console.error("Facebook OAuth callback error:", error);

    // Return error page that closes popup
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return new Response(getErrorHtml(errorMessage), {
      headers: {
        "Content-Type": "text/html",
      },
    });
  }
};