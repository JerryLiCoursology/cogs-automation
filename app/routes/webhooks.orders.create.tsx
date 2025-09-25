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

    // Parse order data
    const order = payload;

    if (!order) {
      console.error("No order data in webhook payload");
      return new Response();
    }

    // Initialize CAPI service
    const capiService = new CAPIService(metaConnection.pixelId, metaConnection.accessToken);

    // Get customer data if available
    const customer = order.customer || null;

    // Extract client data from order (if available)
    const clientData = {
      ip: order.browser_ip || undefined,
      userAgent: order.client_details?.user_agent || undefined,
      // Facebook click ID and browser ID would typically come from the storefront
      // For now, we'll leave these undefined as they require frontend integration
      fbc: undefined,
      fbp: undefined,
    };

    // Generate unique event ID to prevent duplicates
    const eventId = `shopify_order_${order.id}_${Date.now()}`;

    // Send purchase event to Facebook CAPI
    const capiResponse = await capiService.trackPurchase(
      order,
      customer,
      eventId,
      clientData
    );

    console.log(`CAPI Purchase event sent for order ${order.id}:`, {
      eventsReceived: capiResponse.events_received,
      fbtrace_id: capiResponse.fbtrace_id,
    });

    // Log successful tracking (in a real app, you might want to store this in a separate tracking table)
    console.log(`Successfully tracked purchase for order ${order.id} to Facebook pixel ${metaConnection.pixelId}`);

  } catch (error) {
    console.error(`Error processing order webhook for ${shop}:`, error);

    // Don't throw the error - we don't want to cause webhook retries for CAPI failures
    // The order was still processed successfully in Shopify
  }

  return new Response();
};