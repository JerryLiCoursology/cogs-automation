First pull the repo and run npm i

You need to create new app because current app i have added callback url

after that create database in the localhost and then run push command.

run ngrok and link to the 3000
after that run shopify app dev --tunnel-url=https://3b40b3ca12c7.ngrok-free.app:3000

SHOPIFY_APP_URL=ngrok_url

# Database Configuration

DATABASE_URL=postgresql://postgres@localhost:5432/cogs

# Facebook OAuth Configuration

FACEBOOK_APP_ID=ID
FACEBOOK_APP_SECRET=
FACEBOOK_REDIRECT_URI=ngrok_url/app/meta-callback
