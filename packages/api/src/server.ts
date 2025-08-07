import { App, type HttpResponse, type HttpRequest, type TemplatedApp } from 'uws';
import { randomBytes } from 'crypto';
import type { UserActivity, VSCodeActivity, HealthResponse, ApiResponse } from './types.js';

export class UWSServer {
  private app: TemplatedApp;
  private port: number;
  private apiKey: string;
  private currentDiscordActivity: UserActivity | null = null;
  private currentVSCodeActivity: VSCodeActivity | null = null;
  private sseConnections: Set<HttpResponse> = new Set();
  private targetUserId: string;

  constructor(port: number, targetUserId: string, apiKey?: string) {
    this.port = port;
    this.targetUserId = targetUserId;
    this.apiKey = apiKey || this.generateApiKey();
    this.app = App();
    this.setupRoutes();
    this.setupCors();
  }

  private generateApiKey(): string {
    const key = randomBytes(32).toString('hex');
    console.log(`🔑 Generated API Key: ${key}`);
    console.log('💡 Add this to your .env file as API_KEY=your_generated_key');
    return key;
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
      const response: HealthResponse = {
        status: 'ok',
        botConnected: true, // Will be updated by Discord bot
        monitoringUser: this.targetUserId,
        activeStreams: this.sseConnections.size,
        hasVSCodeActivity: this.currentVSCodeActivity !== null,
        apiKeyRequired: true,
      };

      res.cork(() => {
        this.addCorsHeaders(res)
            .writeHeader('Content-Type', 'application/json')
            .end(JSON.stringify(response));
      });
    });

    // Current activity endpoint
    this.app.get('/activity', (res: HttpResponse) => {
      const activity = this.currentDiscordActivity || {
        userId: this.targetUserId,
        username: 'Unknown',
        discriminator: '0000',
        status: 'offline',
        activities: [],
        timestamp: Date.now(),
      };

      res.cork(() => {
        this.addCorsHeaders(res)
            .writeHeader('Content-Type', 'application/json')
            .end(JSON.stringify(activity));
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
          try {
            const activity: VSCodeActivity = JSON.parse(buffer.toString());
            
            console.log(`💻 VSCode activity update: ${activity.workspace.name}/${activity.editor.fileName}:${activity.editor.lineNumber}`);
            
            this.currentVSCodeActivity = activity;
            this.broadcastVSCodeActivity(activity);
            
            const response: ApiResponse = {
              success: true,
              timestamp: Date.now(),
            };
            
            res.cork(() => {
              this.addCorsHeaders(res)
                  .writeHeader('Content-Type', 'application/json')
                  .end(JSON.stringify(response));
            });
          } catch (error) {
            const errorResponse: ApiResponse = {
              success: false,
              timestamp: Date.now(),
              error: 'Invalid JSON payload',
            };
            
            res.cork(() => {
              this.addCorsHeaders(res)
                  .writeStatus('400 Bad Request')
                  .writeHeader('Content-Type', 'application/json')
                  .end(JSON.stringify(errorResponse));
            });
          }
        }
      });

      res.onAborted(() => {
        console.log('❌ VSCode activity request aborted');
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

      // Send initial data if available
      if (this.currentDiscordActivity) {
        this.sendSSEMessage(res, 'activity-update', this.currentDiscordActivity);
      }

      if (this.currentVSCodeActivity) {
        this.sendSSEMessage(res, 'vscode-update', this.currentVSCodeActivity);
      }

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

  public broadcastDiscordActivity(activity: UserActivity): void {
    this.currentDiscordActivity = activity;
    console.log(`📤 Broadcasting Discord activity to ${this.sseConnections.size} streams`);
    
    const deadConnections: HttpResponse[] = [];
    
    for (const connection of this.sseConnections) {
      if (connection.aborted) {
        deadConnections.push(connection);
      } else {
        this.sendSSEMessage(connection, 'activity-update', activity);
      }
    }
    
    // Clean up dead connections
    deadConnections.forEach(conn => this.sseConnections.delete(conn));
  }

  private broadcastVSCodeActivity(activity: VSCodeActivity): void {
    console.log(`📤 Broadcasting VSCode activity to ${this.sseConnections.size} streams`);
    
    const deadConnections: HttpResponse[] = [];
    
    for (const connection of this.sseConnections) {
      if (connection.aborted) {
        deadConnections.push(connection);
      } else {
        this.sendSSEMessage(connection, 'vscode-update', activity);
      }
    }
    
    // Clean up dead connections
    deadConnections.forEach(conn => this.sseConnections.delete(conn));
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
}
