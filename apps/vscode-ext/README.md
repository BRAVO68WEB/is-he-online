# Bravo's VS Code Presence Monitor

VSCode extension that monitors your coding presence and broadcasts it to the Is He Online API for real-time tracking.

## Features

- 📂 **Workspace monitoring** - Track current workspace and project
- 📄 **File tracking** - Monitor active file and cursor position
- 🌿 **Git integration** - Detect repository, branch, and remote info
- 🔒 **Secure API communication** - API key authentication
- 📊 **Real-time updates** - Configurable update intervals
- 🎯 **Status bar integration** - Visual feedback in VSCode

## Installation

### From VSIX (Recommended)
1. **Build the extension**:
   ```bash
   npm run build
   npm run package
   ```

2. **Install in VSCode**:
   - Open VSCode
   - Go to Extensions view (Ctrl+Shift+X)
   - Click "..." → "Install from VSIX..."
   - Select the generated `.vsix` file

### Development
1. **Open in VSCode**:
   ```bash
   code apps/vscode-ext
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start development**:
   ```bash
   npm run dev
   ```

4. **Test the extension**:
   - Press F5 to open Extension Development Host
   - Test commands and functionality

## Configuration

The extension provides several configuration options:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `codingActivityMonitor.enabled` | boolean | `true` | Enable/disable the extension |
| `codingActivityMonitor.serverUrl` | string | `http://localhost:3000` | API server URL |
| `codingActivityMonitor.updateInterval` | number | `5000` | Update interval in milliseconds |
| `codingActivityMonitor.apiKey` | string | `""` | API key for authentication |

## Commands

| Command | Description |
|---------|-------------|
| `codingActivityMonitor.start` | Start monitoring activity |
| `codingActivityMonitor.stop` | Stop monitoring activity |
| `codingActivityMonitor.status` | Show current status |
| `codingActivityMonitor.setApiKey` | Set/update API key |

## Setup

1. **Start the API server** (in `packages/api`):
   ```bash
   cd packages/api
   npm run dev
   ```

2. **Install and configure the extension**:
   - Install the extension in VSCode
   - Run command: "Coding Activity Monitor: Set API Key"
   - Enter the API key from the server logs
   - Run command: "Coding Activity Monitor: Start"

3. **Verify it's working**:
   - Check the status bar for the monitor indicator
   - Open the demo client to see real-time updates
   - Check the API server logs for activity updates

## Status Bar

The extension shows a status indicator in the VSCode status bar:

- 🟢 **Active** - Monitoring and sending data
- 🔑 **Need API Key** - API key required
- 🔴 **Stopped** - Monitoring disabled
- ⚠️ **Error** - Connection or authentication issues

## Data Sent

The extension sends the following data to the API:

```json
{
  "workspace": {
    "name": "my-project",
    "path": "/path/to/workspace",
    "gitRepo": {
      "name": "repository-name",
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
    "selection": {
      "start": { "line": 41, "character": 0 },
      "end": { "line": 41, "character": 15 }
    }
  },
  "timestamp": 1754541822449
}
```

## Privacy

- No file contents are ever transmitted
- Only metadata about your coding session is sent
- All data is sent to your local API server
- API key protects against unauthorized access

## Troubleshooting

### Extension Not Working
1. Check if the API server is running
2. Verify the API key is set correctly
3. Check the VSCode Developer Console for errors
4. Ensure the server URL is correct in settings

### Authentication Errors
1. Run "Coding Activity Monitor: Set API Key"
2. Copy the API key from the server logs
3. Restart the monitoring

### Connection Issues
1. Check if the API server is accessible
2. Verify firewall settings
3. Test the `/health` endpoint manually