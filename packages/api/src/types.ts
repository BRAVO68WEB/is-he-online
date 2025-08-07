import { ActivityType, type PresenceStatus } from 'discord.js';

// Types for user activity data
export interface UserActivity {
  userId: string;
  username: string;
  discriminator: string;
  status: PresenceStatus;
  activities: Array<{
    name: string;
    type: ActivityType;
    details?: string;
    state?: string;
    timestamps?: {
      start?: number;
      end?: number;
    };
  }>;
  timestamp: number;
}

// Enhanced activity response with lifecycle timestamps
export interface UserActivityResponse extends UserActivity {
  online_since?: number;
  offline_since?: number;
  last_seen: number;
}

// Types for VSCode activity data
export interface VSCodeActivity {
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
  };
  timestamp: number;
  sessionId: string;
}

// Enhanced VSCode activity response with lifecycle timestamps
export interface VSCodeActivityResponse extends VSCodeActivity {
  online_since?: number;
  offline_since?: number;
  last_seen: number;
}

// HTTP response interfaces
export interface HealthResponse {
  status: string;
  botConnected: boolean;
  redisConnected: boolean;
  monitoringUser: string;
  activeStreams: number;
  hasVSCodeActivity: boolean;
  apiKeyRequired: boolean;
  discordActive: boolean;
  vscodeActive: boolean;
  lastDiscordUpdate?: number;
  lastVSCodeUpdate?: number;
}

export interface ApiResponse {
  success: boolean;
  timestamp: number;
  error?: string;
}
