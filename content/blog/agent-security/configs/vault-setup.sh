# Vault Setup Script for OpenClaw
# Run this once to configure HashiCorp Vault for agent secrets

#!/bin/bash
set -e

echo "=== OpenClaw Vault Setup ==="
echo ""

# Check prerequisites
if ! command -v vault &> /dev/null; then
    echo "Error: vault CLI not found. Install from https://developer.hashicorp.com/vault/downloads"
    exit 1
fi

# Environment variables required
: "${VAULT_ADDR:?VAULT_ADDR not set}"
: "${VAULT_TOKEN:?VAULT_TOKEN not set}"

echo "Configuring Vault at: $VAULT_ADDR"
echo ""

# ============================================
# 1. Enable KV Secrets Engine
# ============================================
echo "1. Enabling KV v2 secrets engine..."
vault secrets enable -path=secret kv-v2 2>/dev/null || echo "   KV v2 already enabled"

# ============================================
# 2. Create Policies
# ============================================
echo ""
echo "2. Creating agent policies..."

# Base policy for all agents
cat > /tmp/openclaw-base-policy.hcl << 'EOF'
# Allow agents to renew their own tokens
path "auth/token/renew-self" {
  capabilities = ["update"]
}

# Allow agents to lookup their own token
path "auth/token/lookup-self" {
  capabilities = ["read"]
}
EOF

vault policy write openclaw-base /tmp/openclaw-base-policy.hcl

# Individual agent policies
cat > /tmp/openclaw-agent-policy.hcl << 'EOF'
# Allow reading own secrets
path "secret/data/openclaw/agents/{{identity.entity.aliases.auth_kubernetes_<id>.name}}/*" {
  capabilities = ["read"]
}

# Allow reading shared secrets
path "secret/data/openclaw/shared/*" {
  capabilities = ["read"]
}
EOF

vault policy write openclaw-agent /tmp/openclaw-agent-policy.hcl

# Admin policy
cat > /tmp/openclaw-admin-policy.hcl << 'EOF'
path "secret/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}

path "auth/*" {
  capabilities = ["create", "read", "update", "delete", "list", "sudo"]
}

path "sys/*" {
  capabilities = ["create", "read", "update", "delete", "list", "sudo"]
}
EOF

vault policy write openclaw-admin /tmp/openclaw-admin-policy.hcl

# ============================================
# 3. Enable Kubernetes Auth (if running in k8s)
# ============================================
echo ""
echo "3. Configuring Kubernetes auth method..."

if vault auth list | grep -q kubernetes; then
    echo "   Kubernetes auth already enabled"
else
    vault auth enable kubernetes

    # Configure Kubernetes auth
    vault write auth/kubernetes/config \
        kubernetes_host="https://$KUBERNETES_PORT_443_TCP_ADDR:443" \
        kubernetes_ca_cert="@/var/run/secrets/kubernetes.io/serviceaccount/ca.crt" \
        token_reviewer_jwt="@/var/run/secrets/kubernetes.io/serviceaccount/token"
fi

# Create Kubernetes roles for agents
echo "   Creating Kubernetes roles..."

for agent in mongke chagatai ogedei jochi kublai temujin; do
    vault write auth/kubernetes/role/openclaw-$agent \
        bound_service_account_names=openclaw-$agent \
        bound_service_account_namespaces=openclaw \
        policies=openclaw-base,openclaw-agent \
        ttl=1h \
        max_ttl=4h 2>/dev/null || echo "   Role for $agent already exists"
done

# ============================================
# 4. Store Agent Secrets
# ============================================
echo ""
echo "4. Storing agent secrets..."

# Prompt for secrets
read -sp "Enter OpenAI API Key: " OPENAI_API_KEY
echo ""
read -sp "Enter Anthropic API Key: " ANTHROPIC_API_KEY
echo ""
read -sp "Enter Neo4j Password: " NEO4J_PASSWORD
echo ""
read -sp "Enter Stripe API Key (test): " STRIPE_API_KEY
echo ""

# Store shared secrets
echo "   Storing shared secrets..."
vault kv put secret/openclaw/shared/apis \
    OPENAI_API_KEY="$OPENAI_API_KEY" \
    ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"

vault kv put secret/openclaw/shared/database \
    NEO4J_URI="bolt://neo4j:7687" \
    NEO4J_USER="neo4j" \
    NEO4J_PASSWORD="$NEO4J_PASSWORD"

vault kv put secret/openclaw/shared/payments \
    STRIPE_API_KEY="$STRIPE_API_KEY"

# Store agent-specific secrets
for agent in mongke chagatai ogedei jochi kublai temujin; do
    echo "   Storing secrets for $agent..."
    vault kv put secret/openclaw/agents/$agent/config \
        AGENT_NAME="$agent" \
        AGENT_ROLE="$(case $agent in
            mongke) echo 'researcher' ;;
            chagatai) echo 'writer' ;;
            ogedei) echo 'implementer' ;;
            jochi) echo 'planner' ;;
            kublai) echo 'orchestrator' ;;
            temujin) echo 'gateway' ;;
        esac)" \
        WORKSPACE_DIR="/home/$agent/workspace"
done

# ============================================
# 5. Enable Audit Logging
# ============================================
echo ""
echo "5. Enabling audit logging..."

# File audit device
vault audit enable file file_path=/var/log/vault/audit.log 2>/dev/null || echo "   File audit already enabled"

# Enable socket audit for real-time monitoring (optional)
# vault audit enable socket address=localhost:9090 2>/dev/null || echo "   Socket audit already enabled"

# ============================================
# 6. Verify Setup
# ============================================
echo ""
echo "6. Verifying setup..."

echo "   Policies:"
vault policy list | grep openclaw

echo ""
echo "   Auth methods:"
vault auth list

echo ""
echo "   Secrets engines:"
vault secrets list

echo ""
echo "   Kubernetes roles:"
vault list auth/kubernetes/role/ 2>/dev/null | grep openclaw || echo "   (No Kubernetes roles found - may be using different auth)"

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "1. Mount Vault token in agent containers via Kubernetes service account"
echo "2. Configure agents to use Vault for secrets retrieval"
echo "3. Set up audit log monitoring"
echo "4. Configure credential rotation schedule"
echo ""
echo "Test secret retrieval:"
echo "  vault kv get secret/openclaw/shared/apis"
