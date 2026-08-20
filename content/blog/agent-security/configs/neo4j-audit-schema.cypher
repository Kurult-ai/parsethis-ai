# Neo4j Schema for OpenClaw Audit Logging
# Run these Cypher queries to set up your audit graph

# ============================================
# CONSTRAINTS (Run once)
# ============================================

# Unique constraint on Agent name
CREATE CONSTRAINT agent_name IF NOT EXISTS
  FOR (a:Agent) REQUIRE a.name IS UNIQUE;

# Unique constraint on Action ID
CREATE CONSTRAINT action_id IF NOT EXISTS
  FOR (a:Action) REQUIRE a.id IS UNIQUE;

# Unique constraint on Entity ID
CREATE CONSTRAINT entity_id IF NOT EXISTS
  FOR (e:Entity) REQUIRE e.id IS UNIQUE;

# Unique constraint on Task ID
CREATE CONSTRAINT task_id IF NOT EXISTS
  FOR (t:Task) REQUIRE t.id IS UNIQUE;

# ============================================
# INDEXES (Run once)
# ============================================

# Index for time-based queries
CREATE INDEX action_timestamp IF NOT EXISTS
  FOR (a:Action) ON (a.timestamp);

# Index for action type queries
CREATE INDEX action_type IF NOT EXISTS
  FOR (a:Action) ON (a.type);

# Index for agent queries
CREATE INDEX agent_created IF NOT EXISTS
  FOR (a:Agent) ON (a.created_at);

# Composite index for common queries
CREATE INDEX action_agent_time IF NOT EXISTS
  FOR (a:Action) ON (a.agent_name, a.timestamp);

# ============================================
# SAMPLE DATA (Optional - for testing)
# ============================================

// Create agents
CREATE (mongke:Agent {
  name: 'mongke',
  role: 'researcher',
  created_at: datetime(),
  capabilities: ['web_search', 'code_analysis', 'documentation']
});

CREATE (chagatai:Agent {
  name: 'chagatai',
  role: 'writer',
  created_at: datetime(),
  capabilities: ['content_creation', 'documentation', 'blog_writing']
});

CREATE (ogedei:Agent {
  name: 'ogedei',
  role: 'implementer',
  created_at: datetime(),
  capabilities: ['coding', 'refactoring', 'testing']
});

// Create a task
CREATE (task:Task {
  id: 'task_' + randomUUID(),
  description: 'Research OpenClaw security best practices',
  priority: 'high',
  created_at: datetime(),
  status: 'in_progress'
});

// Assign task to agent
MATCH (a:Agent {name: 'mongke'})
MATCH (t:Task {status: 'in_progress'})
CREATE (a)-[:ASSIGNED_TO {
  assigned_at: datetime()
}]->(t);

// Log some sample actions
MATCH (mongke:Agent {name: 'mongke'})
CREATE (action1:Action {
  id: 'action_' + randomUUID(),
  type: 'web_search',
  description: 'Searched for OpenClaw security documentation',
  timestamp: datetime() - duration({minutes: 30}),
  tool_used: 'WebSearch',
  input_hash: 'a1b2c3...',
  output_hash: 'd4e5f6...',
  duration_ms: 2450,
  success: true,
  metadata: {
    query: 'OpenClaw multi-agent security best practices',
    results_count: 10
  }
})
CREATE (mongke)-[:PERFORMED]->(action1);

MATCH (mongke:Agent {name: 'mongke'})
CREATE (action2:Action {
  id: 'action_' + randomUUID(),
  type: 'file_read',
  description: 'Read existing security documentation',
  timestamp: datetime() - duration({minutes: 25}),
  tool_used: 'Read',
  input_hash: 'b2c3d4...',
  output_hash: 'e5f6g7...',
  duration_ms: 45,
  success: true,
  metadata: {
    file_path: '/docs/security.md',
    file_size: 10240
  }
})
CREATE (mongke)-[:PERFORMED]->(action2);

// Create entity relationship
MATCH (action:Action {type: 'file_read'})
CREATE (file:Entity {
  id: '/docs/security.md',
  type: 'file',
  metadata: {
    path: '/docs/security.md',
    sensitivity: 'internal'
  }
})
CREATE (action)-[:AFFECTED]->(file);

# ============================================
# ANALYTICS QUERIES
# ============================================

// 1. List all actions by agent in last 24 hours
MATCH (a:Agent)-[:PERFORMED]->(action:Action)
WHERE action.timestamp > datetime() - duration({hours: 24})
RETURN a.name as agent,
       count(action) as total_actions,
       count(CASE WHEN action.success THEN 1 END) as successful,
       count(CASE WHEN NOT action.success THEN 1 END) as failed
ORDER BY total_actions DESC;

// 2. Detect anomalous failure rates (>30%)
MATCH (a:Agent)-[:PERFORMED]->(action:Action)
WHERE action.timestamp > datetime() - duration({hours: 1})
WITH a, count(action) as total,
     count(CASE WHEN action.success THEN 1 END) as successful
WITH a, total, successful,
     CASE WHEN total > 0 THEN (total - successful) * 1.0 / total ELSE 0 END as failure_rate
WHERE failure_rate > 0.3
RETURN a.name as agent,
       total as total_actions,
       failure_rate * 100 as failure_percentage
ORDER BY failure_rate DESC;

// 3. Find agents accessing sensitive files
MATCH (a:Agent)-[:PERFORMED]->(action:Action)-[:AFFECTED]->(e:Entity)
WHERE e.type = 'file'
  AND (e.id CONTAINS '.env'
       OR e.id CONTAINS 'secret'
       OR e.id CONTAINS 'credential'
       OR e.id CONTAINS 'password')
RETURN a.name as agent,
       action.timestamp as accessed_at,
       e.id as file_path
ORDER BY action.timestamp DESC;

// 4. Track data flow between agents
MATCH (sender:Agent)-[:PERFORMED]->(action:Action {type: 'message_sent'})-[:AFFECTED]->(msg:Entity)
MATCH (receiver:Agent)-[:PERFORMED]->(recv_action:Action {type: 'message_received'})-[:AFFECTED]->(msg)
RETURN sender.name as from_agent,
       receiver.name as to_agent,
       action.timestamp as sent_at,
       msg.id as message_id
ORDER BY action.timestamp DESC
LIMIT 50;

// 5. Detect unusual network request volume
MATCH (a:Agent)-[:PERFORMED]->(action:Action {type: 'network_request'})
WHERE action.timestamp > datetime() - duration({hours: 1})
WITH a, count(action) as request_count
WHERE request_count > 300  // Baseline: 100/hour
RETURN a.name as agent,
       request_count,
       request_count - 100 as excess_requests
ORDER BY request_count DESC;

// 6. Find potential credential access patterns
MATCH (a:Agent)-[:PERFORMED]->(action:Action)
WHERE action.type = 'secret_access'
  AND action.timestamp > datetime() - duration({hours: 24})
RETURN a.name as agent,
       action.timestamp as accessed_at,
       action.metadata.secret_path as secret_path,
       action.metadata.key as key
ORDER BY action.timestamp DESC;

// 7. Agent activity timeline
MATCH (a:Agent)-[:PERFORMED]->(action:Action)
WHERE action.timestamp > datetime() - duration({hours: 6})
RETURN a.name as agent,
       action.type as action_type,
       action.timestamp as time,
       action.success as success
ORDER BY action.timestamp DESC
LIMIT 100;

// 8. Identify agents with no recent activity (potentially down)
MATCH (a:Agent)
OPTIONAL MATCH (a)-[:PERFORMED]->(action:Action)
WITH a, max(action.timestamp) as last_action
WHERE last_action < datetime() - duration({hours: 1})
   OR last_action IS NULL
RETURN a.name as agent,
       last_action,
       CASE WHEN last_action IS NULL THEN 'Never active'
            ELSE duration.between(last_action, datetime()).minutes + ' minutes ago'
       END as last_seen;

// 9. Tool usage statistics
MATCH (a:Agent)-[:PERFORMED]->(action:Action)
WHERE action.timestamp > datetime() - duration({hours: 24})
RETURN action.tool_used as tool,
       count(*) as usage_count,
       avg(action.duration_ms) as avg_duration_ms,
       count(CASE WHEN action.success THEN 1 END) * 1.0 / count(*) as success_rate
ORDER BY usage_count DESC;

// 10. Cross-agent task collaboration
MATCH (t:Task)<-[:ASSIGNED_TO]-(agent:Agent)
OPTIONAL MATCH (agent)-[:PERFORMED]->(action:Action)
WHERE action.timestamp > t.created_at
WITH t, agent, count(action) as actions
RETURN t.id as task_id,
       t.description as description,
       collect(agent.name) as assigned_agents,
       sum(actions) as total_actions
ORDER BY t.created_at DESC;

# ============================================
# MAINTENANCE QUERIES
# ============================================

// Archive old actions (move to separate graph or export)
MATCH (action:Action)
WHERE action.timestamp < datetime() - duration({days: 90})
WITH action LIMIT 10000
DETACH DELETE action;

// Find orphaned entities
MATCH (e:Entity)
WHERE NOT (e)<-[:AFFECTED]-()
WITH e LIMIT 1000
DELETE e;
