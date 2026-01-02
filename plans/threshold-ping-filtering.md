# Plan: Add Threshold-Based Ping Filtering to Prevent N² Behavior in Large Groups

## Problem Statement

Currently, `pingAgents()` pings ALL agents discovered via `agentInfo()`. While this works well for small-to-medium groups, it could cause N² scaling issues in large groups:

- **10 agents**: 100 total pings/cycle across network (fine)
- **50 agents**: 2,500 total pings/cycle (getting high)
- **100 agents**: 10,000 total pings/cycle (problematic)
- **200 agents**: 40,000 total pings/cycle (network congestion)

## Current State

**File**: `src/renderer/src/groups/group-store.ts`

### Ping Flow (lines 953-967)
```typescript
async pingAgents(): Promise<void> {
  const knownAgentsB64 = Array.from(get(this._knownAgents));
  const knownAgents = knownAgentsB64.map((b64) => decodeHashFromBase64(b64));

  // Currently pings ALL agents - no filtering
  return knownAgents.length > 0
    ? this.peerStatusClient.ping(knownAgents, myStatus, tzOffset)
    : Promise.resolve();
}
```

### Orphaned Code (lines 975-984)
```typescript
private needsPinging(agent: AgentPubKey): boolean {
  // 50% probability algorithm using pubkey sum comparison
  // Currently UNUSED but could be reactivated
}
```

## Proposed Solution

### Approach: Threshold-Based Filtering

**Add filtering when agent count exceeds a threshold:**

1. **Small groups (≤50 agents)**: Ping everyone (current behavior)
   - Low overhead, maximum responsiveness
   - Every agent gets pinged every 8 seconds

2. **Large groups (>50 agents)**: Apply `needsPinging()` filter
   - ~50% probability per agent
   - Reduces total network pings by ~50%
   - Each agent still gets pinged by ~50% of others (~every 16 seconds average)

### Why 50 agents as threshold?

- **50 agents** = 2,500 total pings/cycle (8s) = ~312 pings/second network-wide
- **100 agents** with 50% filtering = 5,000 total pings/cycle = ~625 pings/second
- Holochain signals can handle this, but provides safety margin
- Configurable if needed

### Implementation Strategy

**Option A: Simple Threshold (Recommended)**
```typescript
async pingAgents(): Promise<void> {
  const knownAgentsB64 = Array.from(get(this._knownAgents));
  const knownAgents = knownAgentsB64.map((b64) => decodeHashFromBase64(b64));

  // Apply filtering only for large groups
  const agentsToPing = knownAgents.length > PING_FILTERING_THRESHOLD
    ? knownAgents.filter(agent => this.needsPinging(agent))
    : knownAgents;

  return agentsToPing.length > 0
    ? this.peerStatusClient.ping(agentsToPing, myStatus, tzOffset)
    : Promise.resolve();
}
```

**Option B: Graduated Filtering (More Complex)**
- 0-50 agents: Ping 100%
- 51-100 agents: Ping 75% (modify needsPinging to 75% probability)
- 101+ agents: Ping 50%

**Recommendation**: Start with Option A for simplicity.

## Implementation Details

### Constants to Add (around line 88)
```typescript
const PING_FILTERING_THRESHOLD = 50; // Apply needsPinging filter above this count
```

### Modify `pingAgents()` (lines 953-967)

**Before:**
```typescript
const knownAgents = knownAgentsB64.map((b64) => decodeHashFromBase64(b64));

return knownAgents.length > 0
  ? this.peerStatusClient.ping(knownAgents, myStatus, tzOffset)
  : Promise.resolve();
```

**After:**
```typescript
let knownAgents = knownAgentsB64.map((b64) => decodeHashFromBase64(b64));

// Apply 50% probability filtering for large groups to prevent N² ping explosion
if (knownAgents.length > PING_FILTERING_THRESHOLD) {
  knownAgents = knownAgents.filter(agent => this.needsPinging(agent));
}

return knownAgents.length > 0
  ? this.peerStatusClient.ping(knownAgents, myStatus, tzOffset)
  : Promise.resolve();
```

### Keep `needsPinging()` (lines 975-984)
- Already exists, no changes needed
- Add comment explaining it's used for large groups only
- Update JSDoc to clarify when it's called

### Optional: Add Logging
```typescript
if (knownAgents.length > PING_FILTERING_THRESHOLD) {
  console.log(
    `[PeerStatus] Large group (${knownAgentsB64.length} agents) - applying ping filtering. Pinging ${knownAgents.length} agents.`
  );
}
```

## Trade-offs

### Pros
✅ Prevents N² network congestion in large groups
✅ Minimal code change (reuse existing needsPinging)
✅ No impact on small-medium groups (current behavior preserved)
✅ Deterministic algorithm ensures every agent gets pinged by ~50% of group
✅ Self-adjusts: automatically enables filtering as group grows

### Cons
❌ Slightly slower offline detection in large groups (16s avg vs 8s)
❌ Need to choose threshold (50 is proposed but could be tuned)
❌ Adds conditional complexity to ping logic

### Alternatives Considered

**1. Don't implement filtering**
- Pro: Simpler code
- Con: Large groups could cause network issues

**2. Always use filtering**
- Pro: Simpler logic (no threshold)
- Con: Slower in small groups where it's unnecessary

**3. Adaptive filtering based on network conditions**
- Pro: Most optimal
- Con: Much more complex, harder to reason about

## Testing Strategy

### Manual Testing
1. **Small group (3 agents)**: Verify all agents ping each other (no filtering)
2. **Large group (60+ agents)**:
   - Add logging to verify filtering activates
   - Check that agents still go offline within reasonable time
   - Verify no network congestion

### Edge Cases
- Group with exactly 50 agents (boundary)
- Group that grows from 49 to 51 agents (transition)
- Offline detection still works with filtering

## User Decisions

1. ✅ **Threshold value**: 50 agents (conservative, provides safety margin)
2. ✅ **Filtering percentage**: Keep 50% (existing needsPinging algorithm)
3. ✅ **Logging**: Yes - log when filtering activates for visibility
4. ✅ **Approach**: Simple threshold (Option A)

## Files to Modify

1. `src/renderer/src/groups/group-store.ts`
   - Add `PING_FILTERING_THRESHOLD` constant (line ~88)
   - Modify `pingAgents()` method (lines 953-967)
   - Update `needsPinging()` JSDoc (lines 975-984)
   - Optional: Add logging

## Estimated Impact

- **Code changes**: ~10 lines
- **Complexity**: Low (reusing existing function)
- **Risk**: Very low (no change to small groups, well-tested algorithm for large groups)
- **Performance**: Improves scalability significantly for large groups

## Success Criteria

✅ Small groups (<= 50 agents) behave identically to current implementation
✅ Large groups (> 50 agents) activate filtering automatically
✅ Agents in large groups still detect offline peers within reasonable time (~16-26s)
✅ No network congestion in groups of 100+ agents
✅ Code remains simple and maintainable
