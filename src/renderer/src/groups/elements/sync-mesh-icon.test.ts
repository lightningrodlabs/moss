import { describe, expect, it } from 'vitest';
import {
  MAX_MESH_PEERS,
  MESH_EDGES,
  meshEdgeState,
  meshNodeState,
  meshPeersShown,
} from './sync-mesh-icon.js';

describe('meshPeersShown', () => {
  it('shows at least one peer, since the mesh only appears once in contact', () => {
    expect(meshPeersShown(0)).toBe(1);
  });
  it('shows one node per connected peer up to the places the mesh has', () => {
    expect(meshPeersShown(2)).toBe(2);
    expect(meshPeersShown(9)).toBe(MAX_MESH_PEERS);
  });
});

describe('meshNodeState', () => {
  it('fills this device and the connected peers, and leaves the rest hollow', () => {
    expect([0, 1, 2, 3, 4].map((i) => meshNodeState(i, 2))).toEqual([
      'full',
      'full',
      'full',
      'hollow',
      'hollow',
    ]);
  });
});

describe('meshEdgeState', () => {
  it('carries data between two connected nodes', () => {
    expect(meshEdgeState([0, 1], 1)).toBe('live');
    expect(meshEdgeState([1, 2], 2)).toBe('live');
  });
  it('reaches from this device towards a peer not yet connected', () => {
    expect(meshEdgeState([0, 2], 1)).toBe('reaching');
  });
  it('draws nothing between other nodes until both are connected', () => {
    expect(meshEdgeState([1, 2], 1)).toBe('absent');
    expect(meshEdgeState([3, 4], 2)).toBe('absent');
  });
  it('makes every edge live once all places are connected', () => {
    expect(MESH_EDGES).toHaveLength(10);
    expect(MESH_EDGES.every((e) => meshEdgeState(e, MAX_MESH_PEERS) === 'live')).toBe(true);
  });
});
