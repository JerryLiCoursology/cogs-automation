import { ShopifyMarketingService } from "./shopify-marketing.server";
import prisma from "../db.server";

export interface FacebookIntegrationData {
  pixelId: string;
  pixelName: string;
  businessId?: string;
  adAccountId?: string;
  sessionId: string;
}

export class MarketingIntegrationService {
  private shopifyMarketing: ShopifyMarketingService;

  constructor(shop: string, accessToken: string) {
    this.shopifyMarketing = new ShopifyMarketingService(shop, accessToken);
  }

  /**
   * Initialize Facebook CAPI marketing integration
   * Creates a marketing activity in Shopify to track the Facebook integration
   */
  async initializeFacebookIntegration(data: FacebookIntegrationData): Promise<{
    marketingActivity: any;
    success: boolean;
    error?: string;
  }> {
    try {
      // First, validate that we have the required scopes
      const scopeValidation = await this.shopifyMarketing.validateMarketingScopes();
      if (!scopeValidation.hasScope) {
        return {
          marketingActivity: null,
          success: false,
          error: scopeValidation.error || "Missing required marketing scopes",
        };
      }

      // Create marketing activity for CAPI integration
      const marketingActivity = await this.shopifyMarketing.createFacebookCAPIActivity(
        data.pixelId,
        data.pixelName
      );

      // Store the marketing activity ID in the Meta connection
      await prisma.meta.update({
        where: { sessionId: data.sessionId },
        data: {
          // Store marketing activity ID in a new field (we'd need to add this to schema)
          // For now, we can store it in the permissions JSON or create a separate table
          permissions: JSON.stringify({
            scopes: [
              "ads_management",
              "business_management",
              "read_insights",
              "pages_show_list",
              "email",
              "public_profile",
            ],
            marketingActivityId: marketingActivity.id,
          }),
          updatedAt: new Date(),
        },
      });

      return {
        marketingActivity,
        success: true,
      };
    } catch (error) {
      console.error("Error initializing Facebook marketing integration:", error);
      return {
        marketingActivity: null,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Create marketing activity for a specific Facebook ad campaign
   */
  async trackFacebookCampaign(
    campaignId: string,
    campaignName: string,
    budget?: { amount: string; type: "DAILY" | "LIFETIME" },
    adAccountId?: string
  ): Promise<{
    marketingActivity: any;
    success: boolean;
    error?: string;
  }> {
    try {
      const marketingActivity = await this.shopifyMarketing.createFacebookCampaignActivity(
        campaignName,
        campaignId,
        budget,
        adAccountId
      );

      return {
        marketingActivity,
        success: true,
      };
    } catch (error) {
      console.error("Error creating Facebook campaign marketing activity:", error);
      return {
        marketingActivity: null,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Update marketing activity when campaign status changes
   */
  async updateCampaignStatus(
    marketingActivityId: string,
    status: "ACTIVE" | "PAUSED" | "DELETED",
    endDate?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      await this.shopifyMarketing.updateMarketingActivity(marketingActivityId, {
        status,
        end: endDate,
      });

      return { success: true };
    } catch (error) {
      console.error("Error updating campaign status:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get all marketing activities related to Facebook integration
   */
  async getFacebookMarketingActivities(): Promise<{
    activities: any[];
    success: boolean;
    error?: string;
  }> {
    try {
      const activities = await this.shopifyMarketing.getMarketingActivities();

      // Filter activities related to Facebook
      const facebookActivities = activities.filter(
        activity =>
          activity.referringDomain === "facebook.com" ||
          activity.utmParameters?.source === "facebook"
      );

      return {
        activities: facebookActivities,
        success: true,
      };
    } catch (error) {
      console.error("Error fetching Facebook marketing activities:", error);
      return {
        activities: [],
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get marketing insights for a specific activity
   */
  async getActivityInsights(
    activityId: string,
    dateRange?: { start: string; end: string }
  ): Promise<{
    insights: any;
    success: boolean;
    error?: string;
  }> {
    try {
      const insights = await this.shopifyMarketing.getMarketingActivityInsights(
        activityId,
        dateRange
      );

      return {
        insights,
        success: true,
      };
    } catch (error) {
      console.error("Error fetching activity insights:", error);
      return {
        insights: null,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Sync Facebook campaigns with Shopify marketing activities
   * This could be called periodically to keep campaigns in sync
   */
  async syncFacebookCampaigns(
    facebookCampaigns: Array<{
      id: string;
      name: string;
      status: string;
      budget?: { amount: string; type: "DAILY" | "LIFETIME" };
      adAccountId?: string;
    }>
  ): Promise<{
    created: number;
    updated: number;
    errors: string[];
  }> {
    const results = {
      created: 0,
      updated: 0,
      errors: [] as string[],
    };

    // Get existing marketing activities
    const existingActivities = await this.shopifyMarketing.getMarketingActivities();
    const existingCampaignIds = new Set(
      existingActivities
        .filter(activity => activity.remoteId)
        .map(activity => activity.remoteId)
    );

    for (const campaign of facebookCampaigns) {
      try {
        if (existingCampaignIds.has(campaign.id)) {
          // Update existing campaign
          const existingActivity = existingActivities.find(
            activity => activity.remoteId === campaign.id
          );

          if (existingActivity) {
            await this.shopifyMarketing.updateMarketingActivity(existingActivity.id, {
              status: this.mapFacebookStatusToShopify(campaign.status),
              title: `Facebook Campaign: ${campaign.name}`,
            });
            results.updated++;
          }
        } else {
          // Create new campaign
          await this.shopifyMarketing.createFacebookCampaignActivity(
            campaign.name,
            campaign.id,
            campaign.budget,
            campaign.adAccountId
          );
          results.created++;
        }
      } catch (error) {
        const errorMessage = `Failed to sync campaign ${campaign.id}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`;
        console.error(errorMessage);
        results.errors.push(errorMessage);
      }
    }

    return results;
  }

  /**
   * Map Facebook campaign status to Shopify marketing activity status
   */
  private mapFacebookStatusToShopify(facebookStatus: string): "ACTIVE" | "PAUSED" | "DELETED" | "UNDEFINED" {
    switch (facebookStatus.toUpperCase()) {
      case "ACTIVE":
        return "ACTIVE";
      case "PAUSED":
        return "PAUSED";
      case "DELETED":
      case "ARCHIVED":
        return "DELETED";
      default:
        return "UNDEFINED";
    }
  }
}