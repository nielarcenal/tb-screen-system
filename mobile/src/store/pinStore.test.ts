import { beforeEach, describe, expect, it, vi } from 'vitest';
const read = vi.hoisted(() => vi.fn());
vi.mock('../lib/pinVault', () => ({ pinVault: { read } }));
import { usePinStore } from './pinStore';

describe('PIN lock lifecycle', () => {
  beforeEach(() => {
    read.mockReset();
    usePinStore.setState({ ready: false, failed: false, configured: false,
      locked: true, changing: false, generation: 0 });
  });
  it('starts locked and stays locked after restoring an existing PIN', async () => {
    read.mockResolvedValue({ ownerId: 'owner' });
    await usePinStore.getState().initialize();
    expect(usePinStore.getState()).toMatchObject({ ready: true, configured: true, locked: true });
  });
  it('fails closed on secure-storage errors', async () => {
    read.mockRejectedValue(new Error('keystore'));
    await usePinStore.getState().initialize();
    expect(usePinStore.getState()).toMatchObject({ ready: false, failed: true, locked: true });
  });
  it('unlocks only after the current operation completes', () => {
    usePinStore.getState().complete(0);
    expect(usePinStore.getState()).toMatchObject({ configured: true, locked: false });
  });
  it('does not unlock from a verification finishing after backgrounding', () => {
    usePinStore.getState().lock();
    usePinStore.getState().complete(0);
    expect(usePinStore.getState()).toMatchObject({ configured: true, locked: true });
  });
  it('backgrounding cancels PIN changes and invalidates pending results', () => {
    usePinStore.getState().complete(0);
    usePinStore.getState().change();
    const generation = usePinStore.getState().generation;
    usePinStore.getState().lock();
    usePinStore.getState().complete(generation);
    expect(usePinStore.getState()).toMatchObject({ locked: true, changing: false });
  });
});
