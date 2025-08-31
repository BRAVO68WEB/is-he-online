import { randomBytes } from "node:crypto";

import { App, type HttpResponse, type TemplatedApp } from "uws";

import type { HealthResponse, UserActivity } from "./types.js";

export class UWSServer {
  private app: TemplatedApp;
  private port: number;
  private currentDiscordActivity: UserActivity | null = null;
  private sseConnections: Set<HttpResponse> = new Set();
  private targetUserId: string;
  private targetUserName: string;

  constructor(port: number, targetUserId: string, targetUserName: string) {
    this.port = port;
    this.targetUserId = targetUserId;
    this.targetUserName = targetUserName;
    // Set initial offline presence state
    this.currentDiscordActivity = {
      userId: this.targetUserId,
      username: this.targetUserName,
      discriminator: "0",
      status: "offline",
      activities: [],
      timestamp: Date.now(),
    };
    this.app = App();
    this.setupRoutes();
    this.setupCors();
  }

  private generateApiKey(): string {
    const key = randomBytes(32).toString("hex");
    console.log(`🔑 Generated API Key: ${key}`);
    console.log("💡 Add this to your .env file as API_KEY=your_generated_key");
    return key;
  }

  private setupCors(): void {
    // Handle CORS preflight requests
    this.app.options("/*", (res: HttpResponse) => {
      res.cork(() => {
        res.writeHeader("Access-Control-Allow-Origin", "*")
           .writeHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
           .writeHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")
           .writeHeader("Access-Control-Max-Age", "86400")
           .end();
      });
    });
  }

  private addCorsHeaders(res: HttpResponse): HttpResponse {
    return res.writeHeader("Access-Control-Allow-Origin", "*")
              .writeHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
              .writeHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get("/health", (res: HttpResponse) => {
      const response: HealthResponse = {
        status: "ok",
        botConnected: true, // Will be updated by Discord bot
        monitoringUser: this.targetUserId,
        activeStreams: this.sseConnections.size,
        apiKeyRequired: true,
      };

      res.cork(() => {
        this.addCorsHeaders(res)
            .writeHeader("Content-Type", "application/json")
            .end(JSON.stringify(response));
      });
    });

    // Current activity endpoint
    this.app.get("/activity", (res: HttpResponse) => {
      const activity = this.currentDiscordActivity || {
        userId: this.targetUserId,
        username: "Unknown",
        discriminator: "0000",
        status: "offline",
        activities: [],
        timestamp: Date.now(),
      };

      res.cork(() => {
        this.addCorsHeaders(res)
            .writeHeader("Content-Type", "application/json")
            .end(JSON.stringify(activity));
      });
    });

    // Server-Sent Events endpoint
    this.app.get("/events", (res: HttpResponse) => {
      // Set SSE headers with CORS
      res.cork(() => {
        this.addCorsHeaders(res)
            .writeHeader("Content-Type", "text/event-stream")
            .writeHeader("Cache-Control", "no-cache")
            .writeHeader("Connection", "keep-alive")
            .writeHeader("X-Accel-Buffering", "no"); // Disable Nginx buffering
      });

      // Add to active connections
      this.sseConnections.add(res);
      console.log(`📡 New SSE client connected. Total streams: ${this.sseConnections.size}`);

      // Send initial data if available
      if (this.currentDiscordActivity) {
        this.sendSSEMessage(res, "activity-update", this.currentDiscordActivity);
      }

      // Setup heartbeat
      const heartbeatInterval = setInterval(() => {
        if (res.aborted) {
          clearInterval(heartbeatInterval);
        } else {
          this.sendSSEMessage(res, "heartbeat", { timestamp: Date.now() });
        }
      }, 30_000);

      // Handle connection close
      res.onAborted(() => {
        this.sseConnections.delete(res);
        clearInterval(heartbeatInterval);
        console.log(`📡 SSE client disconnected. Total streams: ${this.sseConnections.size}`);
      });
    });

    // Catch-all route for unmatched paths
    this.app.any("/*", (res: HttpResponse) => {
      res.cork(() => {
        this.addCorsHeaders(res)
            .writeStatus("404 Not Found")
            .writeHeader("Content-Type", "application/json")
            .end(JSON.stringify({ 
              error: "Not Found", 
              message: "The requested endpoint does not exist",
              timestamp: Date.now()
            }));
      });
    });
  }

  private sendSSEMessage(res: HttpResponse, event: string, data: unknown): void {
    if (!res.aborted) {
      const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      res.cork(() => {
        res.write(message);
      });
    }
  }

  public broadcastDiscordActivity(activity: UserActivity): void {
    this.currentDiscordActivity = activity;
    console.log(`📤 Broadcasting Discord activity to ${this.sseConnections.size} streams`);
    
    const deadConnections: HttpResponse[] = [];
    
    for (const connection of this.sseConnections) {
      if (connection.aborted) {
        deadConnections.push(connection);
      } else {
        this.sendSSEMessage(connection, "activity-update", activity);
      }
    }
    
    // Clean up dead connections
    for (const conn of deadConnections) this.sseConnections.delete(conn);
  }

  public listen(): void {
    this.app.listen("0.0.0.0", this.port, (token: unknown) => {
      if (token) {
        console.log(`🚀 Server starting on http://localhost:${this.port}`);
        console.log(`📡 SSE endpoint: http://localhost:${this.port}/events`);
        console.log(`📊 Current activity: http://localhost:${this.port}/activity`);
        console.log(`✅ uWebSockets.js server successfully started on port ${this.port}`);
      } else {
        console.error(`❌ Failed to start server on port ${this.port}`);
        process.exit(1);
      }
    });
  }
}
