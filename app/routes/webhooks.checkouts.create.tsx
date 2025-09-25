import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { CAPIService } from "../services/capi.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  if (!session) {
    console.log("No session found for shop:", shop);
    return new Response();
  }

  try {
    // Get Meta connection for this shop
    const metaConnection = await prisma.meta.findUnique({
      where: { sessionId: session.id },
    });

    if (!metaConnection || !metaConnection.pixelId) {
      console.log("No Meta connection found for shop:", shop);
      return new Response();
    }

    // Parse checkout data
    const checkout = payload;

    if (!checkout || !checkout.line_items || checkout.line_items.length === 0) {
      console.log("No valid checkout data in webhook payload");
      return new Response();
    }

    // Initialize CAPI service
    const capiService = new CAPIService(metaConnection.pixelId, metaConnection.accessToken);

    // Get customer data if available
    const customer = checkout.customer || null;

    // Extract content IDs and calculate total items
    const contentIds = checkout.line_items.map((item: any) =>
      item.variant_id?.toString() || item.product_id?.toString() || item.id?.toString()
    ).filter(Boolean);

    const numItems = checkout.line_items.reduce(
      (sum: number, item: any) => sum + (item.quantity || 1),
      0
    );

    // Extract client data from checkout
    const clientData = {
      ip: checkout.browser_ip || undefined,
      userAgent: checkout.client_details?.user_agent || undefined,
      sourceUrl: checkout.landing_site_ref || undefined,
      fbc: undefined, // Would need frontend integration
      fbp: undefined, // Would need frontend integration
    };

    // Generate unique event ID
    const eventId = `shopify_checkout_${checkout.id}_${Date.now()}`;

    // Send initiate checkout event to Facebook CAPI
    const capiResponse = await capiService.trackInitiateCheckout(
      parseFloat(checkout.total_price || "0"),
      checkout.currency || "USD",
      contentIds,
      numItems,
      customer,
      eventId,
      clientData
    );

    console.log(`CAPI InitiateCheckout event sent for checkout ${checkout.id}:`, {
      eventsReceived: capiResponse.events_received,
      fbtrace_id: capiResponse.fbtrace_id,
    });

    console.log(`Successfully tracked checkout initiation for checkout ${checkout.id} to Facebook pixel ${metaConnection.pixelId}`);

  } catch (error) {
    console.error(`Error processing checkout webhook for ${shop}:`, error);
    // Don't throw - we don't want webhook retries for CAPI failures
  }

  return new Response();
};