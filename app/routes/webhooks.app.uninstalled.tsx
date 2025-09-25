import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    // Clean up Meta connections before deleting sessions
    try {
      const metaConnections = await db.meta.findMany({
        where: { sessionId: session.id },
      });

      if (metaConnections.length > 0) {
        console.log(`Cleaning up ${metaConnections.length} Meta connections for shop ${shop}`);

        // Delete Meta connections (CASCADE will handle related data)
        await db.meta.deleteMany({
          where: { sessionId: session.id },
        });
      }
    } catch (error) {
      console.error(`Error cleaning up Meta connections for ${shop}:`, error);
    }

    // Delete sessions
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
