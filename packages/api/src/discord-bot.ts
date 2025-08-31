import { Client, Events, GatewayIntentBits, Presence } from "discord.js";

import type { UserActivity } from "./types.js";

export class DiscordBot {
  private client: Client;
  private targetUserId: string;
  private currentActivity: UserActivity | null = null;
  private onActivityUpdate?: (activity: UserActivity) => void;

  constructor(token: string, targetUserId: string) {
    this.targetUserId = targetUserId;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMembers,
      ],
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.once(Events.ClientReady, (client) => {
      console.log(`✅ Discord bot logged in as ${client.user.tag}!`);
      console.log(`🎯 Monitoring user ID: ${this.targetUserId}`);
      this.checkInitialPresence();
    });

    this.client.on(Events.PresenceUpdate, (oldPresence, newPresence) => {
      if (newPresence?.userId === this.targetUserId) {
        const activity = this.extractUserActivity(newPresence);
        this.currentActivity = activity;
        
        console.log(`👤 User activity updated: ${activity.status} - ${activity.activities.map(a => a.name).join(", ")}`);
        
        if (this.onActivityUpdate) {
          this.onActivityUpdate(activity);
        }
      }
    });

    this.client.on(Events.Error, (error) => {
      console.error("❌ Discord client error:", error);
    });
  }

  private checkInitialPresence(): void {
    for (const [, guild] of this.client.guilds.cache) {
      const member = guild.members.cache.get(this.targetUserId);
      if (member?.presence) {
        console.log(`🔍 Found initial presence for user in guild: ${guild.name}`);
        const activity = this.extractUserActivity(member.presence);
        this.currentActivity = activity;
        
        if (this.onActivityUpdate) {
          this.onActivityUpdate(activity);
        }
      }
    }
  }

  private extractUserActivity(presence: Presence): UserActivity {
    const user = presence.user;
    if (!user) {
      throw new Error("User not found in presence");
    }

    return {
      userId: user.id,
      username: user.username,
      discriminator: user.discriminator,
      status: presence.status,
      activities: presence.activities.map(activity => ({
        name: activity.name,
        type: activity.type,
        details: activity.details || undefined,
        state: activity.state || undefined,
        timestamps: activity.timestamps ? {
          start: activity.timestamps.start?.getTime(),
          end: activity.timestamps.end?.getTime(),
        } : undefined,
      })),
      timestamp: Date.now(),
    };
  }

  public async connect(token: string): Promise<void> {
    try {
      await this.client.login(token);
    } catch (error) {
      console.error("❌ Failed to login to Discord:", error);
      throw error;
    }
  }

  public onActivity(callback: (activity: UserActivity) => void): void {
    this.onActivityUpdate = callback;
  }

  public getCurrentActivity(): UserActivity | null {
    return this.currentActivity;
  }

  public isReady(): boolean {
    return this.client.isReady();
  }

  public async disconnect(): Promise<void> {
    await this.client.destroy();
  }
}
