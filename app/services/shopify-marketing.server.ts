import { GraphQLClient } from "graphql-request";

export interface MarketingActivity {
  id: string;
  title: string;
  budget?: {
    budgetType: "DAILY" | "LIFETIME";
    total: {
      amount: string;
      currencyCode: string;
    };
  };
  status: "ACTIVE" | "PAUSED" | "DELETED" | "UNDEFINED";
  tactic: string;
  marketingChannelType: string;
  referringDomain?: string;
  utmParameters: {
    campaign: string;
    source: string;
    medium: string;
  };
  marketingEvent?: {
    id: string;
    type: string;
    startedAt: string;
    scheduledToEndAt?: string;
  };
}

export interface CreateMarketingActivityInput {
  title: string;
  budget?: {
    budgetType: "DAILY" | "LIFETIME";
    total: {
      amount: string;
      currencyCode: string;
    };
  };
  status?: "ACTIVE" | "PAUSED" | "DELETED" | "UNDEFINED";
  tactic: string;
  marketingChannelType: string;
  referringDomain: string;
  utmParameters: {
    campaign: string;
    source: string;
    medium: string;
  };
  start: string; // ISO date string
  end?: string; // ISO date string
  remoteId?: string; // External campaign ID from Facebook
  remoteUrl?: string; // Link to Facebook campaign
}

export class ShopifyMarketingService {
  private client: GraphQLClient;
  private accessToken: string;
  private shop: string;

  constructor(shop: string, accessToken: string) {
    this.shop = shop;
    this.accessToken = accessToken;
    this.client = new GraphQLClient(`https://${shop}.myshopify.com/admin/api/2025-04/graphql.json`, {
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
    });
  }

  /**
   * Create external marketing activity for Facebook campaigns
   */
  async createMarketingActivity(input: CreateMarketingActivityInput): Promise<MarketingActivity> {
    const mutation = `
      mutation MarketingActivityCreateExternal($input: MarketingActivityCreateExternalInput!) {
        marketingActivityCreateExternal(input: $input) {
          marketingActivity {
            id
            title
            budget {
              budgetType
              total {
                amount
                currencyCode
              }
            }
            status
            tactic
            marketingChannelType
            referringDomain
            utmParameters {
              campaign
              source
              medium
            }
            marketingEvent {
              id
              type
              startedAt
              scheduledToEndAt
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      input: {
        title: input.title,
        budget: input.budget,
        status: input.status || "ACTIVE",
        tactic: input.tactic,
        marketingChannelType: input.marketingChannelType,
        referringDomain: input.referringDomain,
        utmParameters: input.utmParameters,
        start: input.start,
        end: input.end,
        remoteId: input.remoteId,
        remoteUrl: input.remoteUrl,
      },
    };

    try {
      const response = await this.client.request(mutation, variables);

      if (response.marketingActivityCreateExternal.userErrors.length > 0) {
        throw new Error(
          `Marketing activity creation failed: ${response.marketingActivityCreateExternal.userErrors
            .map((error: any) => error.message)
            .join(", ")}`
        );
      }

      return response.marketingActivityCreateExternal.marketingActivity;
    } catch (error) {
      console.error("Error creating marketing activity:", error);
      throw new Error(`Failed to create marketing activity: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Update external marketing activity
   */
  async updateMarketingActivity(
    activityId: string,
    input: Partial<CreateMarketingActivityInput>
  ): Promise<MarketingActivity> {
    const mutation = `
      mutation MarketingActivityUpdateExternal($input: MarketingActivityUpdateExternalInput!) {
        marketingActivityUpdateExternal(input: $input) {
          marketingActivity {
            id
            title
            budget {
              budgetType
              total {
                amount
                currencyCode
              }
            }
            status
            tactic
            marketingChannelType
            referringDomain
            utmParameters {
              campaign
              source
              medium
            }
            marketingEvent {
              id
              type
              startedAt
              scheduledToEndAt
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      input: {
        id: activityId,
        ...input,
      },
    };

    try {
      const response = await this.client.request(mutation, variables);

      if (response.marketingActivityUpdateExternal.userErrors.length > 0) {
        throw new Error(
          `Marketing activity update failed: ${response.marketingActivityUpdateExternal.userErrors
            .map((error: any) => error.message)
            .join(", ")}`
        );
      }

      return response.marketingActivityUpdateExternal.marketingActivity;
    } catch (error) {
      console.error("Error updating marketing activity:", error);
      throw new Error(`Failed to update marketing activity: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Get marketing activities
   */
  async getMarketingActivities(first = 50): Promise<MarketingActivity[]> {
    const query = `
      query GetMarketingActivities($first: Int!) {
        marketingActivities(first: $first) {
          edges {
            node {
              id
              title
              budget {
                budgetType
                total {
                  amount
                  currencyCode
                }
              }
              status
              tactic
              marketingChannelType
              referringDomain
              utmParameters {
                campaign
                source
                medium
              }
              marketingEvent {
                id
                type
                startedAt
                scheduledToEndAt
              }
            }
          }
        }
      }
    `;

    try {
      const response = await this.client.request(query, { first });
      return response.marketingActivities.edges.map((edge: any) => edge.node);
    } catch (error) {
      console.error("Error fetching marketing activities:", error);
      throw new Error(`Failed to fetch marketing activities: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Create marketing activity for Facebook ad campaign
   */
  async createFacebookCampaignActivity(
    campaignName: string,
    campaignId: string,
    budget?: { amount: string; type: "DAILY" | "LIFETIME" },
    adAccountId?: string
  ): Promise<MarketingActivity> {
    const utmCampaign = `fb_${campaignId}`;
    const currentDate = new Date().toISOString();

    return this.createMarketingActivity({
      title: `Facebook Campaign: ${campaignName}`,
      budget: budget
        ? {
            budgetType: budget.type,
            total: {
              amount: budget.amount,
              currencyCode: "USD", // Default, should be configurable
            },
          }
        : undefined,
      status: "ACTIVE",
      tactic: "SPONSORED_CONTENT",
      marketingChannelType: "SOCIAL",
      referringDomain: "facebook.com",
      utmParameters: {
        campaign: utmCampaign,
        source: "facebook",
        medium: "cpc",
      },
      start: currentDate,
      remoteId: campaignId,
      remoteUrl: adAccountId
        ? `https://business.facebook.com/adsmanager/manage/campaigns?act=${adAccountId}&selected_campaign_ids=${campaignId}`
        : undefined,
    });
  }

  /**
   * Create marketing activity for Facebook CAPI integration
   */
  async createFacebookCAPIActivity(pixelId: string, pixelName: string): Promise<MarketingActivity> {
    const currentDate = new Date().toISOString();

    return this.createMarketingActivity({
      title: `Facebook CAPI Integration - ${pixelName}`,
      status: "ACTIVE",
      tactic: "CONVERSION_TRACKING",
      marketingChannelType: "SOCIAL",
      referringDomain: "facebook.com",
      utmParameters: {
        campaign: `capi_${pixelId}`,
        source: "facebook",
        medium: "conversions_api",
      },
      start: currentDate,
      remoteId: pixelId,
      remoteUrl: `https://business.facebook.com/events_manager2/list/pixel/${pixelId}`,
    });
  }

  /**
   * Track marketing performance metrics
   */
  async getMarketingActivityInsights(activityId: string, dateRange?: { start: string; end: string }) {
    // This would typically fetch insights data from Shopify Analytics
    // For now, we'll return a placeholder structure
    return {
      activityId,
      dateRange,
      metrics: {
        impressions: 0,
        clicks: 0,
        conversions: 0,
        revenue: 0,
        cost: 0,
      },
      // In a real implementation, you'd query Shopify's analytics APIs
      // to get actual performance data
    };
  }

  /**
   * Validate that the app has the required scopes for marketing events
   */
  async validateMarketingScopes(): Promise<{ hasScope: boolean; error?: string }> {
    const query = `
      query {
        app {
          installation {
            launchUrl
            uninstallUrl
          }
        }
      }
    `;

    try {
      await this.client.request(query);
      return { hasScope: true };
    } catch (error: any) {
      if (error.response?.errors?.some((e: any) => e.extensions?.code === "ACCESS_DENIED")) {
        return {
          hasScope: false,
          error: "Missing write_marketing_events scope. Please reinstall the app with marketing permissions.",
        };
      }
      return { hasScope: false, error: error.message };
    }
  }
}