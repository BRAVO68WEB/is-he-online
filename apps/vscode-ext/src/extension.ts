import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// Types for VSCode activity data
interface VSCodeActivity {
  workspace: {
    name: string;
    path: string;
    gitRepo?: {
      name: string;
      remote: string;
      branch: string;
    };
  };
  editor: {
    fileName: string;
    filePath: string;
    language: string;
    lineNumber: number;
    columnNumber: number;
    selection: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    visibleRange: {
      start: number;
      end: number;
    };
  };
  timestamp: number;
  sessionId: string;
}

class VSCodePresenceMonitor {
  private context: vscode.ExtensionContext;
  private isActive: boolean = false;
  private updateInterval: NodeJS.Timeout | null = null;
  private lastActivity: VSCodeActivity | null = null;
  private serverUrl: string;
  private apiKey: string;
  private sessionId: string;
  private statusBarItem: vscode.StatusBarItem;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.sessionId = this.generateSessionId();
    this.serverUrl = vscode.workspace.getConfiguration('isHeOnline').get('serverUrl') || 'http://localhost:3000';
    this.apiKey = vscode.workspace.getConfiguration('isHeOnline').get('apiKey') || '';
    
    // Create status bar item
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.command = 'isHeOnline.status';
    context.subscriptions.push(this.statusBarItem);
    
    this.setupEventListeners();
    this.updateStatusBar();
  }

  private generateSessionId(): string {
    return `vscode-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private setupEventListeners(): void {
    // Listen for active editor changes
    vscode.window.onDidChangeActiveTextEditor(this.onActiveEditorChanged, this, this.context.subscriptions);
    
    // Listen for cursor position changes
    vscode.window.onDidChangeTextEditorSelection(this.onSelectionChanged, this, this.context.subscriptions);
    
    // Listen for visible range changes (scrolling)
    vscode.window.onDidChangeTextEditorVisibleRanges(this.onVisibleRangeChanged, this, this.context.subscriptions);
    
    // Listen for configuration changes
    vscode.workspace.onDidChangeConfiguration(this.onConfigurationChanged, this, this.context.subscriptions);
  }

  private onActiveEditorChanged(editor: vscode.TextEditor | undefined): void {
    if (this.isActive && editor) {
      this.captureActivity();
    }
  }

  private onSelectionChanged(event: vscode.TextEditorSelectionChangeEvent): void {
    if (this.isActive) {
      this.captureActivity();
    }
  }

  private onVisibleRangeChanged(event: vscode.TextEditorVisibleRangesChangeEvent): void {
    if (this.isActive) {
      this.captureActivity();
    }
  }

  private onConfigurationChanged(event: vscode.ConfigurationChangeEvent): void {
    if (event.affectsConfiguration('isHeOnline.serverUrl')) {
      this.serverUrl = vscode.workspace.getConfiguration('isHeOnline').get('serverUrl') as string || 'http://localhost:3000';
    }
    if (event.affectsConfiguration('isHeOnline.apiKey')) {
      this.apiKey = vscode.workspace.getConfiguration('isHeOnline').get('apiKey') as string || '';
    }
  }

  public start(): void {
    // Check if API key is configured
    if (!this.apiKey.trim()) {
      vscode.window.showWarningMessage(
        'API key is not configured. Please set an API key first.',
        'Set API Key'
      ).then((selection) => {
        if (selection === 'Set API Key') {
          this.setApiKey();
        }
      });
      return;
    }

    this.isActive = true;
    this.captureActivity();
    
    // Set up periodic updates
    const interval = vscode.workspace.getConfiguration('isHeOnline').get('updateInterval') as number || 1000;
    this.updateInterval = setInterval(() => {
      if (this.isActive) {
        this.captureActivity();
      }
    }, interval);

    this.updateStatusBar();
    vscode.window.showInformationMessage('VS Code Presence Monitor started!');
  }

  public stop(): void {
    this.isActive = false;
    
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    this.updateStatusBar();
    vscode.window.showInformationMessage('VS Code Presence Monitor stopped!');
  }

  public showStatus(): void {
    const status = this.isActive ? 'Active' : 'Inactive';
    const lastUpdate = this.lastActivity ? new Date(this.lastActivity.timestamp).toLocaleString() : 'Never';
    const apiKeyStatus = this.apiKey ? 'Configured' : 'Not set';
    
    vscode.window.showInformationMessage(
      `VS Code Presence Monitor - Status: ${status}, Last Update: ${lastUpdate}, Server: ${this.serverUrl}, API Key: ${apiKeyStatus}`
    );
  }

  public async setApiKey(): Promise<void> {
    const apiKey = await vscode.window.showInputBox({
      prompt: 'Enter your API key for the Is He Online broadcast server',
      placeHolder: 'API key (32+ characters)',
      password: true,
      validateInput: (value) => {
        if (!value || value.trim().length < 16) {
          return 'API key must be at least 16 characters long';
        }
        return null;
      }
    });

    if (apiKey) {
      const config = vscode.workspace.getConfiguration('isHeOnline');
      await config.update('apiKey', apiKey.trim(), vscode.ConfigurationTarget.Global);
      this.apiKey = apiKey.trim();
      
      vscode.window.showInformationMessage('API key has been saved securely!');
    }
  }

  private updateStatusBar(): void {
    if (this.isActive) {
      this.statusBarItem.text = '$(pulse) Is He Online';
      this.statusBarItem.tooltip = 'VS Code Presence Monitor is active';
      this.statusBarItem.backgroundColor = undefined;
    } else if (!this.apiKey) {
      this.statusBarItem.text = '$(key) API Key Required';
      this.statusBarItem.tooltip = 'Click to set API key';
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else {
      this.statusBarItem.text = '$(circle-slash) Is He Online';
      this.statusBarItem.tooltip = 'VS Code Presence Monitor is inactive';
      this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    }
    this.statusBarItem.show();
  }

  private async captureActivity(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !editor.document) {
      return;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (!workspaceFolder) {
      return;
    }

    // Get Git repository information
    const gitRepo = await this.getGitRepoInfo(workspaceFolder.uri.fsPath);

    // Get current selection and visible range
    const selection = editor.selection;
    const visibleRanges = editor.visibleRanges;

    const activity: VSCodeActivity = {
      workspace: {
        name: workspaceFolder.name,
        path: workspaceFolder.uri.fsPath,
        gitRepo
      },
      editor: {
        fileName: path.basename(editor.document.fileName),
        filePath: vscode.workspace.asRelativePath(editor.document.fileName),
        language: editor.document.languageId,
        lineNumber: selection.active.line + 1, // VSCode uses 0-based indexing
        columnNumber: selection.active.character + 1,
        selection: {
          start: { line: selection.start.line + 1, character: selection.start.character + 1 },
          end: { line: selection.end.line + 1, character: selection.end.character + 1 }
        },
        visibleRange: {
          start: visibleRanges.length > 0 ? visibleRanges[0].start.line + 1 : 1,
          end: visibleRanges.length > 0 ? visibleRanges[0].end.line + 1 : 1
        }
      },
      timestamp: Date.now(),
      sessionId: this.sessionId
    };

    // Only send if activity has changed significantly
    if (this.hasActivityChanged(activity)) {
      this.lastActivity = activity;
      await this.sendActivity(activity);
    }
  }

  private hasActivityChanged(newActivity: VSCodeActivity): boolean {
    if (!this.lastActivity) {
      return true;
    }

    const last = this.lastActivity;
    const current = newActivity;

    // Check if significant change occurred
    return (
      last.workspace.path !== current.workspace.path ||
      last.editor.filePath !== current.editor.filePath ||
      last.editor.lineNumber !== current.editor.lineNumber ||
      Math.abs(last.editor.columnNumber - current.editor.columnNumber) > 5 || // Ignore small cursor movements
      Math.abs(last.timestamp - current.timestamp) > 30000 // Force update every 30 seconds
    );
  }

  private async getGitRepoInfo(workspacePath: string): Promise<{ name: string; remote: string; branch: string } | undefined> {
    try {
      const gitDir = path.join(workspacePath, '.git');
      
      if (!fs.existsSync(gitDir)) {
        return undefined;
      }

      // Read current branch
      const headPath = path.join(gitDir, 'HEAD');
      let branch = 'unknown';
      
      if (fs.existsSync(headPath)) {
        const headContent = fs.readFileSync(headPath, 'utf8').trim();
        if (headContent.startsWith('ref: refs/heads/')) {
          branch = headContent.replace('ref: refs/heads/', '');
        }
      }

      // Read remote origin URL
      const configPath = path.join(gitDir, 'config');
      let remote = 'unknown';
      let repoName = path.basename(workspacePath);

      if (fs.existsSync(configPath)) {
        const configContent = fs.readFileSync(configPath, 'utf8');
        const remoteMatch = configContent.match(/\\[remote "origin"\\][\\s\\S]*?url = (.+)/);
        if (remoteMatch) {
          remote = remoteMatch[1].trim();
          // Extract repo name from remote URL
          const repoMatch = remote.match(/[\\/:]([^\\/:]+)\\.git$/);
          if (repoMatch) {
            repoName = repoMatch[1];
          }
        }
      }

      return {
        name: repoName,
        remote: remote,
        branch: branch
      };
    } catch (error) {
      console.error('Error reading git info:', error);
      return undefined;
    }
  }

  private async sendActivity(activity: VSCodeActivity): Promise<void> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Add API key to Authorization header
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(`${this.serverUrl}/vscode-activity`, {
        method: 'POST',
        headers,
        body: JSON.stringify(activity),
      });

      if (!response.ok) {
        if (response.status === 401) {
          console.error('Authentication failed: Invalid API key');
          vscode.window.showErrorMessage(
            'Authentication failed: Invalid API key. Please check your API key.',
            'Set API Key'
          ).then((selection) => {
            if (selection === 'Set API Key') {
              this.setApiKey();
            }
          });
          this.stop(); // Stop monitoring on auth failure
        } else {
          console.error('Failed to send activity:', response.statusText);
        }
      }
    } catch (error) {
      console.error('Error sending activity:', error);
    }
  }

  public dispose(): void {
    this.stop();
    this.statusBarItem.dispose();
  }
}

let presenceMonitor: VSCodePresenceMonitor | null = null;

export function activate(context: vscode.ExtensionContext) {
  console.log('Bravo\'s VS Code Presence Monitor extension is now active!');

  // Create the presence monitor
  presenceMonitor = new VSCodePresenceMonitor(context);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('isHeOnline.start', () => {
      presenceMonitor?.start();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('isHeOnline.stop', () => {
      presenceMonitor?.stop();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('isHeOnline.status', () => {
      presenceMonitor?.showStatus();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('isHeOnline.setApiKey', () => {
      presenceMonitor?.setApiKey();
    })
  );

  // Auto-start if enabled in configuration
  const autoStart = vscode.workspace.getConfiguration('isHeOnline').get('enabled') as boolean;
  if (autoStart) {
    presenceMonitor.start();
  }
}

export function deactivate() {
  presenceMonitor?.dispose();
}