# Discarded State Memory Savings Analysis

## Current Implementation

### Suspended State
- **Iframe**: Stays in DOM, hidden (`display: none`)
- **JavaScript Context**: Remains alive
- **Internal DOM**: Applet receives `suspend-dom` message - can remove from document but keep in memory (for quick restore ~10-50ms)
- **Memory Usage**: 
  - Iframe overhead: ~1-2 MB (base iframe + JavaScript context + framework code)
  - Internal DOM in memory: ~2-10 MB (depending on applet complexity, if applet implements suspension)
  - JavaScript heap (data stores, state): ~1-5 MB (depending on applet)
  - **Total**: ~4-17 MB per applet

### Discarded State
- **Iframe**: Stays in DOM, hidden (with additional CSS hiding)
- **JavaScript Context**: Remains alive (same as suspended)
- **Internal DOM**: Applet receives `discard-dom` message - should clear DOM and free memory
- **Memory Usage**:
  - Iframe overhead: ~1-2 MB (base iframe + JavaScript context + framework code) - **same as suspended**
  - Internal DOM: ~0 MB (cleared, if applet implements discard)
  - JavaScript heap (data stores, state): ~1-5 MB (same as suspended - data stores remain)
  - **Total**: ~2-7 MB per applet

## Memory Savings Analysis

### Per Applet Savings
- **Suspended**: ~4-17 MB
- **Discarded**: ~2-7 MB
- **Savings**: ~2-10 MB per applet (29-59% reduction)
- **Note**: Savings depend on applet implementing DOM clearing in `discard-dom` handler

### With 10 Applets
- **All Suspended**: ~40-170 MB
- **All Discarded**: ~20-70 MB
- **Total Savings**: ~20-100 MB (50-59% reduction)

### With 20 Applets
- **All Suspended**: ~80-340 MB
- **All Discarded**: ~40-140 MB
- **Total Savings**: ~40-200 MB (50-59% reduction)

## Key Observations

1. **Iframe Overhead is Fixed**: The iframe itself, JavaScript context, and framework code consume ~1-2 MB regardless of state. This cannot be reduced if we want background processing to continue.

2. **DOM Memory is Variable**: The internal DOM memory depends on applet complexity:
   - Simple applets: ~2-5 MB
   - Complex applets (many DOM nodes, images, etc.): ~5-15 MB
   - Very complex applets: ~10-20 MB+

3. **Data Stores Remain**: JavaScript heap (data stores, state) remains in both suspended and discarded states (~1-5 MB), as background processing needs access to data.

4. **Actual Savings**: The discarded state saves the internal DOM memory (2-10 MB per applet), but:
   - Iframe overhead (1-2 MB) remains
   - Data stores (1-5 MB) remain
   - **Net savings: 2-10 MB per applet (29-59% reduction)**

5. **Implementation Dependency**: Savings only occur if applets implement DOM clearing in their `discard-dom` handler. If applets don't implement this, there's no difference between suspended and discarded.

## Is the Discarded State Worth It?

### Arguments FOR keeping discarded state:
- **Moderate savings for complex applets**: 5-10 MB per applet can add up
- **Scales with number of applets**: With 10+ applets, savings can be 50-100 MB
- **Low cost**: Restore time is only slightly slower (~50-200ms vs ~10-50ms)
- **Memory pressure scenarios**: Useful when system is low on memory
- **Progressive optimization**: Allows gradual memory recovery (inactive → suspended → discarded)

### Arguments AGAINST discarded state:
- **Minimal savings for simple applets**: Only 2-5 MB per applet
- **Iframe overhead remains**: 1-2 MB per applet still consumed
- **Data stores remain**: 1-5 MB per applet still consumed
- **Additional complexity**: More states to manage and test
- **Restore time difference**: 50-200ms vs 10-50ms (still fast, but slower)
- **Implementation dependency**: Requires applets to implement DOM clearing for savings to occur
- **Diminishing returns**: Most savings come from suspended state (clearing DOM), discarded adds incremental benefit

## Recommendation

The discarded state provides **meaningful memory savings** (2-10 MB per applet, 20-200 MB total with many applets), especially for:
- Complex applets with large DOM trees
- Systems with many applets (10+)
- Memory-constrained environments

However, the savings are **moderate** because:
- The iframe overhead (1-2 MB) cannot be eliminated if background processing must continue
- Simple applets see minimal benefit (2-5 MB savings)
- The complexity cost may not be worth it for simple use cases

## Alternative: Simplified Two-State Approach

If the discarded state adds too much complexity for minimal benefit, consider:

1. **`active`**: Full rendering
2. **`inactive`**: DOM hidden, background processing continues
3. **`suspended`**: Internal DOM cleared (combines current suspended + discarded)

This would:
- Reduce complexity (one less state)
- Still provide memory savings (clear DOM when suspended)
- Slightly slower restore (~50-200ms) but still acceptable
- Simpler to understand and maintain

## Conclusion

The discarded state provides **moderate memory savings** (2-10 MB per applet, 29-59% reduction), especially valuable when:
- You have many applets (10+)
- Applets are complex (large DOM trees)
- System memory is constrained
- Applets implement DOM clearing in their `discard-dom` handler

**However**, the savings are **incremental** over the suspended state:
- **Suspended state** already provides the majority of memory savings by clearing DOM
- **Discarded state** adds only incremental benefit (same DOM clearing, just happens later)
- The main difference is **timing** (suspended after 5 min, discarded after 30 min)

### Recommendation

**Option 1: Keep discarded state** (current implementation)
- Provides progressive memory optimization
- Useful for memory-constrained systems
- Adds complexity but manageable

**Option 2: Simplify to three states** (active/inactive/suspended)
- Have `suspended` clear DOM immediately (combine current suspended + discarded behavior)
- Simpler to understand and maintain
- Still provides 29-59% memory savings
- Slightly faster restore time (~10-50ms) since DOM is already cleared

**Verdict**: The discarded state provides **moderate incremental value** (2-10 MB per applet). If complexity is a concern, simplifying to three states with immediate DOM clearing in `suspended` would provide similar savings with less complexity.

