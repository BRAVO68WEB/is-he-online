# Use Node.js 22 LTS (Alpine for smaller image size)
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Install system dependencies for uWebSockets.js (requires build tools)
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    libc6-compat

# Copy package files first for better layer caching
COPY package.json package-lock.json* ./

# Install dependencies
RUN yarn install --frozen-lockfile

# Copy source code
COPY . .

# Build TypeScript
RUN yarn build

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S api -u 1001

# Change ownership of the app directory
RUN chown -R api:nodejs /app
USER api

# Expose the port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Start the application
CMD ["yarn", "start"]
