# ♾️ InfiniDrive - Unlimited Cloud Storage

**InfiniDrive** is a decentralized cloud storage platform powered by Telegram's unlimited storage. Store unlimited files using your own Telegram bots as storage backends.

![InfiniDrive](https://img.shields.io/badge/InfiniDrive-Unlimited%20Storage-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)
![SolidJS](https://img.shields.io/badge/SolidJS-1.8-2c4f7c)

## 🌟 Features

- **♾️ Unlimited Storage** - Leverage Telegram's unlimited file storage
- **🔐 Self-Hosted** - Use your own Telegram bots for complete control
- **📁 File Management** - Full file manager with folders, search, and organization
- **🔑 API Access** - RESTful API with project-based organization
- **📱 Multi-Platform** - Web panel, mobile app, desktop app, and browser extension
- **🔒 Secure** - JWT authentication, API keys, and encrypted storage
- **⚡ Fast** - Built on Cloudflare Workers and D1 for global edge performance
- **📤 Chunked Uploads** - Large files split into chunks for reliable uploads
- **🔍 Search & Filter** - Find files quickly with advanced search
- **📊 Analytics** - Track storage usage and file statistics

## 🏗️ Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Web UI    │────▶│  Cloudflare │────▶│  Telegram   │
│  (SolidJS)  │     │   Workers   │     │     Bot     │
└─────────────┘     └──────────────┘     └─────────────┘
                            │
                            ▼
                    ┌──────────────┐
                    │  Cloudflare  │
                    │     D1 DB    │
                    └──────────────┘
```

- **Frontend**: SolidJS web application deployed on Cloudflare Pages
- **Backend**: Hono.js API on Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite)
- **Storage**: Telegram Bot API (unlimited file storage)

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and npm
- Cloudflare account (for Workers, D1, and Pages)
- Telegram account (to create bots via @BotFather)

### 1. Clone the Repository

```bash
git clone https://github.com/aakash688/infinidrive.git
cd infinidrive
```

### 2. Backend Setup

```bash
cd backend
npm install

# Configure wrangler.toml with your D1 database ID
# Then apply migrations:
wrangler d1 execute infinidrive-db --remote --file=migrations/0001_initial_schema.sql
wrangler d1 execute infinidrive-db --remote --file=migrations/0002_add_folders.sql
wrangler d1 execute infinidrive-db --remote --file=migrations/0003_add_projects_api_keys.sql

# Set secrets
wrangler secret put JWT_SECRET  # Generate a secure random string

# Deploy
npm run deploy
```

### 3. Frontend Setup

```bash
cd web
npm install

# Update src/services/api.ts with your backend URL
# Or set VITE_API_URL environment variable

# Build
npm run build

# Deploy to Cloudflare Pages
wrangler pages deploy dist --project-name=infinidrive-web
```

### 4. Create Your First Bot

1. Open Telegram and search for [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow instructions
3. Copy the bot token
4. Visit your deployed web panel
5. Go to Settings → Add Bot
6. Paste the token and configure a storage channel

## 📖 Documentation

### Web Panel Features

- **📁 Files Page**: Upload, organize, search, and manage files
- **📦 Projects**: Create projects for API-based file organization
- **🔑 API Keys**: Generate keys for programmatic access
- **⚙️ Settings**: Manage bots, channels, and account settings
- **📊 Dashboard**: View storage statistics and usage

### API Documentation

The API is available at `/api/v1/` with full REST endpoints for:

- **File Operations**: Upload, download, list, delete
- **Folder Operations**: Create, list, delete folders
- **Project Management**: Get project info and stats

#### Authentication

All API requests require an API key:

```bash
Authorization: Bearer infini_your_api_key_here
```

#### Example: Upload a File

```bash
curl -X POST https://your-backend.workers.dev/api/v1/files/upload \
  -H "Authorization: Bearer infini_your_key" \
  -H "Content-Type: application/json" \
  -d '{
    "file_name": "document.pdf",
    "file_data": "'$(base64 -w0 document.pdf)'",
    "mime_type": "application/pdf"
  }'
```

#### Example: List Files

```bash
curl https://your-backend.workers.dev/api/v1/files \
  -H "Authorization: Bearer infini_your_key"
```

See the [API Documentation](https://infinidrive-web.pages.dev/api) in the web panel for complete examples in Python, JavaScript, and cURL.

### Project Structure

```
infinidrive/
├── backend/              # Cloudflare Workers backend
│   ├── src/
│   │   ├── routes/      # API route handlers
│   │   ├── services/    # Business logic
│   │   └── middleware/  # Auth & validation
│   ├── migrations/      # D1 database migrations
│   └── wrangler.toml    # Cloudflare config
│
├── web/                 # SolidJS frontend
│   ├── src/
│   │   ├── pages/      # Page components
│   │   └── services/   # API client
│   └── vite.config.ts  # Vite config
│
├── mobile/              # Flutter mobile app
├── desktop/             # Desktop application
├── chrome-extension/    # Browser extension
└── README.md
```

## 🔧 Configuration

### Backend Environment Variables

Set via `wrangler secret put`:

- `JWT_SECRET`: Secret key for JWT token signing (required)
- `TELEGRAM_BOT_TOKEN`: Optional, for secure Telegram Login verification

### Frontend Environment Variables

Create `.env` or set in build:

- `VITE_API_URL`: Backend API URL (defaults to production URL)

## 📚 API Endpoints

### Authentication (JWT)
- `POST /api/auth/telegram` - Login with Telegram
- `GET /api/auth/bot-username` - Get bot username

### File Management
- `POST /api/files/upload/init` - Initialize upload
- `POST /api/files/upload/chunk` - Upload chunk
- `GET /api/files/list` - List files
- `GET /api/files/:id/stream` - Stream file
- `GET /api/files/:id/download` - Download file
- `PUT /api/files/:id` - Update file metadata
- `DELETE /api/files/:id` - Delete file

### Folder Management
- `POST /api/folders/create` - Create folder
- `GET /api/folders/list` - List folders
- `GET /api/folders/tree` - Get folder tree
- `PUT /api/folders/:id` - Update folder
- `DELETE /api/folders/:id` - Delete folder

### Projects & API Keys
- `POST /api/projects/create` - Create project
- `GET /api/projects/list` - List projects
- `POST /api/keys/create` - Create API key
- `GET /api/keys/list` - List API keys
- `DELETE /api/keys/:id` - Revoke key

### Public API (v1)
- `POST /api/v1/files/upload` - Upload file
- `GET /api/v1/files` - List files
- `GET /api/v1/files/:id/download` - Download file
- `POST /api/v1/folders` - Create folder
- `GET /api/v1/folders` - List folders
- See full docs in web panel at `/api`

## 🛠️ Development

### Local Development

**Backend:**
```bash
cd backend
npm run dev  # Runs on http://localhost:8787
```

**Frontend:**
```bash
cd web
npm run dev  # Runs on http://localhost:5173
```

### Database Migrations

```bash
# Apply migration to remote
wrangler d1 execute infinidrive-db --remote --file=migrations/XXXX_name.sql

# Apply to local dev
wrangler d1 execute infinidrive-db --local --file=migrations/XXXX_name.sql
```

## 🔒 Security

- **JWT Authentication**: Secure token-based auth for web panel
- **API Key Authentication**: Scoped keys with read/write permissions
- **Encrypted Storage**: Bot tokens encrypted in database
- **CORS Protection**: Configured for your domains
- **Rate Limiting**: Built-in Telegram API rate limiting

## 📝 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📧 Support

- **Issues**: [GitHub Issues](https://github.com/aakash688/infinidrive/issues)
- **Documentation**: See web panel at `/api` for API docs

## 🙏 Acknowledgments

- Built with [Cloudflare Workers](https://workers.cloudflare.com/)
- Frontend powered by [SolidJS](https://www.solidjs.com/)
- Storage powered by [Telegram Bot API](https://core.telegram.org/bots/api)

## ⭐ Star History

If you find this project useful, please consider giving it a star!

---

**Made with ♾️ by [aakash688](https://github.com/aakash688)**
