# Is He Online? - Demo Dashboard

Real-time web dashboard for visualizing Discord presence and VSCode activity.

## Features

- 📡 **Real-time SSE connection** - Live updates from the API
- 👤 **Discord activity display** - User status and current activities  
- 💻 **VSCode activity display** - Current file, workspace, and Git info
- 🎨 **Modern UI** - Clean, responsive design
- ⚡ **Auto-reconnection** - Handles connection drops gracefully

## Quick Start

1. **Start the API server** (in `packages/api`):
   ```bash
   cd packages/api
   npm run dev
   ```

2. **Start the demo client**:
   ```bash
   npm run dev
   ```

3. **Open your browser**:
   ```
   http://localhost:8080
   ```

## Usage

The demo client automatically connects to the API server at `http://localhost:3000` and displays:

- **Connection Status** - Shows if connected to the SSE stream
- **Discord Activity** - Real-time user presence and activities
- **VSCode Activity** - Current workspace, file, and coding session info
- **Debug Info** - Connection state and last update timestamps

## Configuration

The demo client is configured to connect to:
- **API Server**: `http://localhost:3000`
- **SSE Endpoint**: `http://localhost:3000/events`

To change the API server URL, modify the `API_BASE_URL` variable in `index.html`.
