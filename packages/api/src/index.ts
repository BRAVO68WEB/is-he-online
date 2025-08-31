import "dotenv/config";

import { DiscordBot } from "./discord-bot.js";
import { UWSServer } from "./server.js";

class DiscordActivityMonitor {
  private bot: DiscordBot;
  private server: UWSServer;
  private readonly DISCORD_TOKEN: string;
  private readonly TARGET_USER_ID: string;
  private readonly TARGET_USER_NAME: string;
  private readonly PORT: number;

  constructor() {
    // Environment variables validation
    this.DISCORD_TOKEN = process.env.DISCORD_TOKEN || "";
    this.TARGET_USER_ID = process.env.TARGET_USER_ID || "";
    this.TARGET_USER_NAME = process.env.TARGET_USER_NAME || "";
    this.PORT = Number.parseInt(process.env.PORT || "3000");

    if (!this.DISCORD_TOKEN) {
      console.error("❌ DISCORD_TOKEN environment variable is required");
      process.exit(1);
    }

    if (!this.TARGET_USER_ID) {
      console.error("❌ TARGET_USER_ID environment variable is required");
      process.exit(1);
    }

    console.log("🚀 Starting Discord Activity Monitor...");

    // Initialize Discord bot
    this.bot = new DiscordBot(this.DISCORD_TOKEN, this.TARGET_USER_ID);
    
    // Initialize uWebSockets.js server
    this.server = new UWSServer(this.PORT, this.TARGET_USER_ID, this.TARGET_USER_NAME);

    // Connect Discord activity updates to server broadcasts
    this.bot.onActivity((activity) => {
      this.server.broadcastDiscordActivity(activity);
    });

    this.start();
  }

  private async start(): Promise<void> {
    try {
      // Start the server
      this.server.listen();
      
      // Connect to Discord
      await this.bot.connect(this.DISCORD_TOKEN);
      
      console.log("🎉 Discord Activity Monitor is running!");
    } catch (error) {
      console.error("❌ Failed to start Discord Activity Monitor:", error);
      process.exit(1);
    }
  }

  public async shutdown(): Promise<void> {
    console.log("🛑 Shutting down Discord Activity Monitor...");
    await this.bot.disconnect();
    process.exit(0);
  }
}

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.log("\\n🛑 Received SIGINT, shutting down gracefully...");
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\\n🛑 Received SIGTERM, shutting down gracefully...");
  process.exit(0);
});

// Start the application
new DiscordActivityMonitor();
