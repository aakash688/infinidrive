# Cloudflare R2 Setup Guide

## Why R2?

R2 is used as an intermediate cache for large file uploads to:
- **Prevent timeouts**: Large files (900MB+) are downloaded and stored in R2 first
- **Enable parallel uploads**: Multiple bots can upload chunks simultaneously from R2
- **Improve reliability**: Files are cached even if download/upload fails
- **Free tier**: 10GB storage, 1M operations/month (perfect for our use case)

## Setup Instructions

### 1. Enable R2 in Cloudflare Dashboard

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Select your account
3. Navigate to **R2** in the left sidebar
4. If R2 is not enabled, click **"Get Started"** or **"Enable R2"**
5. Accept the terms and enable R2

### 2. Create R2 Bucket

1. In the R2 section, click **"Create bucket"**
2. Bucket name: `infinidrive-cache`
3. Location: Choose closest to your users (or default)
4. Click **"Create bucket"**

### 3. Update wrangler.toml

Uncomment the R2 binding in `backend/wrangler.toml`:

```toml
# R2 bucket for intermediate file cache (free tier: 10GB storage, 1M operations/month)
[[r2_buckets]]
binding = "CACHE"
bucket_name = "infinidrive-cache"
preview_bucket_name = "infinidrive-cache-preview"
```

### 4. Redeploy

```bash
cd backend
npx wrangler deploy
```

## How It Works

1. **File received** → Download from Telegram
2. **Store in R2** → Temporary cache (prevents re-download on failure)
3. **Split into chunks** → 20MB chunks
4. **Parallel upload** → Multiple bots upload chunks simultaneously
5. **Delete from R2** → Cleanup after successful upload

## Benefits

- ✅ **No timeouts**: Files are cached, so retries don't require re-download
- ✅ **Faster uploads**: Parallel chunk uploads using multiple bots
- ✅ **Better reliability**: Files survive worker restarts
- ✅ **Free tier**: 10GB storage, 1M operations/month (more than enough)

## Without R2

The system will still work without R2, but:
- Large files may timeout during download
- No caching (must re-download on failure)
- Slower uploads (sequential chunk uploads)

## Monitoring

Check R2 usage in Cloudflare Dashboard:
- **Storage**: Should stay under 10GB (free tier)
- **Operations**: Should stay under 1M/month (free tier)
- **Files**: Automatically cleaned up after upload
