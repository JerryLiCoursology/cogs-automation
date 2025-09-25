import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { json, redirect } from "@remix-run/node";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  InlineStack,
  Badge,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  let session;
  try {
    const auth = await authenticate.admin(request);
    session = auth.session;

    if (!session) {
      throw redirect("/auth/login");
    }
  } catch (error) {
    if (error instanceof Response) throw error;
    throw redirect("/auth/login");
  }

  // Check for Facebook connection
  const metaConnection = await prisma.meta.findUnique({
    where: { sessionId: session.id },
  });

  const isConnected = Boolean(metaConnection?.pixelId);

  return json({
    facebookConnection: {
      isConnected,
      pixelName: metaConnection?.pixelName,
      userName: metaConnection?.metaUserName,
    }
  });
};


export default function Index() {
  const data = useLoaderData<typeof loader>();

  return (
    <Page>
      <TitleBar title="Dashboard" />
      <Layout>
          <Layout.Section variant="oneThird">
            <BlockStack gap="500">
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Facebook Integration
                  </Text>
                  {data.facebookConnection.isConnected ? (
                    <BlockStack gap="200">
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodyMd">
                          Status
                        </Text>
                        <Badge tone="success">Connected</Badge>
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodyMd">
                          Pixel
                        </Text>
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          {data.facebookConnection.pixelName}
                        </Text>
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodyMd">
                          Account
                        </Text>
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          {data.facebookConnection.userName}
                        </Text>
                      </InlineStack>
                      <InlineStack align="start">
                        <Button
                          url="/app/facebook/connect"
                          size="slim"
                        >
                          Manage Connection
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  ) : (
                    <BlockStack gap="200">
                      <InlineStack align="space-between">
                        <Text as="span" variant="bodyMd">
                          Status
                        </Text>
                        <Badge tone="critical">Not Connected</Badge>
                      </InlineStack>
                      <Text as="p" variant="bodyMd" tone="subdued">
                        Connect your Facebook account to enable Conversions API tracking.
                      </Text>
                      <InlineStack align="start">
                        <Button
                          variant="primary"
                          url="/app/facebook/connect"
                          size="slim"
                        >
                          Connect Facebook
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Analytics
                  </Text>
                  <BlockStack gap="200">
                    <Text as="p" variant="bodyMd" tone="subdued">
                      Tracking and analytics data will appear here once Facebook integration is active.
                    </Text>
                    {data.facebookConnection.isConnected && (
                      <InlineStack align="start">
                        <Button
                          url="/app/facebook/connect"
                          size="slim"
                          disabled
                        >
                          View Analytics
                        </Button>
                      </InlineStack>
                    )}
                  </BlockStack>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>
    </Page>
  );
}
