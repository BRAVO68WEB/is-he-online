# Is He Online? - Broadcast API

Ultra-fast uWebSockets.js API for real-time Discord presence and VSCode activity broadcasting.

## Features

- 🚀 **Ultra-fast uWebSockets.js** - C++ performance with JavaScript convenience
- 📡 **Real-time SSE streaming** - No timeout limitations
- 🔒 **API key authentication** - Secure VSCode activity endpoint
- 👤 **Discord presence monitoring** - Track user status and activities
- 💻 **VSCode integration** - Monitor coding activity in real-time
- 🏗️ **TypeScript** - Full type safety

## Quick Start

1. **Install dependencies**:
   ```bash
   yarn install
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your Discord bot token and target user ID
   ```

3. **Development**:
   ```bash
   yarn dev
   ```

4. **Production**:
   ```bash
   yarn build
   yarn start
   ```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_TOKEN` | ✅ | Discord bot token |
| `TARGET_USER_ID` | ✅ | Discord user ID to monitor |
| `PORT` | ❌ | Server port (default: 3000) |
| `REDIS_URL` | ❌ | Redis connection URL (default: redis://localhost:6379) |
| `API_KEY` | ❌ | API key for VSCode endpoint (auto-generated if not provided) |

## API Endpoints

### GET `/health`
Health check endpoint
```json
{
  "status": "ok",
  "botConnected": true,
  "redisConnected": true,
  "monitoringUser": "123456789",
  "activeStreams": 2,
  "hasVSCodeActivity": true,
  "apiKeyRequired": true,
  "discordActive": true,
  "vscodeActive": false,
  "lastDiscordUpdate": 1754541822449,
  "lastVSCodeUpdate": null
}
```

### GET `/activity`
Current Discord activity with lifecycle timestamps
```json
{
  "userId": "123456789",
  "username": "bravo68web",
  "status": "online",
  "activities": [...],
  "timestamp": 1754541822449,
  "online_since": 1754541800000,
  "offline_since": null,
  "last_seen": 1754541822449
}
```

### GET `/events`
Server-Sent Events stream for real-time updates with enhanced timestamps
```
event: activity-update
data: {"userId":"123...","status":"online","online_since":1754541800000,"last_seen":1754541822449,...}

event: vscode-update  
data: {"workspace":{"name":"my-project"},"online_since":1754541800000,"last_seen":1754541822449,...}

event: heartbeat
data: {"timestamp":1754541823410}
```

### POST `/vscode-activity` 🔒
Protected endpoint for VSCode activity updates (requires API key)

**Headers**: `Authorization: Bearer <API_KEY>`

**Body**:
```json
{
  "workspace": {
    "name": "my-project",
    "path": "/path/to/project",
    "gitRepo": {
      "name": "my-repo",
      "remote": "origin",
      "branch": "main"
    }
  },
  "editor": {
    "fileName": "index.ts",
    "filePath": "/path/to/file.ts",
    "language": "typescript",
    "lineNumber": 42,
    "columnNumber": 10,
    "selection": {...}
  },
  "timestamp": 1754541822449,
  "sessionId": "vscode-1754541800000-abc123def"
}
```

**Note**: The API now includes intelligent rate limiting and caching to prevent server bombardment. Requests may receive a `202 Accepted` status if rate limited.

## Performance & Optimizations

### uWebSockets.js Performance
- ⚡ **8x faster** than Node.js HTTP
- 📈 **Lower memory usage** than traditional frameworks
- 🔄 **Better SSE handling** - No connection limits or timeouts
- 🚀 **C++ core** with JavaScript bindings

### Redis Caching & Rate Limiting
- 🗄️ **Persistent storage** - Activity data survives server restarts
- ⏱️ **Lifecycle tracking** - `online_since` and `offline_since` timestamps
- 🚦 **Smart rate limiting** - Prevents API bombardment (max 1 req/5 sec per session)
- 🧠 **Intelligent caching** - Only broadcasts meaningful activity changes
- 🔄 **Automatic cleanup** - Memory management and cache expiration

### VSCode Extension Optimizations
- 🎯 **Event throttling** - Reduces CPU usage and API calls
- 💾 **Memory management** - Automatic cache cleanup and garbage collection hints
- 📦 **Git info caching** - Avoids repeated file system reads
- 🔄 **Queue-based sending** - Prevents request flooding
- ⏰ **Debounced updates** - Batches rapid changes into single requests

## Docker Deployment

### Quick Start with Docker Compose
```bash
# Clone the repository
git clone <repo-url>
cd is-he-online/packages/api

# Set up environment variables
cp .env.example .env
# Edit .env with your Discord token and user ID

# Start the services
docker-compose up -d

# View logs
docker-compose logs -f
```

### Services
- **API Server**: Node.js application with uWebSockets.js
- **Redis**: In-memory data store with persistence
- **Health Checks**: Built-in monitoring for both services
- **Auto-restart**: Services restart automatically on failure
