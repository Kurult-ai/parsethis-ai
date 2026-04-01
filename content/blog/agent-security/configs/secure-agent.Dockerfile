# Secure Agent Container Configuration
# Copy to: ~/.openclaw/agents/{agent_name}/Dockerfile

FROM node:20-alpine

# Security: Create non-root user
RUN adduser -D -u 1000 agent && \
    mkdir -p /home/agent/workspace && \
    chown -R agent:agent /home/agent

# Security: Install only required packages
RUN apk add --no-cache \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/cache/apk/*

# Security: Set working directory
WORKDIR /home/agent/workspace

# Security: Switch to non-root user
USER agent

# Security: Set resource limits via Node.js
ENV NODE_OPTIONS="--max-old-space-size=512"
ENV AGENT_NAME=""
ENV AGENT_WORKSPACE="/home/agent/workspace"

# Security: Define volumes
# - /home/agent/workspace: Agent working directory
# - /home/agent/.openclaw/skills: Read-only skill mounts
VOLUME ["/home/agent/workspace", "/home/agent/.openclaw/skills"]

# Security: Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Security: Default command
CMD ["node", "--experimental-specifier-resolution=node", "agent.js"]
