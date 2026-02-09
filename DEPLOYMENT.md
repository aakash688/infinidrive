# Deployment Guide

## Backend (Cloudflare Workers)

1. **Create D1 Database:**
```bash
cd backend
npm install
npm run db:create
# Copy the database_id from output
```

2. **Update wrangler.toml:**
- Set `database_id` in `[[d1_databases]]` section

3. **Run Migrations:**
```bash
npm run db:migrate
```

4. **Set Secrets:**
```bash
wrangler secret put JWT_SECRET
# Enter your JWT secret (random string, keep it safe)
```

5. **Deploy:**
```bash
npm run deploy
```

## Web Panel (Cloudflare Pages)

1. **Build:**
```bash
cd web
npm install
npm run build
```

2. **Deploy to Cloudflare Pages:**
- Go to Cloudflare Dashboard → Pages
- Connect your Git repository
- Build command: `cd web && npm install && npm run build`
- Output directory: `web/dist`
- Set environment variable: `VITE_API_URL=https://your-worker.your-subdomain.workers.dev`

## Mobile App (Android)

1. **Setup Flutter:**
```bash
cd mobile
flutter pub get
```

2. **Update API URL:**
- Edit `lib/services/api_service.dart`
- Set `_apiBase` to your Cloudflare Worker URL

3. **Build APK:**
```bash
flutter build apk --release
```

4. **Distribute:**
- Upload APK to Google Play Store or distribute directly

## Desktop App (Windows)

1. **Setup Flutter:**
```bash
cd desktop
flutter pub get
```

2. **Update API URL:**
- Edit `lib/services/api_service.dart`
- Set `_apiBase` to your Cloudflare Worker URL

3. **Build:**
```bash
flutter build windows --release
```

4. **Create Installer:**
- Use Inno Setup or similar tool to create installer from `build/windows/runner/Release/`

## Chrome Extension

1. **Build TypeScript:**
```bash
cd chrome-extension
npm install
npm run build  # If you have a build script
```

2. **Load in Chrome:**
- Open `chrome://extensions/`
- Enable "Developer mode"
- Click "Load unpacked"
- Select `chrome-extension` folder

3. **Update API URL:**
- Edit `background/service-worker.ts`
- Set `API_BASE` to your Cloudflare Worker URL

## Android TV App

1. **Setup Flutter:**
```bash
cd tv
flutter pub get
```

2. **Update API URL:**
- Edit `lib/services/api_service.dart`
- Set `_apiBase` to your Cloudflare Worker URL

3. **Build APK:**
```bash
flutter build apk --release
```

4. **Install on TV:**
- Transfer APK to Android TV
- Install via file manager or ADB

## Environment Variables

### Backend (Cloudflare Workers)
- `JWT_SECRET` - Secret for JWT signing (set via `wrangler secret put`)
- `TELEGRAM_BOT_TOKEN` - Main bot token for Telegram Login verification (set via `wrangler secret put`)

### Web Panel
- `VITE_API_URL` - Backend API URL (set in Cloudflare Pages environment variables)

### Mobile/Desktop/TV Apps
- Update `_apiBase` in `lib/services/api_service.dart` to your Cloudflare Worker URL

## Post-Deployment Checklist

- [ ] Backend deployed and accessible
- [ ] D1 database created and migrated
- [ ] JWT_SECRET set
- [ ] Web panel deployed with correct API URL
- [ ] Mobile app built with correct API URL
- [ ] Desktop app built with correct API URL
- [ ] Chrome extension loaded with correct API URL
- [ ] TV app built with correct API URL
- [ ] Test login flow on all platforms
- [ ] Test file upload/download
- [ ] Test sharing functionality
- [ ] Test community features
