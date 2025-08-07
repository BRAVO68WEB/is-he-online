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

// Cache for git repository information to avoid repeated file reads
interface GitRepoCache {
  [workspacePath: string]: {
    info: { name: string; remote: string; branch: string } | undefined;
    lastChecked: number;
    ttl: number;
  };
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
  
  // Memory optimization: Caching and throttling
  private gitRepoCache: GitRepoCache = {};
  private lastSentTimestamp: number = 0;
  private sendQueue: VSCodeActivity[] = [];
  private isSending: boolean = false;
  private rateLimitDelay: number = 1000; // Minimum 1 second between sends
  private debounceTimer: NodeJS.Timeout | null = null;
  private readonly CACHE_TTL = 30000; // 30 seconds cache TTL for git info
  
  // Performance optimization: Event throttling
  private readonly EVENT_THROTTLE_MS = 200; // Throttle events to max once per 200ms
  private lastEventTimestamp: number = 0;
  
  // Heartbeat system
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private readonly HEARTBEAT_INTERVAL = 20000; // Send heartbeat every 20 seconds (timeout is 30s)
  private sessionStarted: boolean = false;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.sessionId = this.generateSessionId();
    this.loadConfiguration();
    
    // Create status bar item
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.statusBarItem.command = 'isHeOnline.status';
    context.subscriptions.push(this.statusBarItem);
    
    this.setupEventListeners();
    this.updateStatusBar();
    
    // Cleanup interval for memory management
    this.setupCleanupInterval();
    
    // constructor init
    this.serverUrl = vscode.workspace.getConfiguration('isHeOnline').get('serverUrl') || 'http://localhost:3000';
    this.apiKey = vscode.workspace.getConfiguration('isHeOnline').get('apiKey') || '';
    this.rateLimitDelay = Math.max(vscode.workspace.getConfiguration('isHeOnline').get('updateInterval') || 2000, 1000); // Min 1 second
  }

  private loadConfiguration(): void {
    const config = vscode.workspace.getConfiguration('isHeOnline');
    this.serverUrl = config.get('serverUrl') || 'http://localhost:3000';
    this.apiKey = config.get('apiKey') || '';
    this.rateLimitDelay = Math.max(config.get('updateInterval') || 2000, 1000); // Min 1 second
  }

  private generateSessionId(): string {
    return `vscode-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private setupCleanupInterval(): void {
    // Clean up cache every 5 minutes to prevent memory leaks
    const cleanupInterval = setInterval(() => {
      this.cleanupCaches();
    }, 5 * 60 * 1000);
    
    this.context.subscriptions.push({
      dispose: () => clearInterval(cleanupInterval)
    });
  }

  private cleanupCaches(): void {
    const now = Date.now();
    
    // Clean up expired git repo cache entries
    for (const [path, cache] of Object.entries(this.gitRepoCache)) {
      if (now - cache.lastChecked > cache.ttl) {
        delete this.gitRepoCache[path];
      }
    }
    
    // Clear old activity if not active
    if (!this.isActive && this.lastActivity) {
      this.lastActivity = null;
    }
    
    // Clear send queue if too old
    this.sendQueue = this.sendQueue.filter(activity => 
      now - activity.timestamp < 30000 // Keep only last 30 seconds
    );
    
    // Force garbage collection hint (if available)
    if (global.gc) {
      global.gc();
    }
  }

  private setupEventListeners(): void {
    // Throttled event handlers to prevent excessive calls
    const throttledCaptureActivity = this.throttle(() => {
      if (this.isActive) {
        this.captureActivityDebounced();
      }
    }, this.EVENT_THROTTLE_MS);

    // Listen for active editor changes
    this.context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(() => throttledCaptureActivity())
    );
    
    // Listen for cursor position changes (throttled more aggressively)
    this.context.subscriptions.push(
      vscode.window.onDidChangeTextEditorSelection(this.throttle(() => {
        if (this.isActive) {
          this.captureActivityDebounced();
        }
      }, 1000)) // 1 second throttle for selection changes
    );
    
    // Listen for visible range changes (scrolling) - least priority
    this.context.subscriptions.push(
      vscode.window.onDidChangeTextEditorVisibleRanges(this.throttle(() => {
        if (this.isActive) {
          this.captureActivityDebounced();
        }
      }, 2000)) // 2 second throttle for scrolling
    );
    
    // Listen for configuration changes
    this.context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('isHeOnline')) {
          this.loadConfiguration();
        }
      })
    );
  }

  // Utility method for throttling function calls
  private throttle<T extends (...args: any[]) => void>(func: T, delay: number): T {
    let lastCallTime = 0;
    return ((...args: any[]) => {
      const now = Date.now();
      if (now - lastCallTime >= delay) {
        lastCallTime = now;
        func(...args);
      }
    }) as T;
  }

  // Debounced activity capture to avoid rapid-fire updates
  private captureActivityDebounced(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    
    this.debounceTimer = setTimeout(() => {
      this.captureActivity();
    }, 500); // 500ms debounce
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
    
    // Set up periodic updates with longer intervals to reduce server load
    const interval = Math.max(this.rateLimitDelay, 5000); // Minimum 5 seconds
    this.updateInterval = setInterval(() => {
      if (this.isActive) {
        this.captureActivity();
      }
    }, interval);

    // Start heartbeat system
    this.startHeartbeat();

    this.updateStatusBar();
    vscode.window.showInformationMessage('VS Code Presence Monitor started!');
  }

  public stop(): void {
    this.isActive = false;
    
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Stop heartbeat
    this.stopHeartbeat();

    // Send final offline signal
    this.sendOfflineSignal().catch(() => {
      // Ignore cleanup errors during stop
    });
    
    this.updateStatusBar();
    vscode.window.showInformationMessage('VS Code Presence Monitor stopped!');
  }

  public showStatus(): void {
    const status = this.isActive ? 'Active' : 'Inactive';
    const lastUpdate = this.lastActivity ? new Date(this.lastActivity.timestamp).toLocaleString() : 'Never';
    const apiKeyStatus = this.apiKey ? 'Configured' : 'Not set';
    const cacheSize = Object.keys(this.gitRepoCache).length;
    
    vscode.window.showInformationMessage(
      `VS Code Presence Monitor - Status: ${status}, Last Update: ${lastUpdate}, Server: ${this.serverUrl}, API Key: ${apiKeyStatus}, Cache entries: ${cacheSize}`
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

    // Get Git repository information (cached)
    const gitRepo = await this.getGitRepoInfoCached(workspaceFolder.uri.fsPath);

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
      this.queueActivity(activity);
    }
  }

  private hasActivityChanged(newActivity: VSCodeActivity): boolean {
    if (!this.lastActivity) {
      return true;
    }

    const last = this.lastActivity;
    const current = newActivity;

    // Check if significant change occurred (more strict criteria to reduce API calls)
    return (
      last.workspace.path !== current.workspace.path ||
      last.editor.filePath !== current.editor.filePath ||
      Math.abs(last.editor.lineNumber - current.editor.lineNumber) > 2 || // Ignore single line movements
      Math.abs(last.editor.columnNumber - current.editor.columnNumber) > 10 || // Ignore small cursor movements
      Math.abs(last.timestamp - current.timestamp) > 60000 // Force update every 60 seconds (reduced from 30)
    );
  }

  // Cached git repository information to avoid repeated file system calls
  private async getGitRepoInfoCached(workspacePath: string): Promise<{ name: string; remote: string; branch: string } | undefined> {
    const now = Date.now();
    const cached = this.gitRepoCache[workspacePath];
    
    // Return cached result if still valid
    if (cached && (now - cached.lastChecked) < cached.ttl) {
      return cached.info;
    }

    try {
      const gitDir = path.join(workspacePath, '.git');
      
      if (!fs.existsSync(gitDir)) {
        // Cache negative result
        this.gitRepoCache[workspacePath] = {
          info: undefined,
          lastChecked: now,
          ttl: this.CACHE_TTL * 2 // Cache negative results longer
        };
        return undefined;
      }

      const info = await this.getGitRepoInfo(workspacePath);
      
      // Cache the result
      this.gitRepoCache[workspacePath] = {
        info,
        lastChecked: now,
        ttl: this.CACHE_TTL
      };
      
      return info;
    } catch (error) {
      console.error('Error reading git info:', error);
      return undefined;
    }
  }

  private async getGitRepoInfo(workspacePath: string): Promise<{ name: string; remote: string; branch: string } | undefined> {
    try {
      const gitDir = path.join(workspacePath, '.git');
      
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

  // Queue-based activity sending to prevent API bombardment
  private queueActivity(activity: VSCodeActivity): void {
    this.sendQueue.push(activity);
    this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.isSending || this.sendQueue.length === 0) {
      return;
    }

    const now = Date.now();
    if (now - this.lastSentTimestamp < this.rateLimitDelay) {
      // Schedule next attempt
      setTimeout(() => this.processQueue(), this.rateLimitDelay - (now - this.lastSentTimestamp));
      return;
    }

    this.isSending = true;
    
    try {
      // Get the most recent activity from queue
      const activity = this.sendQueue.pop();
      if (!activity) {
        this.isSending = false;
        return;
      }

      // Clear any older activities in queue to avoid spam
      this.sendQueue = [];
      
      await this.sendActivity(activity);
      this.lastSentTimestamp = Date.now();
    } catch (error) {
      console.error('Error processing activity queue:', error);
    } finally {
      this.isSending = false;
      
      // Process any new items that may have been queued
      if (this.sendQueue.length > 0) {
        setTimeout(() => this.processQueue(), this.rateLimitDelay);
      }
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
        // Add timeout to prevent hanging requests
        signal: AbortSignal.timeout(10000) // 10 second timeout
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
        } else if (response.status === 202) {
          // Server accepted but rate limited - this is normal
          console.log('Activity update rate limited by server');
        } else {
          console.error('Failed to send activity:', response.statusText);
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.error('Request timeout sending activity');
      } else {
        console.error('Error sending activity:', error);
      }
    }
  }

  public async sendOfflineSignal(): Promise<void> {
    // Send immediate cleanup signal to API
    try {
      const response = await fetch(`${this.serverUrl}/vscode-cleanup`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        console.log('✅ VSCode activity cleaned up immediately');
      } else {
        console.log('⚠️ Could not clean up VSCode activity:', response.status);
      }
    } catch (error) {
      console.log('⚠️ Could not send cleanup signal:', error);
      
      // Fallback: Send offline activity signal
      if (this.lastActivity) {
        const offlineActivity = {
          ...this.lastActivity,
          timestamp: Date.now(),
          editor: {
            ...this.lastActivity.editor,
            fileName: '[OFFLINE]'
          }
        };
        
        try {
          await this.sendActivity(offlineActivity);
        } catch (fallbackError) {
          console.log('Could not send offline signal:', fallbackError);
        }
      }
    }
  }

  // Heartbeat system methods
  private startHeartbeat(): void {
    // Send session start signal first
    this.startSession();
    
    // Send initial heartbeat
    this.sendHeartbeat();
    
    // Set up periodic heartbeat
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, this.HEARTBEAT_INTERVAL);
    
    console.log(`💓 Started heartbeat system (interval: ${this.HEARTBEAT_INTERVAL}ms)`);
  }

  private async startSession(): Promise<void> {
    if (this.sessionStarted || !this.apiKey) {
      return;
    }

    try {
      const response = await fetch(`${this.serverUrl}/vscode-session-start`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sessionId: this.sessionId }),
        signal: AbortSignal.timeout(5000)
      });

      if (response.ok) {
        this.sessionStarted = true;
        console.log(`🎯 Started VSCode session: ${this.sessionId}`);
      } else {
        console.error(`❌ Failed to start session: ${response.status}`);
      }
    } catch (error) {
      console.error('❌ Error starting session:', error);
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      this.sessionStarted = false;
      console.log('💔 Stopped heartbeat system');
    }
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.isActive || !this.apiKey) {
      return;
    }

    try {
      const response = await fetch(`${this.serverUrl}/vscode-heartbeat`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(5000) // 5 second timeout
      });

      if (!response.ok) {
        console.error(`❌ Heartbeat failed: ${response.status}`);
      }
    } catch (error) {
      console.error('❌ Error sending heartbeat:', error);
    }
  }

  public dispose(): void {
    this.stop();
    this.statusBarItem.dispose();
    
    // Clear all timers
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    // Clear caches
    this.gitRepoCache = {};
    this.sendQueue = [];
    this.lastActivity = null;
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
  // Send cleanup signal before disposing
  if (presenceMonitor) {
    presenceMonitor.sendOfflineSignal().catch(() => {
      // Ignore cleanup errors during deactivation
    });
  }
  
  presenceMonitor?.dispose();
  presenceMonitor = null;
}