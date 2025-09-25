import axios from "axios";
import crypto from "crypto";
import type { Order, Customer } from "@shopify/shopify-api";

export interface CAPIEvent {
  event_name: string;
  event_time: number;
  action_source: "website" | "email" | "app" | "phone_call" | "chat" | "physical_store" | "system_generated";
  event_source_url?: string;
  user_data: {
    em?: string[];    // emails (hashed)
    ph?: string[];    // phones (hashed)
    fn?: string[];    // first name (hashed)
    ln?: string[];    // last name (hashed)
    ct?: string[];    // city (hashed)
    st?: string[];    // state (hashed)
    zp?: string[];    // zip (hashed)
    country?: string[];  // country (hashed)
    external_id?: string[];  // customer ID (hashed)
    client_ip_address?: string;
    client_user_agent?: string;
    fbc?: string;     // Facebook click ID
    fbp?: string;     // Facebook browser ID
  };
  custom_data?: {
    value?: number;
    currency?: string;
    content_type?: "product" | "product_group";
    content_ids?: string[];
    content_name?: string;
    content_category?: string;
    num_items?: number;
    order_id?: string;
    search_string?: string;
    status?: string;
    contents?: Array<{
      id: string;
      quantity: number;
      item_price?: number;
    }>;
  };
  event_id?: string;  // For deduplication
  opt_out?: boolean;
}

export interface CAPIResponse {
  events_received: number;
  messages: string[];
  fbtrace_id: string;
}

export class CAPIService {
  private pixelId: string;
  private accessToken: string;
  private testEventCode?: string;

  constructor(pixelId: string, accessToken: string, testEventCode?: string) {
    this.pixelId = pixelId;
    this.accessToken = accessToken;
    this.testEventCode = testEventCode;
  }

  /**
   * Hash PII data for Facebook CAPI
   */
  private hashPII(data: string): string {
    return crypto.createHash('sha256').update(data.toLowerCase().trim()).digest('hex');
  }

  /**
   * Send events to Facebook Conversions API
   */
  async sendEvents(events: CAPIEvent[]): Promise<CAPIResponse> {
    const url = `https://graph.facebook.com/v18.0/${this.pixelId}/events`;

    const payload = {
      data: events,
      access_token: this.accessToken,
      ...(this.testEventCode && { test_event_code: this.testEventCode }),
    };

    try {
      const response = await axios.post<CAPIResponse>(url, payload, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      });

      return response.data;
    } catch (error: any) {
      console.error('CAPI Error:', error.response?.data || error.message);
      throw new Error(`CAPI request failed: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Create user data object with hashed PII
   */
  private createUserData(
    customer?: Partial<Customer>,
    clientIp?: string,
    userAgent?: string,
    fbc?: string,
    fbp?: string
  ): CAPIEvent['user_data'] {
    const userData: CAPIEvent['user_data'] = {};

    if (customer?.email) {
      userData.em = [this.hashPII(customer.email)];
    }

    if (customer?.phone) {
      userData.ph = [this.hashPII(customer.phone)];
    }

    if (customer?.first_name) {
      userData.fn = [this.hashPII(customer.first_name)];
    }

    if (customer?.last_name) {
      userData.ln = [this.hashPII(customer.last_name)];
    }

    if (customer?.default_address?.city) {
      userData.ct = [this.hashPII(customer.default_address.city)];
    }

    if (customer?.default_address?.province) {
      userData.st = [this.hashPII(customer.default_address.province)];
    }

    if (customer?.default_address?.zip) {
      userData.zp = [this.hashPII(customer.default_address.zip)];
    }

    if (customer?.default_address?.country) {
      userData.country = [this.hashPII(customer.default_address.country)];
    }

    if (customer?.id) {
      userData.external_id = [this.hashPII(customer.id.toString())];
    }

    if (clientIp) {
      userData.client_ip_address = clientIp;
    }

    if (userAgent) {
      userData.client_user_agent = userAgent;
    }

    if (fbc) {
      userData.fbc = fbc;
    }

    if (fbp) {
      userData.fbp = fbp;
    }

    return userData;
  }

  /**
   * Track a purchase event
   */
  async trackPurchase(
    order: Partial<Order>,
    customer?: Partial<Customer>,
    eventId?: string,
    clientData?: {
      ip?: string;
      userAgent?: string;
      fbc?: string;
      fbp?: string;
    }
  ): Promise<CAPIResponse> {
    const userData = this.createUserData(
      customer,
      clientData?.ip,
      clientData?.userAgent,
      clientData?.fbc,
      clientData?.fbp
    );

    const contents = order.line_items?.map((item: any) => ({
      id: item.product_id?.toString() || item.variant_id?.toString() || '',
      quantity: item.quantity || 1,
      item_price: parseFloat(item.price || '0'),
    })) || [];

    const event: CAPIEvent = {
      event_name: 'Purchase',
      event_time: Math.floor((order.created_at ? new Date(order.created_at).getTime() : Date.now()) / 1000),
      action_source: 'website',
      event_source_url: order.landing_site_ref || undefined,
      user_data: userData,
      custom_data: {
        value: parseFloat(order.total_price || '0'),
        currency: order.currency || 'USD',
        content_type: 'product',
        content_ids: contents.map(c => c.id),
        num_items: contents.reduce((sum, item) => sum + item.quantity, 0),
        order_id: order.id?.toString() || order.name || '',
        contents,
      },
      event_id: eventId || `${order.id}_purchase_${Date.now()}`,
    };

    return this.sendEvents([event]);
  }

  /**
   * Track an add to cart event
   */
  async trackAddToCart(
    productId: string,
    variantId: string,
    quantity: number,
    price: number,
    currency: string,
    customer?: Partial<Customer>,
    eventId?: string,
    clientData?: {
      ip?: string;
      userAgent?: string;
      fbc?: string;
      fbp?: string;
      sourceUrl?: string;
    }
  ): Promise<CAPIResponse> {
    const userData = this.createUserData(
      customer,
      clientData?.ip,
      clientData?.userAgent,
      clientData?.fbc,
      clientData?.fbp
    );

    const event: CAPIEvent = {
      event_name: 'AddToCart',
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'website',
      event_source_url: clientData?.sourceUrl,
      user_data: userData,
      custom_data: {
        value: price * quantity,
        currency,
        content_type: 'product',
        content_ids: [variantId || productId],
        num_items: quantity,
        contents: [{
          id: variantId || productId,
          quantity,
          item_price: price,
        }],
      },
      event_id: eventId || `${productId}_${variantId}_addtocart_${Date.now()}`,
    };

    return this.sendEvents([event]);
  }

  /**
   * Track a page view event
   */
  async trackPageView(
    url: string,
    customer?: Partial<Customer>,
    eventId?: string,
    clientData?: {
      ip?: string;
      userAgent?: string;
      fbc?: string;
      fbp?: string;
    }
  ): Promise<CAPIResponse> {
    const userData = this.createUserData(
      customer,
      clientData?.ip,
      clientData?.userAgent,
      clientData?.fbc,
      clientData?.fbp
    );

    const event: CAPIEvent = {
      event_name: 'PageView',
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'website',
      event_source_url: url,
      user_data: userData,
      event_id: eventId || `pageview_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    };

    return this.sendEvents([event]);
  }

  /**
   * Track an initiate checkout event
   */
  async trackInitiateCheckout(
    value: number,
    currency: string,
    contentIds: string[],
    numItems: number,
    customer?: Partial<Customer>,
    eventId?: string,
    clientData?: {
      ip?: string;
      userAgent?: string;
      fbc?: string;
      fbp?: string;
      sourceUrl?: string;
    }
  ): Promise<CAPIResponse> {
    const userData = this.createUserData(
      customer,
      clientData?.ip,
      clientData?.userAgent,
      clientData?.fbc,
      clientData?.fbp
    );

    const event: CAPIEvent = {
      event_name: 'InitiateCheckout',
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'website',
      event_source_url: clientData?.sourceUrl,
      user_data: userData,
      custom_data: {
        value,
        currency,
        content_type: 'product',
        content_ids: contentIds,
        num_items: numItems,
      },
      event_id: eventId || `initiate_checkout_${Date.now()}`,
    };

    return this.sendEvents([event]);
  }

  /**
   * Track a view content event (product page view)
   */
  async trackViewContent(
    productId: string,
    contentName: string,
    contentCategory: string,
    value: number,
    currency: string,
    customer?: Partial<Customer>,
    eventId?: string,
    clientData?: {
      ip?: string;
      userAgent?: string;
      fbc?: string;
      fbp?: string;
      sourceUrl?: string;
    }
  ): Promise<CAPIResponse> {
    const userData = this.createUserData(
      customer,
      clientData?.ip,
      clientData?.userAgent,
      clientData?.fbc,
      clientData?.fbp
    );

    const event: CAPIEvent = {
      event_name: 'ViewContent',
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'website',
      event_source_url: clientData?.sourceUrl,
      user_data: userData,
      custom_data: {
        value,
        currency,
        content_type: 'product',
        content_ids: [productId],
        content_name: contentName,
        content_category: contentCategory,
      },
      event_id: eventId || `${productId}_viewcontent_${Date.now()}`,
    };

    return this.sendEvents([event]);
  }

  /**
   * Test the connection by sending a test event
   */
  async testConnection(): Promise<boolean> {
    try {
      const testEvent: CAPIEvent = {
        event_name: 'PageView',
        event_time: Math.floor(Date.now() / 1000),
        action_source: 'website',
        user_data: {
          em: [this.hashPII('test@example.com')],
        },
        event_id: `test_${Date.now()}`,
      };

      const response = await this.sendEvents([testEvent]);
      return response.events_received > 0;
    } catch (error) {
      console.error('CAPI connection test failed:', error);
      return false;
    }
  }
}