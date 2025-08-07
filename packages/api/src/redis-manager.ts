import Redis from 'ioredis';
import type { UserActivity, VSCodeActivity } from './types.js';

export interface ActivityWithTimestamps {
  activity: UserActivity | VSCodeActivity;
  online_since?: number;
  offline_since?: number;
  last_seen: number;
}

export class RedisManager {
  private redis: Redis;
  private readonly DISCORD_ACTIVITY_KEY = 'discord:activity';
  private readonly VSCODE_ACTIVITY_KEY = 'vscode:activity';
  private readonly DISCORD_STATUS_KEY = 'discord:status';
  private readonly VSCODE_STATUS_KEY = 'vscode:status';
  private readonly ACTIVITY_TTL = 3600; // 1 hour TTL for activity data
  private readonly STATUS_TTL = 86400; // 24 hour TTL for status tracking

  constructor(redisUrl?: string) {
    this.redis = new Redis(redisUrl || process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      connectTimeout: 10000,
      commandTimeout: 5000,
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.redis.on('connect', () => {
      console.log('✅ Connected to Redis');
    });

    this.redis.on('error', (error) => {
      console.error('❌ Redis connection error:', error);
    });

    this.redis.on('close', () => {
      console.log('🔌 Redis connection closed');
    });
  }

  public async connect(): Promise<void> {
    try {
      await this.redis.connect();
    } catch (error) {
      console.error('❌ Failed to connect to Redis:', error);
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    await this.redis.quit();
  }

  public async isConnected(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch {
      return false;
    }
  }

  // Discord Activity Management
  public async setDiscordActivity(activity: UserActivity): Promise<void> {
    const pipeline = this.redis.pipeline();
    
    // Get current status to determine online/offline transitions
    const currentStatus = await this.getDiscordStatus();
    const now = Date.now();
    
    let statusUpdate: any = {
      current_status: activity.status,
      last_seen: now,
    };

    // Handle online/offline transitions
    if (currentStatus) {
      if (currentStatus.current_status === 'offline' && activity.status !== 'offline') {
        // Coming online
        statusUpdate.online_since = now;
        statusUpdate.offline_since = null;
      } else if (currentStatus.current_status !== 'offline' && activity.status === 'offline') {
        // Going offline
        statusUpdate.offline_since = now;
        statusUpdate.online_since = currentStatus.online_since;
      } else {
        // Maintain existing timestamps
        statusUpdate.online_since = currentStatus.online_since;
        statusUpdate.offline_since = currentStatus.offline_since;
      }
    } else {
      // First time tracking
      if (activity.status !== 'offline') {
        statusUpdate.online_since = now;
      } else {
        statusUpdate.offline_since = now;
      }
    }

    pipeline.setex(this.DISCORD_ACTIVITY_KEY, this.ACTIVITY_TTL, JSON.stringify(activity));
    pipeline.setex(this.DISCORD_STATUS_KEY, this.STATUS_TTL, JSON.stringify(statusUpdate));
    
    await pipeline.exec();
  }

  public async getDiscordActivity(): Promise<ActivityWithTimestamps | null> {
    try {
      const [activityData, statusData] = await Promise.all([
        this.redis.get(this.DISCORD_ACTIVITY_KEY),
        this.redis.get(this.DISCORD_STATUS_KEY),
      ]);

      if (!activityData) return null;

      const activity = JSON.parse(activityData) as UserActivity;
      const status = statusData ? JSON.parse(statusData) : null;

      return {
        activity,
        online_since: status?.online_since,
        offline_since: status?.offline_since,
        last_seen: status?.last_seen || activity.timestamp,
      };
    } catch (error) {
      console.error('❌ Error getting Discord activity from Redis:', error);
      return null;
    }
  }

  private async getDiscordStatus(): Promise<any> {
    try {
      const statusData = await this.redis.get(this.DISCORD_STATUS_KEY);
      return statusData ? JSON.parse(statusData) : null;
    } catch {
      return null;
    }
  }

  // VSCode Activity Management with Rate Limiting
  public async setVSCodeActivity(activity: VSCodeActivity): Promise<{ updated: boolean; reason?: string }> {
    const sessionId = activity.sessionId || 'default';
    const cacheKey = `${this.VSCODE_ACTIVITY_KEY}:cache`;
    const rateLimitKey = `${this.VSCODE_ACTIVITY_KEY}:ratelimit:${sessionId}`;
    
    // Rate limiting: max 1 update per 5 seconds per session
    const rateLimit = await this.redis.get(rateLimitKey);
    if (rateLimit) {
      const lastUpdate = parseInt(rateLimit);
      const timeDiff = Date.now() - lastUpdate;
      if (timeDiff < 5000) { // 5 second cooldown
        return { updated: false, reason: `Rate limited. Next update allowed in ${5000 - timeDiff}ms` };
      }
    }

    // Check if activity has meaningfully changed
    const currentActivity = await this.getVSCodeActivity();
    if (currentActivity && this.isSimilarVSCodeActivity(currentActivity.activity as VSCodeActivity, activity)) {
      return { updated: false, reason: 'No meaningful change detected' };
    }

    const pipeline = this.redis.pipeline();
    const now = Date.now();
    
    // Get current status for timestamp tracking
    const currentStatus = await this.getVSCodeStatus();
    
    let statusUpdate: any = {
      is_active: true,
      last_seen: now,
    };

    // Handle online/offline transitions
    if (currentStatus) {
      if (!currentStatus.is_active) {
        // Coming back online
        statusUpdate.online_since = now;
        statusUpdate.offline_since = null;
      } else {
        // Maintain existing online timestamp
        statusUpdate.online_since = currentStatus.online_since;
        statusUpdate.offline_since = null;
      }
    } else {
      // First time tracking
      statusUpdate.online_since = now;
    }

    pipeline.setex(this.VSCODE_ACTIVITY_KEY, this.ACTIVITY_TTL, JSON.stringify(activity));
    pipeline.setex(this.VSCODE_STATUS_KEY, this.STATUS_TTL, JSON.stringify(statusUpdate));
    pipeline.setex(rateLimitKey, 5, now.toString());
    
    await pipeline.exec();
    
    return { updated: true };
  }

  public async getVSCodeActivity(): Promise<ActivityWithTimestamps | null> {
    try {
      const [activityData, statusData] = await Promise.all([
        this.redis.get(this.VSCODE_ACTIVITY_KEY),
        this.redis.get(this.VSCODE_STATUS_KEY),
      ]);

      if (!activityData) return null;

      const activity = JSON.parse(activityData) as VSCodeActivity;
      const status = statusData ? JSON.parse(statusData) : null;

      return {
        activity,
        online_since: status?.online_since,
        offline_since: status?.offline_since,
        last_seen: status?.last_seen || activity.timestamp,
      };
    } catch (error) {
      console.error('❌ Error getting VSCode activity from Redis:', error);
      return null;
    }
  }

  private async getVSCodeStatus(): Promise<any> {
    try {
      const statusData = await this.redis.get(this.VSCODE_STATUS_KEY);
      return statusData ? JSON.parse(statusData) : null;
    } catch {
      return null;
    }
  }

  public async markVSCodeOffline(): Promise<void> {
    const currentStatus = await this.getVSCodeStatus();
    const now = Date.now();
    
    const statusUpdate = {
      is_active: false,
      last_seen: now,
      online_since: currentStatus?.online_since,
      offline_since: now,
    };

    await this.redis.setex(this.VSCODE_STATUS_KEY, this.STATUS_TTL, JSON.stringify(statusUpdate));
  }

  // Utility method to check if VSCode activities are similar (to prevent spam)
  private isSimilarVSCodeActivity(current: VSCodeActivity, new_activity: VSCodeActivity): boolean {
    // Check if the meaningful fields are the same
    return (
      current.workspace.name === new_activity.workspace.name &&
      current.editor.fileName === new_activity.editor.fileName &&
      current.editor.lineNumber === new_activity.editor.lineNumber &&
      current.editor.columnNumber === new_activity.editor.columnNumber &&
      Math.abs((current.timestamp - new_activity.timestamp)) < 3000 // Within 3 seconds
    );
  }

  // Health and Statistics
  public async getHealthStats(): Promise<{
    redis_connected: boolean;
    discord_active: boolean;
    vscode_active: boolean;
    last_discord_update?: number;
    last_vscode_update?: number;
  }> {
    const isConnected = await this.isConnected();
    
    if (!isConnected) {
      return {
        redis_connected: false,
        discord_active: false,
        vscode_active: false,
      };
    }

    const [discordActivity, vscodeActivity] = await Promise.all([
      this.getDiscordActivity(),
      this.getVSCodeActivity(),
    ]);

    return {
      redis_connected: true,
      discord_active: !!discordActivity && (Date.now() - discordActivity.last_seen) < 300000, // 5 min threshold
      vscode_active: !!vscodeActivity && (Date.now() - vscodeActivity.last_seen) < 300000, // 5 min threshold
      last_discord_update: discordActivity?.last_seen,
      last_vscode_update: vscodeActivity?.last_seen,
    };
  }

  // Cleanup old data (run periodically)
  public async cleanup(): Promise<void> {
    const now = Date.now();
    const threshold = now - (24 * 60 * 60 * 1000); // 24 hours ago

    // Mark VSCode as offline if no activity for more than 5 minutes
    const vscodeActivity = await this.getVSCodeActivity();
    if (vscodeActivity && (now - vscodeActivity.last_seen) > 300000) {
      await this.markVSCodeOffline();
    }
  }
}
