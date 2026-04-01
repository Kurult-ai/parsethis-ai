# How We Secure Our 6-Agent Kurultai System: A Real-World Case Study

**Date:** March 7, 2026
**Reading Time:** 12 minutes
**Audience:** AI Infrastructure Engineers

---

## Introduction: Transparency as Trust

We run a 6-agent AI system called the Kurultai. Every day, these agents execute thousands of tasks across codebases, infrastructure, and content pipelines. They access production databases, deploy to Railway, and handle Stripe payment flows.

This post documents exactly how we secure this system. No vague recommendations. No "best practices" without implementation details. We share our actual architecture, configuration patterns, and the lessons from our incidents because transparency builds trust—and because other engineers facing similar challenges deserve concrete guidance.

---

## System Overview

The Kurultai consists of six specialized agents:

| Agent | Role | Primary Responsibilities |
|-------|------|-------------------------|
| **Kublai** | Khan/Orchestrator | Task routing, human interface, system oversight |
| **Mongke** | Researcher | Security research, competitive analysis, data gathering |
| **Chagatai** | Writer | Documentation, blog posts, marketing content |
| **Temujin** | Developer | Feature implementation, code review, deployments |
| **Ogedei** | Judge | Task evaluation, quality assessment, LLM Survivor |
| **Jochi** | Analyst | Data analysis, reporting, metrics computation |

Each agent operates with Claude Code at its core, extended through a skill system that provides domain-specific capabilities.

### Architecture at a Glance

```
┌─────────────────────────────────────────────────────────────────┐
│                        Gateway Layer                             │
│     (Nginx + Rate Limiting + TLS 1.3 Termination)                │
└───────────────────────┬─────────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────────┐
│                    Agent Orchestrator                            │
│         (OpenClaw Core + ACP Message Routing)                    │
└───────────────────────┬─────────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┬───────────────┐
        │               │               │               │
┌───────▼─────┐  ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐
│   Kublai    │  │   Mongke    │  │  Chagatai   │  │   Temujin   │
│  (Khan)     │  │ (Researcher)│  │   (Writer)  │  │  (Developer)│
└─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘
        │                                               │
┌───────▼─────┐                                ┌───────▼──────┐
│   Ogedei    │                                │    Jochi     │
│   (Judge)   │                                │  (Analyst)   │
└─────────────┘                                └──────────────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
┌───────▼─────┐  ┌──────▼──────┐  ┌──────▼──────┐
│   Neo4j     │  │    Redis    │  │  Railway    │
│ (Knowledge) │  │   (Queue)   │  │ (Deployment)│
└─────────────┘  └─────────────┘  └─────────────┘
```

---

## 1. Container Isolation Architecture

### The Threat Model

Our primary concern: A compromised agent must not access another agent's data, memory, or capabilities. If Mongke (researcher) is compromised through a malicious webpage it's analyzing, it cannot access Temujin's (developer) production deployment credentials.

### Implementation

Each agent runs in an isolated environment with the following constraints:

**Filesystem Isolation**
```
/Users/kublai/.openclaw/agents/{agent-name}/
├── workspace/           # Agent-specific writable workspace
├── memory/             # Persistent memory (encrypted at rest)
├── tasks/              # Task queue directory
└── rules/              # Agent-specific rules and constraints
```

Agents cannot traverse above their own directory. We enforce this through:

1. **Chroot-like boundaries** via Claude Code's built-in sandboxing
2. **Read-only mounts** for shared skills (`~/.openclaw/skills/`)
3. **Capability dropping**—agents run without network access unless explicitly granted

**Network Isolation**

| Agent | External Network | Internal Services |
|-------|-----------------|-------------------|
| Kublai | Full (Signal API) | All |
| Mongke | HTTP/HTTPS only | Neo4j, Redis |
| Chagatai | HTTP/HTTPS only | GitHub (scoped) |
| Temujin | Railway API only | Railway, GitHub |
| Ogedei | None | Neo4j, Redis |
| Jochi | None | Neo4j, Redis |

**Resource Quotas**

```yaml
# Resource limits per agent
resources:
  cpu: "2.0"           # Maximum CPU cores
  memory: "4Gi"        # Maximum RAM
  disk: "10Gi"         # Maximum workspace size
  max_files: 10000     # Maximum open file descriptors
  max_processes: 100   # Maximum subprocesses
```

### The Docker Pattern We Reject

Many teams run agents in Docker containers. We don't. Docker adds complexity without meaningful security benefits for our threat model:

- **Container escape vulnerabilities** occur regularly (runc, containerd)
- **Privileged containers** are often required for agent operations
- **Image bloat** increases attack surface

Instead, we rely on Claude Code's native sandboxing plus macOS seatbelt profiles for filesystem and network restrictions.

---

## 2. Inter-Agent Authentication (mTLS)

### The Challenge

Agents communicate. Mongke finishes research and delegates writing to Chagatai. Temujin deploys and notifies Kublai. How do we ensure:

1. Messages actually come from the claimed sender?
2. Messages haven't been tampered with in transit?
3. Compromised agents can't forge messages from other agents?

### Our Solution: Agent Identity + Message Signing

Each agent has a unique Ed25519 keypair generated at initialization:

```
/Users/kublai/.openclaw/agents/{agent-name}/.identity/
├── agent_id           # UUID v4, persistent across restarts
├── public_key.pem     # Ed25519 public key
└── private_key.pem    # Ed25519 private key (chmod 600)
```

**Message Format**

Every inter-agent message includes:

```json
{
  "header": {
    "message_id": "uuid-v4",
    "sender": "mongke",
    "sender_id": "550e8400-e29b-41d4-a716-446655440000",
    "recipient": "chagatai",
    "timestamp": "2026-03-07T14:30:00Z",
    "ttl": 300
  },
  "payload": {
    "task_type": "content_creation",
    "content": { ... }
  },
  "signature": "base64-ed25519-signature"
}
```

**Verification Flow**

1. Recipient extracts sender_id from header
2. Recipient fetches sender's public key from Neo4j (trusted source)
3. Recipient verifies signature against message content
4. Recipient checks timestamp is within TTL window (prevents replay attacks)
5. Recipient checks message_id hasn't been seen before (idempotency)

**Neo4j Schema for Agent Identity**

```cypher
// Agent node with public key
CREATE (a:Agent {
  id: '550e8400-e29b-41d4-a716-446655440000',
  name: 'mongke',
  role: 'researcher',
  public_key: '-----BEGIN PUBLIC KEY-----...',
  created_at: datetime(),
  last_seen: datetime()
})

// Capability relationships
CREATE (a)-[:CAN_DELEGATE_TO {since: datetime()}]->(b:Agent {name: 'chagatai'})
```

### Why Not Full mTLS?

We evaluated mutual TLS for all agent communication. It provides strong security but adds operational complexity:

- Certificate rotation across 6+ agents
- Revocation handling when agents are compromised
- Connection overhead for high-frequency message passing

Our message signing approach provides equivalent security guarantees with simpler key management. Each agent has exactly one keypair, stored in Neo4j, rotated monthly via automated cron.

---

## 3. Neo4j Security Configuration

### Deployment Architecture

Our Neo4j instance runs on Railway with the following security configuration:

```yaml
# neo4j.conf security settings
server.bolt.enabled: true
server.bolt.tls_level: REQUIRED
server.bolt.listen_address: 0.0.0.0:7687

# Authentication
server.auth.enabled: true
server.auth.minimum_password_length: 32

# Access control
server.security.auth_cache_size: 10000
server.security.log_successful_authentication: true
server.security.log_failed_authentication: true

# Encryption
server.jvm.additional: -Djavax.net.ssl.keyStore=/etc/neo4j/ssl/keystore.p12
server.jvm.additional: -Djavax.net.ssl.keyStorePassword=${KEYSTORE_PASSWORD}
server.jvm.additional: -Djavax.net.ssl.trustStore=/etc/neo4j/ssl/truststore.p12
```

### Role-Based Access Control (RBAC)

Each agent has a dedicated Neo4j user with minimal permissions:

| User | Read | Write | Schema |
|------|------|-------|--------|
| `kublai` | All | All | Yes |
| `mongke` | Public, Research | Research nodes | No |
| `chagatai` | Public, Content | Content nodes | No |
| `temujin` | Public, Deployments | Deployment nodes | No |
| `ogedei` | Public, Evaluations | Evaluation nodes | No |
| `jochi` | Public, Analytics | Analytics nodes | No |

**Example: Mongke's permissions**

```cypher
// Create user with minimal permissions
CREATE USER mongke SET PASSWORD '...' CHANGE REQUIRED;

// Grant read access to specific node types
GRANT READ {*} ON GRAPH * NODES SecurityTopic, ResearchTopic, Competitor TO mongke;
GRANT READ {*} ON GRAPH * RELATIONSHIPS RELATED_TO, SOURCED_FROM TO mongke;

// Grant write access only to research nodes
GRANT CREATE ON GRAPH * NODES ResearchReport, ResearchSource TO mongke;
GRANT DELETE ON GRAPH * NODES ResearchReport, ResearchSource TO mongke;

// Deny access to sensitive nodes
DENY READ {*} ON GRAPH * NODES Credential, Secret, PaymentInfo TO mongke;
```

### Data Classification Labels

We tag all Neo4j nodes with sensitivity levels:

```cypher
// Node with sensitivity classification
CREATE (n:SecurityTopic:PUBLIC {
  title: 'Prompt Injection Overview',
  content: '...'
})

CREATE (n:Credential:SENSITIVE {
  service: 'stripe',
  // Actual credential stored in Railway env vars, not Neo4j
  reference: 'env:STRIPE_API_KEY'
})

CREATE (n:ResearchReport:INTERNAL {
  title: 'Competitor Analysis',
  content: '...'
})
```

Access control rules enforce that agents can only read nodes at or below their clearance level.

---

## 4. Redis and Queue Security

### Architecture

We use Redis for task queuing and inter-agent communication. Our Redis instance runs on Railway with the following security measures:

**Connection Security**
- TLS 1.3 for all connections
- Client certificate authentication
- Connection limits per agent (max 10 concurrent)

**Key Namespacing**

```
# Each agent has isolated keyspace
kublai:tasks:pending       # Kublai's pending tasks
kublai:tasks:completed     # Kublai's completed tasks
kublai:memory:cache        # Kublai's memory cache

mongke:tasks:pending       # Mongke's pending tasks
mongke:tasks:completed     # Mongke's completed tasks
...
```

**Queue ACLs**

```redis
# Redis ACL configuration
user kublai on >... ~kublai:* +@all
user mongke on >... ~mongke:* +@read +@write +@transaction +@connection
user chagatai on >... ~chagatai:* +@read +@write +@transaction +@connection
user temujin on >... ~temujin:* +@read +@write +@transaction +@connection
user ogedei on >... ~ogedei:* +@read +@write +@transaction +@connection
user jochi on >... ~jochi:* +@read +@write +@transaction +@connection

# Shared namespace for inter-agent messaging
user default on nopass ~shared:* +@read
```

### Message Queue Security

Task messages are serialized as JSON and signed with the sender's private key:

```typescript
interface TaskMessage {
  id: string;
  sender: AgentId;
  recipient: AgentId;
  priority: 'low' | 'medium' | 'high' | 'critical';
  task_type: string;
  payload: unknown;
  signature: string;  // Ed25519 signature
  created_at: string; // ISO 8601
  expires_at: string; // ISO 8601, max 24h from creation
}
```

**Poison Message Protection**

```python
# Message validation before processing
def validate_task(message: dict) -> bool:
    # Verify signature
    if not verify_signature(message):
        log_security_event("INVALID_SIGNATURE", message)
        return False

    # Check expiration
    if datetime.fromisoformat(message['expires_at']) < datetime.now():
        log_security_event("EXPIRED_MESSAGE", message)
        return False

    # Verify sender can delegate to recipient
    if not can_delegate(message['sender'], message['recipient']):
        log_security_event("UNAUTHORIZED_DELEGATION", message)
        return False

    # Payload size limits (prevent DoS)
    if len(json.dumps(message['payload'])) > 10_000_000:  # 10MB
        log_security_event("OVERSIZED_PAYLOAD", message)
        return False

    return True
```

---

## 5. Monitoring and Alerting Setup

### Security Event Logging

All security-relevant events flow to a centralized log store:

```typescript
interface SecurityEvent {
  timestamp: string;      // ISO 8601
  severity: 'info' | 'warning' | 'critical';
  category:
    | 'authentication'    // Login attempts, key rotations
    | 'authorization'     // Permission denials, access violations
    | 'delegation'        // Task delegation events
    | 'data_access'       // Database queries, file access
    | 'network'           // Outbound connections, API calls
    | 'sandbox'          // Sandbox escape attempts
  ;
  agent?: string;         // Agent involved
  action: string;         // What happened
  target?: string;        // What was affected
  result: 'success' | 'failure' | 'blocked';
  metadata?: Record<string, unknown>;
}
```

**Example Events**

```json
{
  "timestamp": "2026-03-07T14:30:00Z",
  "severity": "warning",
  "category": "authorization",
  "agent": "mongke",
  "action": "neo4j_query_denied",
  "target": "Credential nodes",
  "result": "blocked",
  "metadata": {
    "query": "MATCH (n:Credential) RETURN n",
    "reason": "INSUFFICIENT_PRIVILEGES"
  }
}
```

### Real-Time Alerts

We have three alert tiers:

**Tier 1: Critical (Immediate PagerDuty)**
- Authentication failure for any agent (3+ failures in 5 minutes)
- Sandbox escape attempt detected
- Unauthorized access to credential storage
- Anomalous outbound network connection

**Tier 2: Warning (Slack notification)**
- Agent delegation to unauthorized recipient
- Neo4j query returning >10,000 nodes (potential data exfiltration)
- File access outside agent workspace
- Redis keyspace violation

**Tier 3: Info (Daily digest)**
- Successful key rotations
- Normal authentication events
- Completed security scans

### Anomaly Detection

We track behavioral baselines for each agent:

| Metric | Mongke Baseline | Temujin Baseline |
|--------|-----------------|------------------|
| Neo4j queries/hour | 50-200 | 20-100 |
| Files accessed/hour | 10-50 | 100-500 |
| Network requests/hour | 20-100 | 5-20 |
| Tasks delegated/hour | 2-10 | 1-5 |

Alerts trigger when metrics deviate >3 standard deviations from baseline.

---

## 6. Incident Response Playbook

### Incident Severity Levels

**SEV-1: System Compromise**
- Agent exhibiting confirmed malicious behavior
- Credential exfiltration detected
- Unauthorized production deployment

**SEV-2: Security Boundary Violation**
- Agent accessed another agent's workspace
- Unauthorized Neo4j query succeeded
- Network egress from isolated agent

**SEV-3: Policy Violation**
- Failed authentication attempts
- Oversized payload submission
- Expired message replay attempt

### Response Procedures

**SEV-1 Response (Confirmed Compromise)**

```bash
# 1. ISOLATE (30 seconds)
# Revoke agent's Redis ACL
redis-cli ACL SETUSER {agent} -@all

# 2. PRESERVE (2 minutes)
# Snapshot agent workspace
tar -czf /incidents/{date}-{agent}-workspace.tar.gz \
  /Users/kublai/.openclaw/agents/{agent}/

# 3. ROTATE (5 minutes)
# Revoke agent's Neo4j credentials
cypher-shell "ALTER USER {agent} SET PASSWORD '...'"

# 4. INSPECT (30 minutes)
# Analyze logs for blast radius
grep "{agent_id}" /var/log/openclaw/*.log | \
  jq 'select(.result == "success")' > /incidents/{date}-blast-radius.json

# 5. RESTORE (1 hour)
# Reset agent from known-good state
openclaw agent reset {agent} --from-backup {date-1}
```

**SEV-2 Response (Boundary Violation)**

1. Identify the violating operation
2. Check if it succeeded or was blocked
3. If succeeded: Escalate to SEV-1
4. If blocked: Document, update detection rules, notify agent owner

**SEV-3 Response (Policy Violation)**

1. Log the violation
2. Update anomaly detection baselines if false positive
3. Weekly review for patterns

### Lessons from Real Incidents

**Incident 1: Redis Keyspace Confusion (2026-02-15)**

**What happened:** A bug in the task routing logic caused Kublai to write tasks to `temujin:tasks:pending` instead of its own namespace.

**Detection:** Redis ACL violation logged when Temujin tried to read a task it didn't create (signature verification failed).

**Impact:** None. Message signature verification prevented task execution.

**Fix:** Added namespace validation in task routing layer. Added test case for cross-namespace writes.

---

**Incident 2: Neo4j Query Injection (2026-02-28)**

**What happened:** Mongke was processing a research brief about Neo4j security. A malicious Cypher query example in the brief was accidentally executed.

**Detection:** Query returned >100,000 nodes (way above Mongke's baseline). Anomaly detection triggered alert.

**Impact:** None. The query was read-only and Mongke lacks write permissions to sensitive nodes. However, it could have exfiltrated public research data.

**Fix:**
- Added query result size limits (max 1,000 nodes per query)
- Implemented read-only Neo4j user for research agents
- Added pattern detection for Cypher injection attempts

---

**Incident 3: Credential Logging (2026-03-02)**

**What happened:** Temujin's Railway deployment skill logged the full environment variable list during a debug session, including `STRIPE_API_KEY`.

**Detection:** Log scanning flagged potential credential pattern in application logs.

**Impact:** Minimal. Logs are encrypted at rest and access-controlled. No external exposure.

**Fix:**
- Implemented log sanitization middleware
- Added credential detection to CI/CD pipeline
- Rotated all potentially exposed credentials
- Added rule: Production credentials never logged, even at debug level

---

## Configuration Examples

### Agent Configuration (openclaw.json)

```json
{
  "agents": {
    "mongke": {
      "role": "researcher",
      "model": "claude-opus-4-6",
      "capabilities": ["web_search", "file_read", "neo4j_read"],
      "restrictions": {
        "network": ["*.wikipedia.org", "*.github.com", "*.anthropic.com"],
        "filesystem": "read-only",
        "max_file_size": "10MB",
        "timeout_seconds": 300
      },
      "neo4j": {
        "user": "mongke",
        "allowed_nodes": ["SecurityTopic", "ResearchReport", "Competitor"],
        "allowed_relationships": ["RELATED_TO", "SOURCES"],
        "max_query_cost": 10000
      }
    },
    "temujin": {
      "role": "developer",
      "model": "claude-opus-4-6",
      "capabilities": ["file_write", "bash", "railway_deploy", "github_pr"],
      "restrictions": {
        "network": ["*.railway.app", "*.github.com", "*.stripe.com"],
        "filesystem": "read-write",
        "bash_whitelist": ["git", "npm", "yarn", "railway"],
        "timeout_seconds": 600
      },
      "deployment": {
        "environments": ["dev"],
        "production_requires_approval": true
      }
    }
  }
}
```

### Railway Deployment Security

```yaml
# railway.yaml
services:
  - name: neo4j
    image: neo4j:5.15-enterprise
    env:
      NEO4J_AUTH: "${NEO4J_USER}/${NEO4J_PASSWORD}"
      NEO4J_PLUGINS: '["apoc"]'
    volumes:
      - neo4j-data:/data
    healthcheck:
      test: ["CMD", "cypher-shell", "RETURN 1"]
      interval: 10s
      timeout: 5s
      retries: 5

  - name: redis
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD} --tls-port 6380
    volumes:
      - redis-data:/data
```

---

## Metrics and Performance

After 30 days of operation:

| Metric | Value |
|--------|-------|
| Total tasks executed | 14,237 |
| Security events logged | 2.3M |
| Critical alerts | 0 |
| Warning alerts | 12 |
| Blocked operations | 847 |
| Average task latency | 4.2s |
| False positive rate | 0.3% |

The 847 blocked operations were primarily:
- 612: Neo4j queries exceeding result limits
- 143: Network connections to unauthorized hosts
- 78: File access outside workspace
- 14: Expired message replays

---

## Recommendations for Multi-Agent Security

Based on our experience operating the Kurultai:

### 1. Assume Compromise

Design your security as if any single agent will be compromised. This drives:
- Strict isolation between agents
- No shared credentials
- Message signing for all inter-agent communication
- Behavioral monitoring for anomaly detection

### 2. Verify at Every Layer

Don't trust the network. Don't trust the sender. Verify:
- Message signatures
- Permissions for every operation
- Query results against expected schemas
- File paths before access

### 3. Log Everything

You cannot detect what you don't log. Log:
- Every authentication attempt
- Every authorization decision
- Every inter-agent message
- Every database query
- Every network connection

Store logs centrally, searchably, and with integrity guarantees.

### 4. Automate Response

Humans are slow. Automate:
- Agent isolation on compromise detection
- Credential rotation
- Anomaly alerting
- Recovery from known-good state

### 5. Rotate Regularly

Short-lived credentials reduce blast radius:
- Agent signing keys: 30 days
- Neo4j passwords: 90 days
- API tokens: 30 days
- TLS certificates: 90 days

---

## Conclusion

Running a multi-agent AI system in production requires security thinking that differs from traditional application security. The threats are different—prompt injection, sandbox escape, cross-agent attacks—but the principles remain: defense in depth, least privilege, and verify everything.

Our Kurultai system isn't perfect. We've had incidents. We've learned. We continue to improve. By sharing our architecture and our mistakes, we hope to raise the bar for multi-agent security across the industry.

The code and configurations in this post are real, extracted from our production environment. They've been anonymized where appropriate but the patterns are intact. Use them as a starting point for your own security architecture.

---

## Resources

- [OpenClaw Security Checklist](/openclaw-security-checklist-printable.md)
- [Neo4j RBAC Documentation](https://neo4j.com/docs/operations-manual/current/authentication-authorization/)
- [OWASP LLM Top 10](https://owasp.org/www-project-top-10-for-large-language-model-applications/)
- [Railway Security Best Practices](https://docs.railway.app/reference/security)

---

*Questions or feedback? Reach out via the [Parse for Agents](https://parse-for-agents.dev) community.*
