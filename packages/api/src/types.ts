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
}

// HTTP response interfaces
export interface HealthResponse {
  status: string;
  botConnected: boolean;
  monitoringUser: string;
  activeStreams: number;
  hasVSCodeActivity: boolean;
  apiKeyRequired: boolean;
}

export interface ApiResponse {
  success: boolean;
  timestamp: number;
  error?: string;
}
