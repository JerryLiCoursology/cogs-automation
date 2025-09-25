import axios from "axios";

export interface MetaPixel {
  id: string;
  name: string;
  creation_time: string;
  last_fired_time?: string;
}

export interface MetaBusiness {
  id: string;
  name: string;
  verification_status: string;
}

export interface MetaAdAccount {
  id: string;
  name: string;
  account_status: number;
  business?: {
    id: string;
    name: string;
  };
}

export interface UserPixelsResponse {
  pixels: MetaPixel[];
  adAccounts: MetaAdAccount[];
  businesses: MetaBusiness[];
}

export class MetaApiService {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  /**
   * Fetch user's available pixels, ad accounts, and businesses
   */
  async getUserPixelsAndAccounts(): Promise<UserPixelsResponse> {
    try {
      // Get user's ad accounts - using latest API version
      const adAccountsResponse = await axios.get(
        "https://graph.facebook.com/v23.0/me/adaccounts",
        {
          params: {
            access_token: this.accessToken,
            fields: "id,name,account_status,business{id,name}",
          },
        }
      );

      const adAccounts: MetaAdAccount[] = adAccountsResponse.data.data || [];

      // Get user's businesses first
      let businesses: MetaBusiness[] = [];
      try {
        const businessResponse = await axios.get(
          "https://graph.facebook.com/v23.0/me/businesses",
          {
            params: {
              access_token: this.accessToken,
              fields: "id,name,verification_status",
            },
          }
        );
        businesses = businessResponse.data.data || [];
      } catch (error) {
        console.warn("Failed to fetch businesses:", error);
      }

      // Facebook has deprecated the old pixel endpoints. The new approach is:
      // 1. Get pixels through the user's owned objects
      // 2. Use the business manager connection

      let pixels: MetaPixel[] = [];

      // Fetch pixels through businesses (this is the working method)
      if (businesses.length > 0) {
        const businessPixelPromises = businesses.map(async (business) => {
          try {
            const pixelResponse = await axios.get(
              `https://graph.facebook.com/v23.0/${business.id}/owned_ad_accounts`,
              {
                params: {
                  access_token: this.accessToken,
                  fields: "adspixels{id,name,creation_time,last_fired_time}",
                },
              }
            );

            const accounts = pixelResponse.data.data || [];
            return accounts.reduce((allPixels: MetaPixel[], account: any) => {
              if (account.adspixels && account.adspixels.data) {
                return [...allPixels, ...account.adspixels.data];
              }
              return allPixels;
            }, []);
          } catch (error) {
            console.warn(`Failed to fetch pixels for business ${business.id}:`, error);
            return [];
          }
        });

        const businessPixelArrays = await Promise.all(businessPixelPromises);
        pixels = businessPixelArrays.flat();
        console.log(`Found ${pixels.length} pixels through business accounts`);
      }

      // Note: The old Facebook SDK ads_pixels endpoints have been deprecated.
      // We now only use the business-level approach which is working correctly.

      // Remove duplicate pixels (same pixel can be in multiple accounts)
      const uniquePixels = pixels.reduce((acc, pixel) => {
        if (!acc.find(p => p.id === pixel.id)) {
          acc.push(pixel);
        }
        return acc;
      }, [] as MetaPixel[]);

      console.log(`Final result: ${uniquePixels.length} unique pixels`);

      return {
        pixels: uniquePixels,
        adAccounts,
        businesses,
      };
    } catch (error) {
      console.error("Error fetching user pixels and accounts:", error);
      throw new Error("Failed to fetch Meta data");
    }
  }

  /**
   * Get detailed information about a specific pixel
   */
  async getPixelDetails(pixelId: string) {
    try {
      const response = await axios.get(
        `https://graph.facebook.com/v23.0/${pixelId}`,
        {
          params: {
            access_token: this.accessToken,
            fields: "id,name,creation_time,last_fired_time,code,automatic_matching_fields,data_use_setting,description",
          },
        }
      );

      return response.data;
    } catch (error) {
      console.error(`Error fetching pixel details for ${pixelId}:`, error);
      throw new Error("Failed to fetch pixel details");
    }
  }

  /**
   * Get business details
   */
  async getBusinessDetails(businessId: string) {
    try {
      const response = await axios.get(
        `https://graph.facebook.com/v23.0/${businessId}`,
        {
          params: {
            access_token: this.accessToken,
            fields: "id,name,verification_status,link,timezone_id,two_factor_type",
          },
        }
      );

      return response.data;
    } catch (error) {
      console.error(`Error fetching business details for ${businessId}:`, error);
      throw new Error("Failed to fetch business details");
    }
  }

  /**
   * Test API connection and permissions
   */
  async testConnection(): Promise<{
    success: boolean;
    user: any;
    permissions: string[];
    error?: string;
  }> {
    try {
      // Test basic user info access
      const userResponse = await axios.get(
        "https://graph.facebook.com/v23.0/me",
        {
          params: {
            access_token: this.accessToken,
            fields: "id,name,email",
          },
        }
      );

      // Test permissions
      const permissionsResponse = await axios.get(
        "https://graph.facebook.com/v23.0/me/permissions",
        {
          params: {
            access_token: this.accessToken,
          },
        }
      );

      const grantedPermissions = permissionsResponse.data.data
        .filter((p: any) => p.status === "granted")
        .map((p: any) => p.permission);

      return {
        success: true,
        user: userResponse.data,
        permissions: grantedPermissions,
      };
    } catch (error: any) {
      return {
        success: false,
        user: null,
        permissions: [],
        error: error.response?.data?.error?.message || error.message,
      };
    }
  }

  /**
   * Refresh long-lived access token
   */
  async refreshAccessToken(): Promise<{
    access_token: string;
    expires_in?: number;
  }> {
    try {
      const response = await axios.get(
        "https://graph.facebook.com/v23.0/oauth/access_token",
        {
          params: {
            grant_type: "fb_exchange_token",
            client_id: process.env.FACEBOOK_APP_ID,
            client_secret: process.env.FACEBOOK_APP_SECRET,
            fb_exchange_token: this.accessToken,
          },
        }
      );

      return response.data;
    } catch (error) {
      console.error("Error refreshing access token:", error);
      throw new Error("Failed to refresh access token");
    }
  }
}