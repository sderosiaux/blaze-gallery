# Google Authentication Setup Guide

This guide will walk you through enabling Google OAuth 2.0 authentication for your Blaze Gallery instance.

## 🚀 Quick Start

Google authentication is **disabled by default**. Follow these steps to enable it:

1. [Create Google OAuth credentials](#1-create-google-oauth-credentials)
2. [Configure environment variables](#2-configure-environment-variables)
3. [Restart your application](#3-restart-your-application)

## 1. Create Google OAuth Credentials

### Step 1: Go to Google Cloud Console
1. Visit [Google Cloud Console](https://console.cloud.google.com/)
2. Sign in with your Google account

### Step 2: Create or Select a Project
1. Click on the project dropdown at the top
2. Either select an existing project or click "New Project"
3. If creating new: Enter project name (e.g., "Blaze Gallery Auth") and click "Create"

### Step 3: Enable Google+ API (if not already enabled)
1. In the left sidebar, go to "APIs & Services" → "Library"
2. Search for "Google+ API" or "People API"
3. Click on it and press "Enable"

### Step 4: Configure OAuth Consent Screen
1. Go to "APIs & Services" → "OAuth consent screen"
2. Choose "External" (unless you have a Google Workspace account)
3. Fill in the required fields:
   - **App name**: `Blaze Gallery`
   - **User support email**: Your email
   - **Developer contact email**: Your email
4. Click "Save and Continue"
5. Skip "Scopes" (click "Save and Continue")
6. Skip "Test users" for now (click "Save and Continue")

### Step 5: Create OAuth 2.0 Credentials
1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "OAuth 2.0 Client IDs"
3. Choose "Web application"
4. Set the name: `Blaze Gallery Web Client`
5. Add **Authorized JavaScript origins**:
   - For local development: `http://localhost:3000`
   - For production: `https://yourdomain.com`
6. Add **Authorized redirect URIs**:
   - For local development: `http://localhost:3000/api/auth/google/callback`
   - For production: `https://yourdomain.com/api/auth/google/callback`
7. Click "Create"
8. **Save the Client ID and Client Secret** - you'll need these next!

## 2. Configure Environment Variables

Create or update your `.env.local` file (or `.env` file) with the following variables:

```env
# Enable Google Authentication
GOOGLE_AUTH_ENABLED=true

# Google OAuth Credentials (from step 1)
GOOGLE_CLIENT_ID=your_google_client_id_here
GOOGLE_CLIENT_SECRET=your_google_client_secret_here

# Redirect URI (must match what you set in Google Console)
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback

# Email Whitelist (comma-separated list of allowed emails)
AUTH_EMAIL_WHITELIST=your-email@gmail.com,another-email@gmail.com

# Session Configuration
AUTH_SESSION_SECRET=your_very_long_random_secret_at_least_32_characters_long
AUTH_SESSION_DURATION=86400  # 24 hours in seconds

# Your application URL
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 🔒 Security Notes

- **AUTH_SESSION_SECRET**: Generate a secure random string at least 32 characters long. You can use:
  ```bash
  # Generate a secure secret
  openssl rand -base64 32
  ```

- **AUTH_EMAIL_WHITELIST**: Only users with emails in this list can access your gallery. Use comma-separated format.

### 🌐 Production Configuration

For production, update these values:
```env
GOOGLE_REDIRECT_URI=https://yourdomain.com/api/auth/google/callback
NEXT_PUBLIC_APP_URL=https://yourdomain.com
```

Make sure your production redirect URI is also added in the Google Cloud Console credentials.

## 3. Restart Your Application

After configuring the environment variables:

```bash
# Stop your development server (Ctrl+C)
# Then restart it
npm run dev
```

You should see in the console:
```
✅ Authentication enabled and configured correctly
📧 Email whitelist: your-email@gmail.com
```

## 🎉 That's It!

Your Google authentication is now enabled! You'll see:

- A "Sign in with Google" button in the top navigation
- Only whitelisted users can access the gallery
- Users stay signed in for 24 hours (or your configured duration)

## 🔧 Configuration Options

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `GOOGLE_AUTH_ENABLED` | `false` | Enable/disable authentication |
| `GOOGLE_CLIENT_ID` | - | Google OAuth Client ID (required) |
| `GOOGLE_CLIENT_SECRET` | - | Google OAuth Client Secret (required) |
| `GOOGLE_REDIRECT_URI` | Auto-generated | OAuth callback URL |
| `AUTH_EMAIL_WHITELIST` | `derste@gmail.com` | Comma-separated allowed emails |
| `AUTH_SESSION_SECRET` | - | Session encryption key (32+ chars) |
| `AUTH_SESSION_DURATION` | `86400` | Session duration in seconds |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Your app's base URL |

## 🛠️ Troubleshooting

### "Authentication is not enabled" error
- Check that `GOOGLE_AUTH_ENABLED=true` in your environment variables
- Restart your application after adding the variable

### "Google OAuth configuration is incomplete" error
- Verify `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set
- Make sure there are no extra spaces or quotes around the values

### "Email [email] is not authorized" error
- Add the user's email to `AUTH_EMAIL_WHITELIST`
- Make sure emails are comma-separated with no spaces
- Restart the application after updating the whitelist

### "redirect_uri_mismatch" error
- The redirect URI in Google Console must exactly match your `GOOGLE_REDIRECT_URI`
- Check for `http` vs `https` mismatches
- Ensure no trailing slashes

### "origin_mismatch" or CORS errors
- Add your domain to **Authorized JavaScript origins** in Google Console
- For development: `http://localhost:3000` (no trailing slash)
- For production: `https://yourdomain.com` (no trailing slash)
- Make sure the origins match your `NEXT_PUBLIC_APP_URL` exactly

### Users have to re-login frequently
- Increase `AUTH_SESSION_DURATION` (default is 24 hours)
- Check that `AUTH_SESSION_SECRET` is properly set

## 🔄 Disabling Authentication

To disable Google authentication:

1. Set `GOOGLE_AUTH_ENABLED=false` in your environment variables
2. Restart your application

The gallery will return to open access mode.

## 🆘 Need Help?

If you encounter issues:

1. Check the server console for detailed error messages
2. Verify all environment variables are correctly set
3. Ensure your Google Cloud Console configuration matches your environment variables
4. Check that your domain is authorized in Google Console

The authentication system provides detailed logging to help diagnose issues.