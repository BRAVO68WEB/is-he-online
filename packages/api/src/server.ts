import { App, type HttpResponse, type HttpRequest, type TemplatedApp } from 'uws';
import { randomBytes } from 'crypto';
import type { UserActivity, VSCodeActivity, HealthResponse, ApiResponse, UserActivityResponse, VSCodeActivityResponse } from './types.js';
import { RedisManager } from './redis-manager.js';

export class UWSServer {
  private app: TemplatedApp;
  private port: number;
  private apiKey: string;
  private redis: RedisManager;
  private sseConnections: Set<HttpResponse> = new Set();
  private targetUserId: string;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(port: number, targetUserId: string, apiKey?: string, redisUrl?: string) {
    this.port = port;
    this.targetUserId = targetUserId;
    this.apiKey = apiKey || this.generateApiKey();
    this.redis = new RedisManager(redisUrl);
    this.app = App();
    this.setupRoutes();
    this.setupCors();
    this.startCleanupInterval();
  }

  private generateApiKey(): string {
    const key = randomBytes(32).toString('hex');
    console.log(`🔑 Generated API Key: ${key}`);
    console.log('💡 Add this to your .env file as API_KEY=your_generated_key');
    return key;
  }

  private startCleanupInterval(): void {
    // Run cleanup every 5 minutes
    this.cleanupInterval = setInterval(async () => {
      try {
        await this.redis.cleanup();
      } catch (error) {
        console.error('❌ Error during cleanup:', error);
      }
    }, 5 * 60 * 1000);
  }

  public async connect(): Promise<void> {
    await this.redis.connect();
    
    // Set up offline callbacks for heartbeat timeout events
    this.redis.setOfflineCallbacks(
      () => this.broadcastDiscordOffline(),
      () => this.broadcastVSCodeOffline()
    );
  }

  private setupCors(): void {
    // Handle CORS preflight requests
    this.app.options('/*', (res: HttpResponse) => {
      res.cork(() => {
        res.writeHeader('Access-Control-Allow-Origin', '*')
           .writeHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
           .writeHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
           .writeHeader('Access-Control-Max-Age', '86400')
           .end();
      });
    });
  }

  private addCorsHeaders(res: HttpResponse): HttpResponse {
    return res.writeHeader('Access-Control-Allow-Origin', '*')
              .writeHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
              .writeHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (res: HttpResponse) => {
      this.getHealthData().then(response => {
        res.cork(() => {
          this.addCorsHeaders(res)
              .writeHeader('Content-Type', 'application/json')
              .end(JSON.stringify(response));
        });
      }).catch(error => {
        console.error('❌ Health check error:', error);
        res.cork(() => {
          this.addCorsHeaders(res)
              .writeStatus('500 Internal Server Error')
              .writeHeader('Content-Type', 'application/json')
              .end(JSON.stringify({ 
                status: 'error', 
                error: 'Health check failed',
                timestamp: Date.now()
              }));
        });
      });
    });

    // Current activity endpoint
    this.app.get('/activity', (res: HttpResponse) => {
      this.getActivityData().then(response => {
        res.cork(() => {
          this.addCorsHeaders(res)
              .writeHeader('Content-Type', 'application/json')
              .end(JSON.stringify(response));
        });
      }).catch(error => {
        console.error('❌ Error getting activity:', error);
        res.cork(() => {
          this.addCorsHeaders(res)
              .writeStatus('500 Internal Server Error')
              .writeHeader('Content-Type', 'application/json')
              .end(JSON.stringify({ 
                error: 'Failed to get activity',
                timestamp: Date.now()
              }));
        });
      });
    });

    // Protected VSCode activity endpoint
    this.app.post('/vscode-activity', (res: HttpResponse, req: HttpRequest) => {
      const authHeader = req.getHeader('authorization');
      const apiKeyFromHeader = authHeader?.replace('Bearer ', '') || authHeader?.replace('ApiKey ', '');

      if (!apiKeyFromHeader || apiKeyFromHeader !== this.apiKey) {
        const errorResponse: ApiResponse = {
          success: false,
          timestamp: Date.now(),
          error: 'Unauthorized: Invalid or missing API key',
        };
        
        res.cork(() => {
          this.addCorsHeaders(res)
              .writeStatus('401 Unauthorized')
              .writeHeader('Content-Type', 'application/json')
              .end(JSON.stringify(errorResponse));
        });
        return;
      }

      // Read request body
      let buffer = Buffer.alloc(0);
      res.onData((chunk: ArrayBuffer, isLast: boolean) => {
        buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
        
        if (isLast) {
          this.processVSCodeActivity(res, buffer.toString()).catch(error => {
            console.error('❌ Error processing VSCode activity:', error);
            res.cork(() => {
              this.addCorsHeaders(res)
                  .writeStatus('500 Internal Server Error')
                  .writeHeader('Content-Type', 'application/json')
                  .end(JSON.stringify({
                    success: false,
                    timestamp: Date.now(),
                    error: 'Internal server error',
                  }));
            });
          });
        }
      });

      res.onAborted(() => {
        console.log('❌ VSCode activity request aborted');
      });
    });

    // VSCode cleanup endpoint (immediate cleanup when extension closes)
    this.app.post('/vscode-cleanup', (res: HttpResponse, req: HttpRequest) => {
      const authHeader = req.getHeader('authorization');
      const apiKeyFromHeader = authHeader?.replace('Bearer ', '') || authHeader?.replace('ApiKey ', '');

      if (!apiKeyFromHeader || apiKeyFromHeader !== this.apiKey) {
        const errorResponse: ApiResponse = {
          success: false,
          timestamp: Date.now(),
          error: 'Unauthorized: Invalid or missing API key',
        };
        
        res.cork(() => {
          this.addCorsHeaders(res)
              .writeStatus('401 Unauthorized')
              .writeHeader('Content-Type', 'application/json')
              .end(JSON.stringify(errorResponse));
        });
        return;
      }

      // Immediately clear VSCode activity
      this.redis.clearVSCodeActivity().then(() => {
        console.log('🧹 VSCode activity cleared immediately');
        
        // Broadcast offline status to all SSE clients
        this.sseConnections.forEach(sseRes => {
          if (!sseRes.aborted) {
            this.sendSSEMessage(sseRes, 'vscode-offline', { 
              timestamp: Date.now(),
              reason: 'VSCode extension deactivated'
            });
          }
        });

        const successResponse: ApiResponse = {
          success: true,
          timestamp: Date.now(),
        };
        
        res.cork(() => {
          this.addCorsHeaders(res)
              .writeHeader('Content-Type', 'application/json')
              .end(JSON.stringify(successResponse));
        });
      }).catch(error => {
        console.error('❌ Error clearing VSCode activity:', error);
        res.cork(() => {
          this.addCorsHeaders(res)
              .writeStatus('500 Internal Server Error')
              .writeHeader('Content-Type', 'application/json')
              .end(JSON.stringify({
                success: false,
                timestamp: Date.now(),
                error: 'Failed to clear VSCode activity',
              }));
        });
      });
    });

    // VSCode heartbeat endpoint
    this.app.post('/vscode-heartbeat', (res: HttpResponse, req: HttpRequest) => {
      const authHeader = req.getHeader('authorization');
      const apiKeyFromHeader = authHeader?.replace('Bearer ', '') || authHeader?.replace('ApiKey ', '');

      if (!apiKeyFromHeader || apiKeyFromHeader !== this.apiKey) {
        const errorResponse: ApiResponse = {
          success: false,
          timestamp: Date.now(),
          error: 'Unauthorized: Invalid or missing API key',
        };
        
        res.cork(() => {
          this.addCorsHeaders(res)
              .writeStatus('401 Unauthorized')
              .writeHeader('Content-Type', 'application/json')
              .end(JSON.stringify(errorResponse));
        });
        return;
      }

      // Update heartbeat
      this.redis.updateVSCodeHeartbeat().then(() => {
        const successResponse: ApiResponse = {
          success: true,
          timestamp: Date.now(),
        };
        
        res.cork(() => {
          this.addCorsHeaders(res)
              .writeHeader('Content-Type', 'application/json')
              .end(JSON.stringify(successResponse));
        });
      }).catch(error => {
        console.error('❌ Error updating VSCode heartbeat:', error);
        res.cork(() => {
          this.addCorsHeaders(res)
              .writeStatus('500 Internal Server Error')
              .writeHeader('Content-Type', 'application/json')
              .end(JSON.stringify({
                success: false,
                timestamp: Date.now(),
                error: 'Failed to update heartbeat',
              }));
        });
      });
    });

    // VSCode session start endpoint
    this.app.post('/vscode-session-start', (res: HttpResponse, req: HttpRequest) => {
      const authHeader = req.getHeader('authorization');
      const apiKeyFromHeader = authHeader?.replace('Bearer ', '') || authHeader?.replace('ApiKey ', '');

      if (!apiKeyFromHeader || apiKeyFromHeader !== this.apiKey) {
        const errorResponse: ApiResponse = {
          success: false,
          timestamp: Date.now(),
          error: 'Unauthorized: Invalid or missing API key',
        };
        
        res.cork(() => {
          this.addCorsHeaders(res)
              .writeStatus('401 Unauthorized')
              .writeHeader('Content-Type', 'application/json')
              .end(JSON.stringify(errorResponse));
        });
        return;
      }

      // Read request body for sessionId
      let buffer = Buffer.alloc(0);
      res.onData((chunk: ArrayBuffer, isLast: boolean) => {
        buffer = Buffer.concat([buffer, Buffer.from(chunk)]);

        if (isLast) {
          try {
            const data = JSON.parse(buffer.toString());
            const sessionId = data.sessionId;

            this.redis.startVSCodeSession(sessionId).then(() => {
              const successResponse: ApiResponse = {
                success: true,
                timestamp: Date.now(),
              };
              
              res.cork(() => {
                this.addCorsHeaders(res)
                    .writeHeader('Content-Type', 'application/json')
                    .end(JSON.stringify(successResponse));
              });
            }).catch(error => {
              console.error('❌ Error starting VSCode session:', error);
              res.cork(() => {
                this.addCorsHeaders(res)
                    .writeStatus('500 Internal Server Error')
                    .writeHeader('Content-Type', 'application/json')
                    .end(JSON.stringify({
                      success: false,
                      timestamp: Date.now(),
                      error: 'Failed to start session',
                    }));
              });
            });
          } catch (parseError) {
            console.error('❌ Error parsing session start request:', parseError);
            res.cork(() => {
              this.addCorsHeaders(res)
                  .writeStatus('400 Bad Request')
                  .writeHeader('Content-Type', 'application/json')
                  .end(JSON.stringify({
                    success: false,
                    timestamp: Date.now(),
                    error: 'Invalid JSON payload',
                  }));
            });
          }
        }
      });

      res.onAborted(() => {
        console.log('❌ VSCode session start request aborted');
      });
    });

    // Server-Sent Events endpoint
    this.app.get('/events', (res: HttpResponse, req: HttpRequest) => {
      // Set SSE headers with CORS
      res.cork(() => {
        this.addCorsHeaders(res)
            .writeHeader('Content-Type', 'text/event-stream')
            .writeHeader('Cache-Control', 'no-cache')
            .writeHeader('Connection', 'keep-alive')
            .writeHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering
      });

      // Add to active connections
      this.sseConnections.add(res);
      console.log(`📡 New SSE client connected. Total streams: ${this.sseConnections.size}`);

      // Send initial data if available (async operation)
      this.sendInitialSSEData(res).catch(error => {
        console.error('❌ Error sending initial SSE data:', error);
      });

      // Setup heartbeat
      const heartbeatInterval = setInterval(() => {
        if (!res.aborted) {
          this.sendSSEMessage(res, 'heartbeat', { timestamp: Date.now() });
        } else {
          clearInterval(heartbeatInterval);
        }
      }, 30000);

      // Handle connection close
      res.onAborted(() => {
        this.sseConnections.delete(res);
        clearInterval(heartbeatInterval);
        console.log(`📡 SSE client disconnected. Total streams: ${this.sseConnections.size}`);
      });
    });

    // Catch-all route for unmatched paths
    this.app.any('/*', (res: HttpResponse) => {
      res.cork(() => {
        this.addCorsHeaders(res)
            .writeStatus('404 Not Found')
            .writeHeader('Content-Type', 'application/json')
            .end(JSON.stringify({ 
              error: 'Not Found', 
              message: 'The requested endpoint does not exist',
              timestamp: Date.now()
            }));
      });
    });
  }

  private sendSSEMessage(res: HttpResponse, event: string, data: any): void {
    if (!res.aborted) {
      const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      res.cork(() => {
        res.write(message);
      });
    }
  }

  private async sendInitialSSEData(res: HttpResponse): Promise<void> {
    try {
      const discordData = await this.redis.getDiscordActivity();
      if (discordData && !res.aborted) {
        const activityResponse: UserActivityResponse = {
          ...(discordData.activity as UserActivity),
          online_since: discordData.online_since,
          offline_since: discordData.offline_since,
          last_seen: discordData.last_seen,
        };
        this.sendSSEMessage(res, 'activity-update', activityResponse);
      }

      const vscodeData = await this.redis.getVSCodeActivity();
      if (vscodeData && !res.aborted) {
        const vscodeResponse: VSCodeActivityResponse = {
          ...(vscodeData.activity as VSCodeActivity),
          online_since: vscodeData.online_since,
          offline_since: vscodeData.offline_since,
          last_seen: vscodeData.last_seen,
        };
        this.sendSSEMessage(res, 'vscode-update', vscodeResponse);
      }
    } catch (error) {
      console.error('❌ Error in sendInitialSSEData:', error);
    }
  }

  private async getHealthData(): Promise<HealthResponse> {
    const healthStats = await this.redis.getHealthStats();
    
    return {
      status: 'ok',
      botConnected: true, // Will be updated by Discord bot
      redisConnected: healthStats.redis_connected,
      monitoringUser: this.targetUserId,
      activeStreams: this.sseConnections.size,
      hasVSCodeActivity: healthStats.vscode_active,
      apiKeyRequired: true,
      discordActive: healthStats.discord_active,
      vscodeActive: healthStats.vscode_active,
      lastDiscordUpdate: healthStats.last_discord_update,
      lastVSCodeUpdate: healthStats.last_vscode_update,
    };
  }

  private async getActivityData(): Promise<UserActivityResponse> {
    const activityData = await this.redis.getDiscordActivity();
    
    return activityData ? {
      ...(activityData.activity as UserActivity),
      online_since: activityData.online_since,
      offline_since: activityData.offline_since,
      last_seen: activityData.last_seen,
    } : {
      userId: this.targetUserId,
      username: 'Unknown',
      discriminator: '0000',
      status: 'offline' as any,
      activities: [],
      timestamp: Date.now(),
      last_seen: Date.now(),
    };
  }

  private async processVSCodeActivity(res: HttpResponse, data: string): Promise<void> {
    try {
      const activity: VSCodeActivity = JSON.parse(data);
      
      // Try to update activity in Redis with caching/rate limiting
      const updateResult = await this.redis.setVSCodeActivity(activity);
      
      if (updateResult.updated) {
        console.log(`💻 VSCode activity update: ${activity.workspace.name}/${activity.editor.fileName}:${activity.editor.lineNumber}`);
        
        // Only broadcast if actually updated
        await this.broadcastVSCodeActivity(activity);
        
        const response: ApiResponse = {
          success: true,
          timestamp: Date.now(),
        };
        
        res.cork(() => {
          this.addCorsHeaders(res)
              .writeHeader('Content-Type', 'application/json')
              .end(JSON.stringify(response));
        });
      } else {
        // Activity was rate limited or not significantly different
        const response: ApiResponse = {
          success: true,
          timestamp: Date.now(),
          error: updateResult.reason,
        };
        
        res.cork(() => {
          this.addCorsHeaders(res)
              .writeStatus('202 Accepted')
              .writeHeader('Content-Type', 'application/json')
              .end(JSON.stringify(response));
        });
      }
    } catch (error) {
      console.error('❌ VSCode activity parsing error:', error);
      const errorResponse: ApiResponse = {
        success: false,
        timestamp: Date.now(),
        error: 'Invalid JSON payload or database error',
      };
      
      res.cork(() => {
        this.addCorsHeaders(res)
            .writeStatus('400 Bad Request')
            .writeHeader('Content-Type', 'application/json')
            .end(JSON.stringify(errorResponse));
      });
    }
  }

  public async broadcastDiscordActivity(activity: UserActivity): Promise<void> {
    try {
      // Store in Redis first
      await this.redis.setDiscordActivity(activity);
      
      // Get the activity with timestamps for broadcasting
      const activityData = await this.redis.getDiscordActivity();
      if (!activityData) return;

      const activityResponse: UserActivityResponse = {
        ...(activityData.activity as UserActivity),
        online_since: activityData.online_since,
        offline_since: activityData.offline_since,
        last_seen: activityData.last_seen,
      };

      console.log(`📤 Broadcasting Discord activity to ${this.sseConnections.size} streams`);
      
      const deadConnections: HttpResponse[] = [];
      
      for (const connection of this.sseConnections) {
        if (connection.aborted) {
          deadConnections.push(connection);
        } else {
          this.sendSSEMessage(connection, 'activity-update', activityResponse);
        }
      }
      
      // Clean up dead connections
      deadConnections.forEach(conn => this.sseConnections.delete(conn));
    } catch (error) {
      console.error('❌ Error broadcasting Discord activity:', error);
    }
  }

  private async broadcastVSCodeActivity(activity: VSCodeActivity): Promise<void> {
    try {
      // Get the activity with timestamps for broadcasting
      const activityData = await this.redis.getVSCodeActivity();
      if (!activityData) return;

      const vscodeResponse: VSCodeActivityResponse = {
        ...(activityData.activity as VSCodeActivity),
        online_since: activityData.online_since,
        offline_since: activityData.offline_since,
        last_seen: activityData.last_seen,
      };

      console.log(`📤 Broadcasting VSCode activity to ${this.sseConnections.size} streams`);
      
      const deadConnections: HttpResponse[] = [];
      
      for (const connection of this.sseConnections) {
        if (connection.aborted) {
          deadConnections.push(connection);
        } else {
          this.sendSSEMessage(connection, 'vscode-update', vscodeResponse);
        }
      }
      
      // Clean up dead connections
      deadConnections.forEach(conn => this.sseConnections.delete(conn));
    } catch (error) {
      console.error('❌ Error broadcasting VSCode activity:', error);
    }
  }

  public listen(): void {
    this.app.listen(this.port, (token: any) => {
      if (token) {
        console.log(`🚀 Server starting on http://localhost:${this.port}`);
        console.log(`📡 SSE endpoint: http://localhost:${this.port}/events`);
        console.log(`📊 Current activity: http://localhost:${this.port}/activity`);
        console.log(`🔒 Protected endpoint: http://localhost:${this.port}/vscode-activity (requires API key)`);
        console.log(`✅ uWebSockets.js server successfully started on port ${this.port}`);
      } else {
        console.error(`❌ Failed to start server on port ${this.port}`);
        process.exit(1);
      }
    });
  }

  public getApiKey(): string {
    return this.apiKey;
  }

  private broadcastDiscordOffline(): void {
    console.log('📤 Broadcasting Discord offline event');
    this.sseConnections.forEach(connection => {
      if (!connection.aborted) {
        this.sendSSEMessage(connection, 'discord-offline', {
          timestamp: Date.now(),
          reason: 'Discord heartbeat timeout'
        });
      }
    });
  }

  private broadcastVSCodeOffline(): void {
    console.log('📤 Broadcasting VSCode offline event');
    this.sseConnections.forEach(connection => {
      if (!connection.aborted) {
        this.sendSSEMessage(connection, 'vscode-offline', {
          timestamp: Date.now(),
          reason: 'VSCode heartbeat timeout'
        });
      }
    });
  }

  public async cleanup(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    await this.redis.disconnect();
  }
}
