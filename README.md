# Is He Online? 👀

[![Turborepo](https://img.shields.io/badge/Built%20with-Turborepo-blue)](https://turbo.build)
[![uWebSockets.js](https://img.shields.io/badge/Powered%20by-uWebSockets.js-green)](https://github.com/uNetworking/uWebSockets.js)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://typescriptlang.org)

A blazing-fast, real-time presence monitoring system for Discord and VSCode activity broadcasting built with modern tools and architecture.

## 🏗️ Architecture

This project uses a **Turborepo monorepo** structure for better organization and development experience:

```
├── packages/
│   └── api/              # @is-he-online/broadcast-api - Ultra-fast uWebSockets.js server
├── apps/
│   ├── demo/             # @is-he-online/demo - Real-time web dashboard  
│   └── vscode-ext/       # @is-he-online/vsc - VS Code presence monitor
```

## ⚡ Key Features

- 🚀 **Ultra-fast uWebSockets.js** - C++ performance, 8x faster than Node.js HTTP
- 📡 **Unlimited SSE streaming** - No timeout limitations, infinite connections
- 🔒 **Secure API authentication** - API key-based middleware protection
- 👤 **Real-time Discord monitoring** - Track user presence and activities
- 💻 **VSCode integration** - Monitor coding sessions, workspace, and Git info
- 🏗️ **Modern monorepo** - Turborepo for efficient development workflow
- 🎯 **TypeScript everywhere** - Full type safety across all packages

## 🚀 Quick Start

### Prerequisites
- Node.js 20+ 
- Discord Bot Token
- Target Discord User ID

### 1. Clone and Install
```bash
git clone https://github.com/BRAVO68WEB/is-he-online
cd is-he-online
npm install
```

### 2. Configure Environment
```bash
cd packages/api
cp .env.example .env
# Edit .env with your Discord credentials
```

### 3. Build All Packages
```bash
npm run build
```

### 4. Start Development
```bash
# Start API server
npm run dev --workspace packages/api

# Start demo client (new terminal)
npm run dev --workspace apps/demo

# Package VSCode extension (optional)
npm run build --workspace apps/vscode-ext
npm run package --workspace apps/vscode-ext
```

## 📦 Packages

### 🔌 Broadcast API (`@is-he-online/broadcast-api`)
Ultra-fast Discord and VSCode activity broadcasting API built with uWebSockets.js.

**Features:**
- Discord bot integration with presence monitoring
- Real-time SSE streaming without timeouts
- Secure API key authentication for VSCode endpoint
- Health monitoring and activity endpoints

**Tech Stack:**
- uWebSockets.js for ultra-fast HTTP/SSE
- Discord.js for bot functionality
- TypeScript for type safety

### 🌐 Demo Dashboard (`@is-he-online/demo`)
Real-time web dashboard for visualizing Discord and VSCode presence activity.

**Features:**
- Live SSE connection to API server
- Real-time Discord presence display
- VSCode coding session visualization
- Modern, responsive UI

### 🔧 VS Code Presence Monitor (`@is-he-online/vsc`)
Bravo's VSCode extension that monitors presence activity and broadcasts it to the API.

**Features:**
- Real-time workspace and file tracking
- Git repository information detection
- Secure API communication with key authentication
- Configurable update intervals
- Status bar integration

## 🛠️ Development

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Build all packages |
| `npm run dev` | Start all packages in development mode |
| `npm run lint` | Lint all packages |
| `npm run clean` | Clean all build outputs |

### Workspace Commands

| Workspace | Description |
|-----------|-------------|
| `npm run dev --workspace packages/api` | Start broadcast API server |
| `npm run dev --workspace apps/demo` | Start demo dashboard |
| `npm run build --workspace apps/vscode-ext` | Build VS Code extension |

## 🔧 Configuration

### API Server (packages/api/.env)
```env
DISCORD_TOKEN=your_discord_bot_token
TARGET_USER_ID=your_discord_user_id
PORT=3000
API_KEY=your_secure_api_key  # Optional, auto-generated if not provided
```

### VS Code Extension Settings  
- **Server URL**: `http://localhost:3000` (default)
- **Update Interval**: `1000ms` (default)
- **API Key**: Set via command palette
- **Enable/Disable**: Toggle presence monitoring

## 📊 API Endpoints

| Endpoint | Method | Description | Authentication |
|----------|--------|-------------|----------------|
| `/health` | GET | Health check and status | None |
| `/activity` | GET | Current Discord activity | None |
| `/events` | GET | SSE stream for real-time updates | None |
| `/vscode-activity` | POST | VSCode activity updates | 🔒 API Key Required |

## 🎯 Performance Benefits

### uWebSockets.js vs Traditional Solutions

| Metric | uWebSockets.js | Node.js HTTP | Improvement |
|--------|----------------|--------------|-------------|
| **Throughput** | ~1M req/s | ~125k req/s | **8x faster** |
| **Memory Usage** | Low | High | **50% less** |
| **SSE Connections** | Unlimited | Limited | **No timeouts** |
| **Latency** | Ultra-low | Standard | **3x lower** |

## 🧪 Testing

Test individual components:

```bash
# Test API server
curl http://localhost:3000/health

# Test SSE connection
curl -N http://localhost:3000/events

# Test protected endpoint (with API key)
curl -X POST -H "Authorization: Bearer <API_KEY>" \
     -H "Content-Type: application/json" \
     -d '{"workspace":{"name":"test"},"editor":{"fileName":"test.ts"}}' \
     http://localhost:3000/vscode-activity
```

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [uWebSockets.js](https://github.com/uNetworking/uWebSockets.js) - Ultra-fast WebSocket and HTTP library
- [Discord.js](https://discord.js.org) - Powerful Discord API library
- [Turborepo](https://turbo.build) - High-performance build system
- [TypeScript](https://typescriptlang.org) - Typed JavaScript at scale