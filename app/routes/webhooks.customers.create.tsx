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

    // Parse customer data
    const customer = payload;

    if (!customer) {
      console.error("No customer data in webhook payload");
      return new Response();
    }

    // Initialize CAPI service
    const capiService = new CAPIService(metaConnection.pixelId, metaConnection.accessToken);


    // Generate unique event ID
    const eventId = `shopify_customer_${customer.id}_signup_${Date.now()}`;

    // Helper function to hash PII data
    const hashPII = (data: string): string => {
      const crypto = require('crypto');
      return crypto.createHash('sha256').update(data.toLowerCase().trim()).digest('hex');
    };

    // For customer creation, we can send a custom "CompleteRegistration" event
    // This is useful for tracking sign-ups and building audiences
    const customEvent = {
      event_name: 'CompleteRegistration',
      event_time: Math.floor((customer.created_at ? new Date(customer.created_at).getTime() : Date.now()) / 1000),
      action_source: 'website' as const,
      user_data: {
        em: customer.email ? [hashPII(customer.email)] : undefined,
        ph: customer.phone ? [hashPII(customer.phone)] : undefined,
        fn: customer.first_name ? [hashPII(customer.first_name)] : undefined,
        ln: customer.last_name ? [hashPII(customer.last_name)] : undefined,
        ct: customer.default_address?.city ? [hashPII(customer.default_address.city)] : undefined,
        st: customer.default_address?.province ? [hashPII(customer.default_address.province)] : undefined,
        zp: customer.default_address?.zip ? [hashPII(customer.default_address.zip)] : undefined,
        country: customer.default_address?.country ? [hashPII(customer.default_address.country)] : undefined,
        external_id: customer.id ? [hashPII(customer.id.toString())] : undefined,
      },
      custom_data: {
        content_type: 'registration',
      },
      event_id: eventId,
    };

    // Send custom event directly using the sendEvents method
    const capiResponse = await capiService.sendEvents([customEvent]);

    console.log(`CAPI CompleteRegistration event sent for customer ${customer.id}:`, {
      eventsReceived: capiResponse.events_received,
      fbtrace_id: capiResponse.fbtrace_id,
    });

    console.log(`Successfully tracked customer registration for customer ${customer.id} to Facebook pixel ${metaConnection.pixelId}`);

  } catch (error) {
    console.error(`Error processing customer webhook for ${shop}:`, error);
    // Don't throw - we don't want webhook retries for CAPI failures
  }

  return new Response();
};