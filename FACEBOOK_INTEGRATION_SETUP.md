# Facebook Integration Setup Guide

This guide explains how to configure the Facebook login and pixel integration with Conversions API (CAPI) functionality.

## Required Environment Variables

Add these environment variables to your `.env` file:

```env
# Facebook App Credentials
FACEBOOK_APP_ID=your_facebook_app_id
FACEBOOK_APP_SECRET=your_facebook_app_secret

# Your Shopify app URL (used for OAuth callbacks)
SHOPIFY_APP_URL=https://your-app-url.com
```

## Facebook App Configuration

1. **Create a Facebook App** at [developers.facebook.com](https://developers.facebook.com)
2. **Add Facebook Login product** to your app
3. **Configure OAuth redirect URLs**:
   - Add `https://your-app-url.com/auth/facebook/callback` to Valid OAuth Redirect URIs
4. **Request App Review** for the following permissions:
   - `ads_management` - Access to ad accounts and pixels
   - `business_management` - Access to Meta Business assets
   - `read_insights` - Read advertising insights
   - `pages_show_list` - Access to associated pages

## Shopify App Configuration

### Required Scopes

Make sure your Shopify app has the following scopes in `shopify.app.toml`:

```toml
scopes = [
  # ... other scopes
  "write_marketing_events",  # Required for marketing activities
  # Add other required scopes
]
```

### Webhook Configuration

Add these webhooks to your `shopify.app.toml`:

```toml
[[webhooks]]
topics = ["orders/create"]
uri = "/webhooks/orders/create"

[[webhooks]]
topics = ["checkouts/create"]
uri = "/webhooks/checkouts/create"

[[webhooks]]
topics = ["customers/create"]
uri = "/webhooks/customers/create"

[[webhooks]]
topics = ["app/uninstalled"]
uri = "/webhooks/app/uninstalled"
```

## Database Schema

The integration adds a new `Meta` model to track Facebook connections. The migration has been created and applied automatically.

## Features Implemented

### 1. Facebook OAuth Login
- **Route**: `/auth/facebook`
- **Callback**: `/auth/facebook/callback`
- Handles token exchange and long-lived token generation

### 2. Pixel Selection Interface
- **Route**: `/app/facebook/connect`
- Allows users to select their Facebook pixel
- Associates with ad accounts and businesses
- Creates Shopify marketing activities

### 3. Conversions API Integration
- Automatic purchase tracking via webhooks
- Checkout initiation tracking
- Customer registration tracking
- Server-side event sending with proper PII hashing

### 4. Dashboard & Management
- **Route**: `/app/facebook/dashboard`
- Connection status monitoring
- Test event functionality
- Integration health checks

### 5. Shopify Marketing Events
- Creates marketing activities for Facebook campaigns
- Tracks CAPI integration as marketing activity
- Supports UTM parameter tracking

## Usage Flow

1. **User clicks "Facebook Integration" in app navigation**
2. **System redirects to Facebook OAuth** if not connected
3. **User authorizes permissions** and returns to app
4. **User selects Facebook pixel** from their available pixels
5. **System creates Shopify marketing activity** to track integration
6. **Webhooks automatically send events** to Facebook CAPI when:
   - Orders are created (Purchase events)
   - Checkouts are initiated (InitiateCheckout events)
   - Customers register (CompleteRegistration events)

## Event Tracking

### Automatically Tracked Events:
- **Purchase**: When orders are created
- **InitiateCheckout**: When checkout is started
- **CompleteRegistration**: When customers sign up

### Manual Testing:
- Dashboard includes "Send Test Event" functionality
- Supports PageView, ViewContent, AddToCart, and Purchase test events

## Security & Privacy

- All PII data is properly hashed using SHA256 before sending to Facebook
- Long-lived access tokens are stored securely in the database
- Event deduplication prevents duplicate tracking
- Webhook failures don't affect Shopify order processing

## Troubleshooting

### Common Issues:

1. **"Missing write_marketing_events scope"**
   - Reinstall the app with marketing permissions
   - Check `shopify.app.toml` scopes configuration

2. **Facebook API errors**
   - Verify Facebook app is properly configured
   - Check that required permissions are approved
   - Ensure pixel belongs to the authenticated user

3. **Webhook not firing**
   - Verify webhook URLs are correctly configured
   - Check Shopify webhook settings in Partner Dashboard
   - Review webhook delivery logs

4. **CAPI events not showing**
   - Check Facebook Events Manager
   - Verify pixel ID is correct
   - Look for events in test mode first

## Development & Testing

For development, you can use Facebook's test event codes to avoid affecting live pixel data:

1. Get test event code from Facebook Events Manager
2. Pass it to CAPIService constructor as third parameter
3. Events will appear in "Test Events" tab instead of live events

## Next Steps

1. **Add frontend pixel integration** for client-side events and fbp/fbc parameters
2. **Implement product catalog sync** for dynamic ads
3. **Add conversion value optimization** based on LTV
4. **Create automated campaign reporting** dashboard