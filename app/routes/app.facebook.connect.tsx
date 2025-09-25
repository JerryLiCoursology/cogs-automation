import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Text,
  Button,
  Banner,
  InlineStack,
  BlockStack,
  Box,
  Select,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { MetaApiService } from "../services/meta-api.server";
import type { MetaPixel, MetaAdAccount, MetaBusiness } from "../services/meta-api.server";
import { MarketingIntegrationService } from "../services/marketing-integration.server";

interface LoaderData {
  metaConnection: {
    id: string;
    metaUserName: string;
    metaEmail: string;
    pixelId?: string;
    pixelName?: string;
    businessId?: string;
    adAccountId?: string;
    permissions: string[];
  } | null;
  pixels: MetaPixel[];
  adAccounts: MetaAdAccount[];
  businesses: MetaBusiness[];
  connectionTest: {
    success: boolean;
    error?: string;
    permissions: string[];
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  let session;
  try {
    const auth = await authenticate.admin(request);
    session = auth.session;

    if (!session) {
      throw redirect("/app");
    }
  } catch (error) {
    // If authentication fails, redirect to app home
    if (error instanceof Response) throw error;
    throw redirect("/app");
  }

  // OAuth callback is handled in meta-callback route

  // Check if user has a Meta connection
  const metaConnection = await prisma.meta.findUnique({
    where: { sessionId: session.id },
  });

  if (!metaConnection) {
    // Return data indicating no connection exists
    return json<LoaderData>({
      metaConnection: null,
      pixels: [],
      adAccounts: [],
      businesses: [],
      connectionTest: {
        success: false,
        error: undefined, // Don't show error for missing connection
        permissions: [],
      },
    });
  }

  // Initialize Meta API service
  const metaApi = new MetaApiService(metaConnection.accessToken);

  try {
    // Test the connection and get permissions
    const connectionTest = await metaApi.testConnection();

    if (!connectionTest.success) {
      throw new Error(connectionTest.error || "Failed to connect to Meta API");
    }

    // Fetch user's pixels, ad accounts, and businesses
    const { pixels, adAccounts, businesses } = await metaApi.getUserPixelsAndAccounts();

    // Parse permissions from database
    const permissions = metaConnection.permissions
      ? JSON.parse(metaConnection.permissions)
      : [];

    return json<LoaderData>({
      metaConnection: {
        id: metaConnection.id,
        metaUserName: metaConnection.metaUserName || "",
        metaEmail: metaConnection.metaEmail || "",
        pixelId: metaConnection.pixelId || undefined,
        pixelName: metaConnection.pixelName || undefined,
        businessId: metaConnection.businessId || undefined,
        adAccountId: metaConnection.adAccountId || undefined,
        permissions,
      },
      pixels,
      adAccounts,
      businesses,
      connectionTest,
    });
  } catch (error) {
    console.error("Meta API error:", error);

    return json<LoaderData>({
      metaConnection: {
        id: metaConnection.id,
        metaUserName: metaConnection.metaUserName || "",
        metaEmail: metaConnection.metaEmail || "",
        permissions: [],
      },
      pixels: [],
      adAccounts: [],
      businesses: [],
      connectionTest: {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        permissions: [],
      },
    });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  let session;
  try {
    const auth = await authenticate.admin(request);
    session = auth.session;

    if (!session) {
      return json({ error: "Authentication required" }, { status: 401 });
    }
  } catch (error) {
    console.error("Authentication error:", error);
    return json({ error: "Authentication failed" }, { status: 401 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "selectPixel") {
    const pixelId = formData.get("pixelId") as string;
    const adAccountId = formData.get("adAccountId") as string || null;
    const businessId = formData.get("businessId") as string || null;

    if (!pixelId) {
      return json({ error: "Pixel ID is required" }, { status: 400 });
    }

    // Get Meta connection
    const metaConnection = await prisma.meta.findUnique({
      where: { sessionId: session.id },
    });

    if (!metaConnection) {
      return json({ error: "Meta connection not found" }, { status: 404 });
    }

    try {
      // Get pixel details
      const metaApi = new MetaApiService(metaConnection.accessToken);
      const pixelDetails = await metaApi.getPixelDetails(pixelId);

      // Update Meta connection with selected pixel
      await prisma.meta.update({
        where: { id: metaConnection.id },
        data: {
          pixelId,
          pixelName: pixelDetails.name,
          adAccountId,
          businessId,
          permissions: JSON.stringify([
            "ads_management",
            "business_management",
            "read_insights",
            "pages_show_list",
            "email",
            "public_profile",
          ]),
          updatedAt: new Date(),
        },
      });

      // Create Shopify marketing activity for Facebook CAPI integration
      try {
        const marketingIntegration = new MarketingIntegrationService(
          session.shop,
          session.accessToken
        );

        const marketingResult = await marketingIntegration.initializeFacebookIntegration({
          pixelId,
          pixelName: pixelDetails.name,
          businessId: businessId || undefined,
          adAccountId: adAccountId || undefined,
          sessionId: session.id,
        });

        return json({
          success: true,
          marketingActivity: marketingResult.success ? marketingResult.marketingActivity : null,
          marketingWarning: !marketingResult.success ? marketingResult.error : null,
        });
      } catch (marketingError) {
        console.warn("Marketing integration failed, but pixel selection succeeded:", marketingError);
        return json({
          success: true,
          marketingWarning: "Pixel connected successfully, but marketing integration failed. You may need to reinstall the app with marketing permissions.",
        });
      }
    } catch (error) {
      console.error("Error selecting pixel:", error);
      return json(
        { error: "Failed to select pixel" },
        { status: 500 }
      );
    }
  }

  if (intent === "disconnect") {
    try {
      // Delete Meta connection
      await prisma.meta.delete({
        where: { sessionId: session.id },
      });

      return json({ success: true, disconnected: true });
    } catch (error) {
      console.error("Error disconnecting:", error);
      return json({ success: true, disconnected: true }); // Still return success to clear UI state
    }
  }

  if (intent === "initiateFacebookAuth") {
    console.log("Server: initiateFacebookAuth action called");

    // Generate Facebook OAuth URL and return it to client
    const facebookAppId = process.env.FACEBOOK_APP_ID;
    const redirectUri = process.env.FACEBOOK_REDIRECT_URI || `${process.env.SHOPIFY_APP_URL}/auth/facebook/callback`;

    console.log("Server: Facebook App ID:", facebookAppId ? "***configured***" : "MISSING");
    console.log("Server: Redirect URI:", redirectUri);

    if (!facebookAppId) {
      console.error("Server: Facebook App ID not configured");
      return json({ error: "Facebook App ID not configured" }, { status: 500 });
    }

    // Required scopes for pixel access and CAPI
    const scopes = [
      "ads_management",
      "business_management",
      "read_insights",
      "pages_show_list",
      "email",
      "public_profile"
    ].join(",");

    // Build OAuth URL
    const state = Buffer.from(JSON.stringify({ sessionId: session.id })).toString('base64');

    const facebookAuthUrl = new URL("https://www.facebook.com/v23.0/dialog/oauth");
    facebookAuthUrl.searchParams.set("client_id", facebookAppId);
    facebookAuthUrl.searchParams.set("redirect_uri", redirectUri);
    facebookAuthUrl.searchParams.set("scope", scopes);
    facebookAuthUrl.searchParams.set("state", state);
    facebookAuthUrl.searchParams.set("response_type", "code");

    const authUrlString = facebookAuthUrl.toString();
    console.log("Server: Generated Facebook auth URL:", authUrlString);

    return json({ facebookAuthUrl: authUrlString });
  }

  return json({ error: "Invalid action" }, { status: 400 });
};

export default function FacebookConnect() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [selectedPixelId, setSelectedPixelId] = useState(
    data.metaConnection?.pixelId || ""
  );
  // Remove unused state variables as they're not needed for the simplified UI

  const isConnected = Boolean(data.metaConnection?.pixelId);
  const isLoading = fetcher.state === "submitting";

  const handleFacebookLogin = () => {
    console.log("Facebook login button clicked");

    // Use fetcher to properly handle Shopify authentication
    const formData = new FormData();
    formData.append("intent", "initiateFacebookAuth");

    console.log("Using fetcher to submit Facebook auth request...");
    fetcher.submit(formData, { method: "POST" });
  };


  const handleConfirmSelection = () => {
    if (!selectedPixelId) {
      alert("Please select a pixel first");
      return;
    }

    const formData = new FormData();
    formData.append("intent", "selectPixel");
    formData.append("pixelId", selectedPixelId);

    console.log("Submitting pixel selection:", { selectedPixelId });
    fetcher.submit(formData, { method: "POST" });
  };

  const handleDisconnect = () => {
    const formData = new FormData();
    formData.append("intent", "disconnect");
    fetcher.submit(formData, { method: "POST" });
  };

  // Handle successful actions
  useEffect(() => {
    if (fetcher.data?.success) {
      if (fetcher.data?.disconnected) {
        // Simply reload the page to show disconnected state
        window.location.reload();
      }
    }

    // Handle Facebook auth URL response
    if (fetcher.data?.facebookAuthUrl) {
      console.log("Opening Facebook OAuth popup:", fetcher.data.facebookAuthUrl);

      // Open Facebook OAuth in a new window/tab
      const popup = window.open(fetcher.data.facebookAuthUrl, "_blank", "width=600,height=600,scrollbars=yes,resizable=yes");

      if (!popup) {
        alert("Popup blocked! Please allow popups for this site and try again.");
        return;
      }

      // Listen for messages from the popup
      const handleMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;

        if (event.data.type === 'FACEBOOK_AUTH_SUCCESS') {
          console.log("Facebook auth successful, refreshing page...");
          window.location.reload();
        } else if (event.data.type === 'FACEBOOK_AUTH_ERROR') {
          console.error("Facebook auth error:", event.data.error);
          // Could show an error message here if needed
        }
      };

      window.addEventListener('message', handleMessage);

      // Fallback: Check for popup close to refresh the page
      const checkClosed = setInterval(() => {
        if (popup?.closed) {
          clearInterval(checkClosed);
          window.removeEventListener('message', handleMessage);
          console.log("Popup closed, refreshing page...");
          // Refresh the page to load the new connection data
          setTimeout(() => window.location.reload(), 500);
        }
      }, 1000);
    }
  }, [fetcher.data]);

  return (
    <Page>
      <TitleBar title="Facebook Integration">
        {isConnected && (
          <Button variant="primary" onClick={() => window.location.href = "/app/facebook/connect"}>
            View Settings
          </Button>
        )}
      </TitleBar>

      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {!data.connectionTest.success && data.connectionTest.error && (
              <Banner tone="critical">
                <Text as="p">
                  {data.connectionTest.error}
                </Text>
              </Banner>
            )}

            {fetcher.data?.error && (
              <Banner tone="critical">
                <Text as="p">{fetcher.data.error}</Text>
              </Banner>
            )}

            {fetcher.data?.marketingWarning && (
              <Banner tone="warning">
                <Text as="p">{fetcher.data.marketingWarning}</Text>
              </Banner>
            )}

            {fetcher.data?.success && !fetcher.data?.disconnected && (
              <Banner tone="success">
                <Text as="p">
                  Facebook pixel connected successfully!
                  {fetcher.data?.marketingActivity && (
                    <> Marketing activity created with ID: {fetcher.data.marketingActivity.id}</>
                  )}
                </Text>
              </Banner>
            )}

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Facebook Connection Status
                </Text>

                {data.metaConnection ? (
                  <Box>
                    <InlineStack align="space-between">
                      <BlockStack gap="200">
                        <Text as="p">
                          Connected as: <strong>{data.metaConnection.metaUserName}</strong>
                        </Text>
                        <Text as="p" tone="subdued">
                          {data.metaConnection.metaEmail}
                        </Text>
                        {isConnected && (
                          <Text as="p">
                            Selected Pixel: <strong>{data.metaConnection.pixelName}</strong> ({data.metaConnection.pixelId})
                          </Text>
                        )}
                      </BlockStack>
                      <Button onClick={handleDisconnect} tone="critical">
                        Disconnect
                      </Button>
                    </InlineStack>
                  </Box>
                ) : (
                  <Box>
                    <BlockStack gap="400">
                      <Text as="p">
                        Connect your Facebook account to enable Conversions API tracking and advanced marketing features.
                      </Text>
                      <InlineStack align="start">
                        <Button
                          variant="primary"
                          onClick={handleFacebookLogin}
                          size="large"
                        >
                          Connect Facebook Account
                        </Button>
                      </InlineStack>
                      <Text as="p" tone="subdued">
                        You'll be redirected to Facebook to authorize access to your ad accounts and pixels.
                        This integration requires ads_management and business_management permissions.
                      </Text>
                    </BlockStack>
                  </Box>
                )}
              </BlockStack>
            </Card>

            {data.connectionTest.success && !isConnected && data.pixels.length > 0 && (
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Connect Facebook Pixel
                  </Text>
                  <Text as="p">
                    Select a Facebook pixel to enable Conversions API tracking for your store.
                  </Text>
                  <Select
                    label="Select your Facebook pixel"
                    options={[
                      { label: "Choose a pixel...", value: "" },
                      ...data.pixels.map((pixel) => ({
                        label: `${pixel.name} (${pixel.id})`,
                        value: pixel.id,
                      })),
                    ]}
                    value={selectedPixelId}
                    onChange={setSelectedPixelId}
                  />
                  <InlineStack align="start">
                    <Button
                      variant="primary"
                      onClick={handleConfirmSelection}
                      disabled={!selectedPixelId || isLoading}
                      loading={isLoading}
                    >
                      Confirm Pixel Selection
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            )}

            {data.connectionTest.success && !isConnected && data.pixels.length === 0 && (
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Connect Facebook Pixel
                  </Text>
                  <Text as="p" tone="critical">
                    No Facebook pixels found in your account. Please create a pixel in Facebook Business Manager first.
                  </Text>
                </BlockStack>
              </Card>
            )}

            {isConnected && (
              <Card>
                <BlockStack gap="400">
                  <Text as="h3" variant="headingMd">
                    Integration Active
                  </Text>
                  <Text as="p">
                    Your Facebook pixel is connected and ready for Conversions API tracking.
                    Visit the dashboard to view event status and configure settings.
                  </Text>
                  <InlineStack align="start">
                    <Button
                      variant="primary"
                      onClick={() => window.location.href = "/app/facebook/connect"}
                    >
                      View Settings
                    </Button>
                    <Button onClick={() => setSelectedPixelId("")}>
                      Change Pixel
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            )}
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingMd">
                Required Permissions
              </Text>
              <BlockStack gap="200">
                {[
                  { permission: "ads_management", description: "Manage your ads and ad accounts" },
                  { permission: "business_management", description: "Access business settings" },
                  { permission: "read_insights", description: "Read advertising insights" },
                  { permission: "pages_show_list", description: "Access associated pages" },
                ].map(({ permission, description }) => {
                  const isGranted = data.connectionTest.permissions.includes(permission);
                  return (
                    <InlineStack key={permission} align="space-between">
                      <BlockStack gap="100">
                        <Text as="p" variant="bodySm" fontWeight="semibold">
                          {permission}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {description}
                        </Text>
                      </BlockStack>
                      {isGranted ? (
                        <Text as="p" variant="bodySm" tone="success">
                          ✓ Granted
                        </Text>
                      ) : (
                        <Text as="p" variant="bodySm" tone="critical">
                          ✗ Missing
                        </Text>
                      )}
                    </InlineStack>
                  );
                })}
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}