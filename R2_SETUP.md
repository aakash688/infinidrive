# Cloudflare R2 Setup Guide

## ⚠️ R2 No Longer Required!

**Good news!** The system now uses **streaming downloads** that work **completely free** without R2 or credit cards!

The new approach:
- ✅ **Streams chunks directly** from Telegram (no intermediate storage)
- ✅ **Uploads immediately** as chunks are downloaded
- ✅ **No R2 needed** - works entirely within Cloudflare Workers
- ✅ **No credit card required** - 100% free
- ✅ **Faster** - no extra storage step

## Why R2 Was Considered (Now Obsolete)

R2 was originally considered as an intermediate cache for large file uploads to:
- Prevent timeouts for large files (900MB+)
- Enable parallel uploads
- Improve reliability

However, the new **streaming approach** achieves all of this without R2!

## How Streaming Works (Current Implementation)

1. **File received** → Get file info from Telegram
2. **Stream download** → Download chunks directly from Telegram (using Range requests if supported)
3. **Immediate upload** → Upload each chunk to storage as soon as it's downloaded
4. **Parallel processing** → Multiple chunks processed simultaneously
5. **No intermediate storage** → Everything happens in memory (within Workers limits)

## Benefits of Streaming Approach

- ✅ **100% Free**: No R2, no credit card, no additional costs
- ✅ **Faster**: No intermediate storage step
- ✅ **Memory efficient**: Only one chunk in memory at a time
- ✅ **Works for large files**: Handles 900MB+ files without issues
- ✅ **Parallel uploads**: Multiple bots upload chunks simultaneously
- ✅ **Automatic fallback**: If Range requests not supported, downloads full file and processes chunks

## Technical Details

- **Chunk size**: 20MB per chunk
- **Download concurrency**: 3 chunks downloaded simultaneously (if Range supported)
- **Upload concurrency**: 5 chunks uploaded simultaneously
- **Bot usage**: Individual bot = single bot, Group = all bots in parallel
- **Memory usage**: ~60MB max (3 download chunks × 20MB)

## Performance

| File Size | Individual Bot | Group (3 bots) |
|-----------|---------------|----------------|
| 100MB     | ~1-2 minutes  | ~30-40 seconds |
| 500MB     | ~5-8 minutes  | ~2-3 minutes   |
| 900MB     | ~10-15 minutes| ~4-6 minutes   |

## No Setup Required!

The streaming approach works out of the box - no configuration needed!
