import Redis from 'ioredis';
import type { UserActivity, VSCodeActivity } from './types.js';

export interface ActivityWithTimestamps {
  activity: UserActivity | VSCodeActivity | null;
  online_since?: number;
  offline_since?: number;
  last_seen: number;
  session?: {
    sessionId: string;
    startTime: number;
    endTime?: number;
    status: 'active' | 'ended';
    duration: number;
  };
}

export class RedisManager {
  private redis: Redis;
  private readonly DISCORD_ACTIVITY_KEY = 'discord:activity';
  private readonly VSCODE_ACTIVITY_KEY = 'vscode:activity';
  private readonly DISCORD_STATUS_KEY = 'discord:status';
  private readonly VSCODE_STATUS_KEY = 'vscode:status';
  private readonly DISCORD_HEARTBEAT_KEY = 'discord:heartbeat';
  private readonly VSCODE_HEARTBEAT_KEY = 'vscode:heartbeat';
  private readonly VSCODE_SESSION_KEY = 'vscode:session';
  private readonly DISCORD_SESSION_KEY = 'discord:session';
  private readonly HEARTBEAT_TIMEOUT = 30000; // 30 seconds timeout (generous for network issues)
  private readonly SESSION_CLEANUP_DELAY = 60000; // 1 minute delay before marking as "ended"
  private heartbeatMonitor: NodeJS.Timeout | null = null;

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
      this.startHeartbeatMonitoring();
    } catch (error) {
      console.error('❌ Failed to connect to Redis:', error);
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    if (this.heartbeatMonitor) {
      clearInterval(this.heartbeatMonitor);
      this.heartbeatMonitor = null;
    }
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

    pipeline.set(this.DISCORD_ACTIVITY_KEY, JSON.stringify(activity));
    pipeline.set(this.DISCORD_STATUS_KEY, JSON.stringify(statusUpdate));
    pipeline.set(this.DISCORD_HEARTBEAT_KEY, now.toString());
    
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

  // VSCode Activity Management with Session Tracking
  public async setVSCodeActivity(activity: VSCodeActivity): Promise<{ updated: boolean; reason?: string }> {
    const sessionId = activity.sessionId || 'default';
    const rateLimitKey = `${this.VSCODE_ACTIVITY_KEY}:ratelimit:${sessionId}`;
    
    // Rate limiting: max 1 update per 2 seconds per session
    const rateLimit = await this.redis.get(rateLimitKey);
    if (rateLimit) {
      const lastUpdate = parseInt(rateLimit);
      const timeDiff = Date.now() - lastUpdate;
      if (timeDiff < 2000) { // 2 second cooldown
        return { updated: false, reason: `Rate limited. Next update allowed in ${2000 - timeDiff}ms` };
      }
    }

    // Check if activity has meaningfully changed
    const currentActivity = await this.getVSCodeActivity();
    if (currentActivity && this.isSimilarVSCodeActivity(currentActivity.activity as VSCodeActivity, activity)) {
      // Still update heartbeat even if activity is similar
      await this.updateVSCodeHeartbeat();
      return { updated: false, reason: 'No meaningful change detected, heartbeat updated' };
    }

    const pipeline = this.redis.pipeline();
    const now = Date.now();
    
    // Check if this is a new session
    const currentSession = await this.getVSCodeSession();
    if (!currentSession || currentSession.sessionId !== sessionId || currentSession.status === 'ended') {
      // Start new session
      await this.startVSCodeSession(sessionId);
    }
    
    // Get current status for timestamp tracking
    const currentStatus = await this.getVSCodeStatus();
    
    let statusUpdate: any = {
      is_active: true,
      last_seen: now,
      sessionId: sessionId,
    };

    // Handle online/offline transitions
    if (currentStatus) {
      if (!currentStatus.is_active || currentStatus.sessionId !== sessionId) {
        // Coming back online or new session
        statusUpdate.online_since = currentSession?.startTime || now;
        statusUpdate.offline_since = null;
      } else {
        // Maintain existing online timestamp from session start
        statusUpdate.online_since = currentSession?.startTime || currentStatus.online_since || now;
        statusUpdate.offline_since = null;
      }
    } else {
      // First time tracking
      statusUpdate.online_since = currentSession?.startTime || now;
    }

    pipeline.set(this.VSCODE_ACTIVITY_KEY, JSON.stringify(activity));
    pipeline.set(this.VSCODE_STATUS_KEY, JSON.stringify(statusUpdate));
    pipeline.setex(rateLimitKey, 2, now.toString());
    
    await pipeline.exec();
    
    // Update heartbeat to keep session alive
    await this.updateVSCodeHeartbeat();
    
    return { updated: true };
  }

  public async getVSCodeActivity(): Promise<ActivityWithTimestamps | null> {
    try {
      const [activityData, statusData, sessionData] = await Promise.all([
        this.redis.get(this.VSCODE_ACTIVITY_KEY),
        this.redis.get(this.VSCODE_STATUS_KEY),
        this.redis.get(this.VSCODE_SESSION_KEY),
      ]);

      // If no activity but have session, return session info
      const status = statusData ? JSON.parse(statusData) : null;
      const session = sessionData ? JSON.parse(sessionData) : null;

      if (!activityData && !session) return null;

      const activity = activityData ? JSON.parse(activityData) as VSCodeActivity : null;

      return {
        activity,
        online_since: status?.online_since || session?.startTime,
        offline_since: status?.offline_since || session?.endTime,
        last_seen: status?.last_seen || session?.lastHeartbeat || (activity?.timestamp),
        session: session ? {
          sessionId: session.sessionId,
          startTime: session.startTime,
          endTime: session.endTime,
          status: session.status,
          duration: session.endTime ? session.endTime - session.startTime : Date.now() - session.startTime
        } : undefined
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
    const currentSession = await this.getVSCodeSession();
    const now = Date.now();
    
    const statusUpdate = {
      is_active: false,
      last_seen: now,
      online_since: currentSession?.startTime || currentStatus?.online_since,
      offline_since: now,
      sessionId: currentStatus?.sessionId,
    };

    await this.redis.set(this.VSCODE_STATUS_KEY, JSON.stringify(statusUpdate));
  }

  public async markDiscordOffline(): Promise<void> {
    const currentStatus = await this.getDiscordStatus();
    const now = Date.now();
    
    const statusUpdate = {
      current_status: 'offline',
      last_seen: now,
      online_since: currentStatus?.online_since,
      offline_since: now,
    };

    await this.redis.set(this.DISCORD_STATUS_KEY, JSON.stringify(statusUpdate));
  }

  // Immediate cleanup for VSCode when extension is closed/deactivated
  public async clearVSCodeActivity(): Promise<void> {
    // End session gracefully with reason
    await this.endVSCodeSession('manual');
    
    // Clear activity and heartbeat data immediately
    await Promise.all([
      this.redis.del(this.VSCODE_ACTIVITY_KEY),
      this.redis.del(this.VSCODE_HEARTBEAT_KEY)
    ]);
    
    // Mark as offline but preserve session lifetime info
    await this.markVSCodeOffline();
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

    // Check heartbeats for active status
    const [discordHeartbeat, vscodeHeartbeat] = await Promise.all([
      this.redis.get(this.DISCORD_HEARTBEAT_KEY),
      this.redis.get(this.VSCODE_HEARTBEAT_KEY)
    ]);

    const now = Date.now();
    const isDiscordActive = discordHeartbeat && (now - parseInt(discordHeartbeat)) < this.HEARTBEAT_TIMEOUT;
    const isVSCodeActive = vscodeHeartbeat && (now - parseInt(vscodeHeartbeat)) < this.HEARTBEAT_TIMEOUT;

    return {
      redis_connected: true,
      discord_active: !!isDiscordActive,
      vscode_active: !!isVSCodeActive,
      last_discord_update: discordActivity?.last_seen,
      last_vscode_update: vscodeActivity?.last_seen,
    };
  }

  // Heartbeat system
  private startHeartbeatMonitoring(): void {
    // Check heartbeats every 5 seconds
    this.heartbeatMonitor = setInterval(async () => {
      await this.checkHeartbeats();
    }, 5000);
    
    console.log('💓 Started heartbeat monitoring (checking every 5s, timeout: 30s)');
  }

  private async checkHeartbeats(): Promise<void> {
    const now = Date.now();
    
    try {
      // Check VSCode heartbeat
      const vscodeHeartbeat = await this.redis.get(this.VSCODE_HEARTBEAT_KEY);
      if (vscodeHeartbeat) {
        const lastHeartbeat = parseInt(vscodeHeartbeat);
        if (now - lastHeartbeat > this.HEARTBEAT_TIMEOUT) {
          console.log('💔 VSCode heartbeat timeout - ending session gracefully');
          await this.endVSCodeSession('timeout');
          await this.markVSCodeOffline();
          if (this.onVSCodeOfflineCallback) {
            this.onVSCodeOfflineCallback();
          }
        }
      }

      // Check Discord heartbeat
      const discordHeartbeat = await this.redis.get(this.DISCORD_HEARTBEAT_KEY);
      if (discordHeartbeat) {
        const lastHeartbeat = parseInt(discordHeartbeat);
        if (now - lastHeartbeat > this.HEARTBEAT_TIMEOUT) {
          console.log('💔 Discord heartbeat timeout - marking offline');
          await this.markDiscordOffline();
          if (this.onDiscordOfflineCallback) {
            this.onDiscordOfflineCallback();
          }
        }
      }
    } catch (error) {
      console.error('❌ Error checking heartbeats:', error);
    }
  }

  // Session Management
  public async startVSCodeSession(sessionId: string): Promise<void> {
    const now = Date.now();
    const sessionData = {
      sessionId,
      startTime: now,
      lastHeartbeat: now,
      status: 'active'
    };
    
    await Promise.all([
      this.redis.set(this.VSCODE_SESSION_KEY, JSON.stringify(sessionData)),
      this.redis.set(this.VSCODE_HEARTBEAT_KEY, now.toString())
    ]);
    
    console.log(`🎯 Started VSCode session: ${sessionId}`);
  }

  public async updateVSCodeHeartbeat(): Promise<void> {
    const now = Date.now();
    
    // Update heartbeat timestamp
    await this.redis.set(this.VSCODE_HEARTBEAT_KEY, now.toString());
    
    // Update session heartbeat but preserve start time
    const sessionData = await this.getVSCodeSession();
    if (sessionData) {
      sessionData.lastHeartbeat = now;
      sessionData.status = 'active';
      await this.redis.set(this.VSCODE_SESSION_KEY, JSON.stringify(sessionData));
    }
  }

  public async endVSCodeSession(reason: 'manual' | 'timeout' = 'manual'): Promise<void> {
    const sessionData = await this.getVSCodeSession();
    if (sessionData) {
      const now = Date.now();
      sessionData.endTime = now;
      sessionData.status = 'ended';
      sessionData.endReason = reason;
      
      // Keep session data for a short while for lifetime display
      await this.redis.setex(this.VSCODE_SESSION_KEY, 300, JSON.stringify(sessionData)); // 5 min history
      
      console.log(`🛑 Ended VSCode session: ${sessionData.sessionId} (${reason}) - Duration: ${this.formatDuration(now - sessionData.startTime)}`);
    }
  }

  private async getVSCodeSession(): Promise<any> {
    try {
      const sessionData = await this.redis.get(this.VSCODE_SESSION_KEY);
      return sessionData ? JSON.parse(sessionData) : null;
    } catch {
      return null;
    }
  }

  public async updateDiscordHeartbeat(): Promise<void> {
    const now = Date.now();
    await this.redis.set(this.DISCORD_HEARTBEAT_KEY, now.toString());
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  private async clearDiscordActivity(): Promise<void> {
    await Promise.all([
      this.redis.del(this.DISCORD_ACTIVITY_KEY),
      this.redis.del(this.DISCORD_STATUS_KEY),
      this.redis.del(this.DISCORD_HEARTBEAT_KEY)
    ]);
  }

  // Get callbacks for broadcasting events (set by server)
  private onDiscordOfflineCallback?: () => void;
  private onVSCodeOfflineCallback?: () => void;

  public setOfflineCallbacks(discordCallback: () => void, vscodeCallback: () => void): void {
    this.onDiscordOfflineCallback = discordCallback;
    this.onVSCodeOfflineCallback = vscodeCallback;
  }

  // Cleanup old data (run periodically) - now mainly for maintenance
  public async cleanup(): Promise<void> {
    // This method is now mainly for maintenance, 
    // as heartbeat system handles real-time cleanup
    console.log('🧹 Running maintenance cleanup');
  }
}
