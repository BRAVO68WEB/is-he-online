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
   npm install
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your Discord bot token and target user ID
   ```

3. **Development**:
   ```bash
   npm run dev
   ```

4. **Production**:
   ```bash
   npm run build
   npm start
   ```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_TOKEN` | ✅ | Discord bot token |
| `TARGET_USER_ID` | ✅ | Discord user ID to monitor |
| `PORT` | ❌ | Server port (default: 3000) |
| `API_KEY` | ❌ | API key for VSCode endpoint (auto-generated if not provided) |

## API Endpoints

### GET `/health`
Health check endpoint
```json
{
  "status": "ok",
  "botConnected": true,
  "monitoringUser": "123456789",
  "activeStreams": 2,
  "hasVSCodeActivity": true,
  "apiKeyRequired": true
}
```

### GET `/activity`
Current Discord activity
```json
{
  "userId": "123456789",
  "username": "bravo68web",
  "status": "online",
  "activities": [...],
  "timestamp": 1754541822449
}
```

### GET `/events`
Server-Sent Events stream for real-time updates
```
event: activity-update
data: {"userId":"123...","status":"online",...}

event: vscode-update  
data: {"workspace":{"name":"my-project"},...}

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
  "timestamp": 1754541822449
}
```

## Performance

uWebSockets.js provides exceptional performance:
- ⚡ **8x faster** than Node.js HTTP
- 📈 **Lower memory usage** than traditional frameworks
- 🔄 **Better SSE handling** - No connection limits or timeouts
- 🚀 **C++ core** with JavaScript bindings
