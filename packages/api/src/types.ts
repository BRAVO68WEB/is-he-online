import { ActivityType, type PresenceStatus } from "discord.js";

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

// HTTP response interfaces
export interface HealthResponse {
  status: string;
  botConnected: boolean;
  monitoringUser: string;
  activeStreams: number;
  apiKeyRequired: boolean;
}

export interface ApiResponse {
  success: boolean;
  timestamp: number;
  error?: string;
}
