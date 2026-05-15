# Gmail OAuth setup (one-time)

Wire up hands-free email sending via the `send_email` tool. Until this is
done, `send_email` returns a clear "not configured" error and the agent
falls back to `compose_email`, which opens a prefilled draft in your
default mail client (Outlook / Mail.app / Gmail web) for you to glance at
and Send.

## What you'll end up with

Three env vars on your machine:

```
GMAIL_OAUTH_CLIENT_ID=...apps.googleusercontent.com
GMAIL_OAUTH_CLIENT_SECRET=GOCSPX-...
GMAIL_OAUTH_REFRESH_TOKEN=1//...
```

Put them in `~/.atlas/env` (or wherever you load shell env from) **or** in
`atlas/.env.local` if you're running from source. The desktop reads them
via `std::env::var()` at tool-call time.

## Steps

### 1. Create a Google Cloud project and enable Gmail API

1. Go to https://console.cloud.google.com → create a new project (or use
   one you already have).
2. APIs & Services → Library → search **"Gmail API"** → **Enable**.

### 2. Configure the OAuth consent screen

1. APIs & Services → OAuth consent screen.
2. User type: **External** (for personal Gmail) or **Internal** (Workspace).
3. App name: `Atlas`. Support email: your address. Save.
4. Scopes: add `https://www.googleapis.com/auth/gmail.send`. Save.
5. Test users: add **your own Gmail address** — without this, OAuth will
   refuse to issue tokens while the app is in "Testing" mode. Save.

### 3. Create an OAuth client

1. APIs & Services → Credentials → **Create credentials** → **OAuth client ID**.
2. Application type: **Desktop app**.
3. Name: `Atlas desktop`.
4. Copy **Client ID** and **Client secret** — these become
   `GMAIL_OAUTH_CLIENT_ID` and `GMAIL_OAUTH_CLIENT_SECRET`.

### 4. Get a refresh token (one-time, via OAuth Playground)

The easiest way to mint a refresh token without writing custom auth code:

1. Open https://developers.google.com/oauthplayground.
2. ⚙️ (top-right) → check **"Use your own OAuth credentials"** → paste
   your client ID + secret → close.
3. Step 1 (left panel) → in **"Input your own scopes"** type
   `https://www.googleapis.com/auth/gmail.send` → **Authorize APIs**.
4. Google's consent screen: sign in as the Gmail you added as a Test user,
   click **Continue** through the unverified-app warning.
5. Step 2 → **Exchange authorization code for tokens**.
6. Copy the **Refresh token** field — this is `GMAIL_OAUTH_REFRESH_TOKEN`.

> Refresh tokens for apps in "Testing" mode expire after **7 days**. To
> get a non-expiring refresh token, publish the OAuth consent screen to
> "In production" (a self-service flow that for `gmail.send` doesn't
> require Google's restricted-scopes verification because `gmail.send` is
> a regular sensitive scope, not restricted).

### 5. Drop the env vars into your shell

```bash
export GMAIL_OAUTH_CLIENT_ID="...apps.googleusercontent.com"
export GMAIL_OAUTH_CLIENT_SECRET="GOCSPX-..."
export GMAIL_OAUTH_REFRESH_TOKEN="1//..."
```

Then relaunch Atlas. Ask: *"Atlas, send an email to a@b.com saying I'm
running late."* The agent now calls `send_email` and the message lands in
the recipient's inbox without you touching the keyboard.

## Verifying

```bash
# Quick sanity check that the refresh token is alive:
curl -s https://oauth2.googleapis.com/token \
  -d "client_id=$GMAIL_OAUTH_CLIENT_ID" \
  -d "client_secret=$GMAIL_OAUTH_CLIENT_SECRET" \
  -d "refresh_token=$GMAIL_OAUTH_REFRESH_TOKEN" \
  -d "grant_type=refresh_token"
# Expect: {"access_token":"ya29...","expires_in":3599,"scope":"...gmail.send","token_type":"Bearer"}
```

## Troubleshooting

- `invalid_grant` from the token endpoint → refresh token expired (Testing
  mode 7-day TTL) or was revoked. Re-run step 4.
- `403 access_denied` during the Playground consent → your Gmail isn't in
  the **Test users** list. Add it in step 2.
- `gmail.send` 403 with "Insufficient Permission" → the refresh token was
  minted without the `gmail.send` scope. Re-run step 4 with the scope
  added (step 3 of the Playground flow).
