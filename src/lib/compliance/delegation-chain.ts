/**
 * Delegation-Chain Policy Propagation (Task 10.4)
 *
 * When a parent agent delegates work to a child agent, the parent's security
 * policy (data access grants, tool allowlist, enforcement dial setting)
 * propagates to the child automatically.
 *
 * Core principle: a child can **restrict** but never **expand** the parent's
 * policy. This is enforced at delegation registration time and at effective
 * policy resolution time.
 */

import { prisma } from "../../db.js";

// ─── Types ─────────────────────────────────────────────────────────────

export interface DelegationScope {
  /** data classifications the child may access (subset of parent's dataAccess) */
  dataClassifications: string[];
  /** tools the child may use (subset of parent's tools) */
  tools?: string[];
}

export interface EffectivePolicy {
  agentId: string;
  /** the root agent of the delegation chain (or self if no delegation) */
  rootAgentId: string;
  /** tools allowed — intersection of all agents in the chain */
  tools: string[];
  /** data classifications allowed — intersection of all agents in the chain */
  dataAccess: string[];
  /** enforcement mode — most restrictive in the chain */
  enforcementMode: string;
  /** data grants inherited from parent, filtered by scope */
  inheritedGrants: Array<{
    dataSourceId: string;
    access: string;
    classification: string;
  }>;
  /** depth from root (0 = root agent) */
  depth: number;
}

export interface DelegationChainEntry {
  agentId: string;
  agentName: string;
  isRoot: boolean;
  depth: number;
  scope: string[];
  inheritedTools: string[];
  inheritedDataAccess: string[];
  inheritedEnforcement: string;
}

export interface DelegationValidationResult {
  valid: boolean;
  errors: string[];
}

// ─── Constants ─────────────────────────────────────────────────────────

/** Enforcement mode restrictiveness ranking: block > warn > monitor */
const ENFORCEMENT_RANK: Record<string, number> = {
  block: 3,
  warn: 2,
  monitor: 1,
};

// ─── Helpers ───────────────────────────────────────────────────────────

/** Compute the more restrictive of two enforcement modes. */
function moreRestrictiveEnforcement(a: string, b: string): string {
  const rankA = ENFORCEMENT_RANK[a] ?? 3; // unknown → treat as block (most restrictive)
  const rankB = ENFORCEMENT_RANK[b] ?? 3;
  return rankA >= rankB ? a : b;
}

/** Compute intersection of two string arrays. */
function intersectArrays(a: string[], b: string[]): string[] {
  if (a.length === 0 || b.length === 0) return [];
  const setB = new Set(b);
  return a.filter((x) => setB.has(x));
}

// ─── Core Functions ────────────────────────────────────────────────────

/**
 * (1) Register a delegation: records that parent delegated to child,
 * inherits the parent's policy (data grants filtered by scope, tool allowlist,
 * enforcement mode).
 *
 * The scope may restrict which data classifications and tools the child
 * receives. If scope is empty, the child inherits the parent's full policy
 * (but can still never expand beyond it — enforced by getEffectivePolicy).
 *
 * @throws if the parent or child agent doesn't exist or doesn't belong to the same org.
 */
export async function registerDelegation(
  parentAgentId: string,
  childAgentId: string,
  scope: DelegationScope,
): Promise<{
  id: string;
  parentAgentId: string;
  childAgentId: string;
  scope: string[];
  inheritedTools: string[];
  inheritedDataAccess: string[];
  inheritedEnforcement: string;
}> {
  // Fetch the parent agent
  const parent = await prisma.agentRegistry.findUnique({
    where: { id: parentAgentId },
  });
  if (!parent) {
    throw new Error(`Parent agent not found: ${parentAgentId}`);
  }

  // Fetch the child agent
  const child = await prisma.agentRegistry.findUnique({
    where: { id: childAgentId },
  });
  if (!child) {
    throw new Error(`Child agent not found: ${childAgentId}`);
  }

  // Ensure same org
  if (parent.orgId !== child.orgId) {
    throw new Error(
      `Cross-organization delegation not allowed: parent org=${parent.orgId}, child org=${child.orgId}`,
    );
  }

  // Prevent self-delegation
  if (parentAgentId === childAgentId) {
    throw new Error("An agent cannot delegate to itself");
  }

  // Prevent circular delegation: check if child is an ancestor of parent
  const cycleCheck = await wouldCreateCycle(parentAgentId, childAgentId);
  if (cycleCheck) {
    throw new Error(
      `Delegation would create a cycle: ${childAgentId} is already an ancestor of ${parentAgentId}`,
    );
  }

  // Inherit parent's policy, filtered by scope
  // Tools: intersection of parent's tools and scope.tools (if provided)
  const inheritedTools = scope.tools
    ? intersectArrays(parent.tools, scope.tools)
    : parent.tools;

  // Data access: intersection of parent's dataAccess and scope.dataClassifications
  const inheritedDataAccess = scope.dataClassifications.length > 0
    ? intersectArrays(parent.dataAccess, scope.dataClassifications)
    : parent.dataAccess;

  // Enforcement mode: inherited from parent's effective policy (most restrictive in chain)
  const parentEffective = await getEffectivePolicy(parentAgentId);
  const inheritedEnforcement = parentEffective.enforcementMode;

  // Upsert the delegation record
  const delegation = await prisma.delegationChain.upsert({
    where: {
      idx_delegation_parent_child: {
        parentAgentId,
        childAgentId,
      },
    },
    create: {
      parentAgentId,
      childAgentId,
      orgId: parent.orgId,
      scope: scope.dataClassifications,
      inheritedTools,
      inheritedDataAccess,
      inheritedEnforcement,
    },
    update: {
      scope: scope.dataClassifications,
      inheritedTools,
      inheritedDataAccess,
      inheritedEnforcement,
    },
  });

  return {
    id: delegation.id,
    parentAgentId: delegation.parentAgentId,
    childAgentId: delegation.childAgentId,
    scope: delegation.scope,
    inheritedTools: delegation.inheritedTools,
    inheritedDataAccess: delegation.inheritedDataAccess,
    inheritedEnforcement: delegation.inheritedEnforcement,
  };
}

/**
 * Check if creating a delegation from parentAgentId → childAgentId
 * would create a cycle (i.e., childAgentId is already an ancestor of parentAgentId).
 */
async function wouldCreateCycle(
  parentAgentId: string,
  childAgentId: string,
): Promise<boolean> {
  // Walk up the chain from parentAgentId — if we reach childAgentId, it's a cycle
  let currentId: string | null = parentAgentId;
  const visited = new Set<string>();

  while (currentId && !visited.has(currentId)) {
    if (currentId === childAgentId) return true;
    visited.add(currentId);

    const parentDelegation: { parentAgentId: string } | null = await prisma.delegationChain.findFirst({
      where: { childAgentId: currentId },
      select: { parentAgentId: true },
    });
    currentId = parentDelegation?.parentAgentId ?? null;
  }
  return false;
}

/**
 * (2) Get the full delegation chain from root agent to this agent.
 * Returns an ordered array: [root, ..., this agent].
 *
 * If the agent has no parent delegation, returns just itself.
 */
export async function getDelegationChain(
  agentId: string,
): Promise<DelegationChainEntry[]> {
  // Walk up from the agent to find the root, collecting intermediate nodes
  const chain: DelegationChainEntry[] = [];

  // First, get the agent itself
  const agent = await prisma.agentRegistry.findUnique({
    where: { id: agentId },
  });
  if (!agent) {
    return [];
  }

  // Walk up to build the chain (child → ... → root)
  const upwardPath: Array<{
    agentId: string;
    agentName: string;
    delegation: Awaited<ReturnType<typeof prisma.delegationChain.findFirst>>;
  }> = [];

  let currentId: string = agentId;
  const visited = new Set<string>();

  while (!visited.has(currentId)) {
    visited.add(currentId);

    const currentAgent = await prisma.agentRegistry.findUnique({
      where: { id: currentId },
      select: { id: true, agentName: true },
    });
    if (!currentAgent) break;

    const delegation = await prisma.delegationChain.findFirst({
      where: { childAgentId: currentId },
    });

    if (!delegation) {
      // This is the root
      upwardPath.push({
        agentId: currentId,
        agentName: currentAgent.agentName,
        delegation: null,
      });
      break;
    }

    // Get the parent agent's name
    const parentAgent = await prisma.agentRegistry.findUnique({
      where: { id: delegation.parentAgentId },
      select: { id: true, agentName: true },
    });

    upwardPath.push({
      agentId: currentId,
      agentName: currentAgent.agentName,
      delegation,
    });

    currentId = delegation.parentAgentId;

    // Also push root at the end if we haven't already
    if (parentAgent && !visited.has(parentAgent.id)) {
      // Will be handled in next iteration
    } else {
      // Push the parent (root) entry
      upwardPath.push({
        agentId: currentId,
        agentName: parentAgent?.agentName ?? "unknown",
        delegation: null,
      });
      break;
    }
  }

  // Reverse to get root → ... → agent
  const rootToChild = upwardPath.reverse();

  for (let i = 0; i < rootToChild.length; i++) {
    const entry = rootToChild[i];
    chain.push({
      agentId: entry.agentId,
      agentName: entry.agentName,
      isRoot: i === 0,
      depth: i,
      scope: entry.delegation?.scope ?? [],
      inheritedTools: entry.delegation?.inheritedTools ?? [],
      inheritedDataAccess: entry.delegation?.inheritedDataAccess ?? [],
      inheritedEnforcement: entry.delegation?.inheritedEnforcement ?? "block",
    });
  }

  // If the chain is empty (shouldn't happen), return just this agent
  if (chain.length === 0) {
    chain.push({
      agentId,
      agentName: agent.agentName,
      isRoot: true,
      depth: 0,
      scope: [],
      inheritedTools: [],
      inheritedDataAccess: [],
      inheritedEnforcement: "block",
    });
  }

  return chain;
}

/**
 * (3) Resolve the effective policy by walking up the chain and merging.
 * A child can restrict but never expand parent policy.
 *
 * - tools: intersection of all agents in the chain
 * - dataAccess: intersection of all agents in the chain
 * - enforcementMode: most restrictive in the chain (block > warn > monitor)
 * - inheritedGrants: parent's data grants filtered by effective dataAccess
 */
export async function getEffectivePolicy(
  agentId: string,
): Promise<EffectivePolicy> {
  const chain = await getDelegationChain(agentId);

  if (chain.length === 0) {
    // Agent doesn't exist — return minimal policy
    return {
      agentId,
      rootAgentId: agentId,
      tools: [],
      dataAccess: [],
      enforcementMode: "block",
      inheritedGrants: [],
      depth: 0,
    };
  }

  // Start with the root agent's own policy
  const rootAgent = await prisma.agentRegistry.findUnique({
    where: { id: chain[0].agentId },
  });

  let effectiveTools = rootAgent?.tools ?? [];
  let effectiveDataAccess = rootAgent?.dataAccess ?? [];
  let effectiveEnforcement = "block";

  // Walk down the chain, intersecting at each level
  for (const entry of chain) {
    const agent = await prisma.agentRegistry.findUnique({
      where: { id: entry.agentId },
    });
    if (!agent) continue;

    // For non-root agents, intersect with their own registered policy
    if (!entry.isRoot) {
      effectiveTools = intersectArrays(effectiveTools, agent.tools);
      effectiveDataAccess = intersectArrays(effectiveDataAccess, agent.dataAccess);
    }

    // Apply inherited enforcement from delegation (most restrictive)
    if (!entry.isRoot) {
      effectiveEnforcement = moreRestrictiveEnforcement(
        effectiveEnforcement,
        entry.inheritedEnforcement,
      );
    }
  }

  // Also apply scope constraints from delegation records
  for (const entry of chain) {
    if (!entry.isRoot && entry.scope.length > 0) {
      effectiveDataAccess = intersectArrays(effectiveDataAccess, entry.scope);
    }
  }

  // Fetch the parent's data grants (the direct parent, if any)
  const directParentDelegation = chain.length > 1
    ? chain[chain.length - 1] // last entry is the agent itself, second-to-last is its parent delegation link
    : null;

  let inheritedGrants: EffectivePolicy["inheritedGrants"] = [];

  if (chain.length > 1) {
    // Get grants for the parent agent
    const parentId = chain[chain.length - 2].agentId; // the parent in the chain
    const parentGrants = await prisma.agentDataGrant.findMany({
      where: { agentId: parentId },
      include: {
        dataSource: {
          select: { id: true, name: true, kind: true, classification: true },
        },
      },
    });

    // Filter grants by the effective data access classifications
    const effectiveClassSet = new Set(effectiveDataAccess);
    inheritedGrants = parentGrants
      .filter((g) => effectiveClassSet.has(g.dataSource.classification))
      .map((g) => ({
        dataSourceId: g.dataSourceId,
        access: g.access,
        classification: g.dataSource.classification,
      }));
  }

  return {
    agentId,
    rootAgentId: chain[0].agentId,
    tools: effectiveTools,
    dataAccess: effectiveDataAccess,
    enforcementMode: effectiveEnforcement,
    inheritedGrants,
    depth: chain.length - 1,
  };
}

/**
 * (4) Validate that a parent can delegate to a child.
 * Checks:
 * - Both agents exist and belong to the same org
 * - Parent is not frozen
 * - Child is not frozen
 * - The delegation wouldn't create a cycle
 * - The child's data access doesn't exceed the parent's scope
 */
export async function validateDelegation(
  parentAgentId: string,
  childAgentId: string,
): Promise<DelegationValidationResult> {
  const errors: string[] = [];

  // Self-delegation check
  if (parentAgentId === childAgentId) {
    errors.push("An agent cannot delegate to itself");
    return { valid: false, errors };
  }

  // Fetch agents
  const [parent, child] = await Promise.all([
    prisma.agentRegistry.findUnique({ where: { id: parentAgentId } }),
    prisma.agentRegistry.findUnique({ where: { id: childAgentId } }),
  ]);

  if (!parent) {
    errors.push(`Parent agent not found: ${parentAgentId}`);
  }
  if (!child) {
    errors.push(`Child agent not found: ${childAgentId}`);
  }
  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Same org check
  if (parent!.orgId !== child!.orgId) {
    errors.push(
      `Cross-organization delegation not allowed: parent org=${parent!.orgId}, child org=${child!.orgId}`,
    );
  }

  // Frozen check
  if (parent!.frozen) {
    errors.push(`Parent agent is frozen: ${parentAgentId}`);
  }
  if (child!.frozen) {
    errors.push(`Child agent is frozen: ${childAgentId}`);
  }

  // Decommissioned check
  if (parent!.status === "decommissioned") {
    errors.push(`Parent agent is decommissioned: ${parentAgentId}`);
  }
  if (child!.status === "decommissioned") {
    errors.push(`Child agent is decommissioned: ${childAgentId}`);
  }

  // Cycle check
  const createsCycle = await wouldCreateCycle(parentAgentId, childAgentId);
  if (createsCycle) {
    errors.push(
      `Delegation would create a cycle: ${childAgentId} is already an ancestor of ${parentAgentId}`,
    );
  }

  // Scope check: child's data access must not exceed parent's
  const parentDataAccessSet = new Set(parent!.dataAccess);
  const childExcess = child!.dataAccess.filter(
    (d) => !parentDataAccessSet.has(d),
  );
  if (childExcess.length > 0) {
    errors.push(
      `Child agent's data access exceeds parent scope: [${childExcess.join(", ")}] not in parent's dataAccess [${parent!.dataAccess.join(", ")}]`,
    );
  }

  // Scope check: child's tools must not exceed parent's
  const parentToolsSet = new Set(parent!.tools);
  const childToolExcess = child!.tools.filter(
    (t) => !parentToolsSet.has(t),
  );
  if (childToolExcess.length > 0) {
    errors.push(
      `Child agent's tools exceed parent scope: [${childToolExcess.join(", ")}] not in parent's tools [${parent!.tools.join(", ")}]`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
