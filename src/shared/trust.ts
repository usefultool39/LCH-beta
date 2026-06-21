import { BlockedDevice, PeerInfo, TrustedDevice } from './protocol';

export type TrustableDevice = Pick<PeerInfo, 'id' | 'name' | 'platform' | 'publicKey' | 'publicKeyHash'>;

export function isDeviceBlocked(
  blockedDevices: Record<string, BlockedDevice>,
  deviceId: string,
  publicKeyHashValue?: string
) {
  const blocked = blockedDevices[deviceId];
  if (!blocked) return false;
  return !blocked.publicKeyHash || !publicKeyHashValue || blocked.publicKeyHash === publicKeyHashValue;
}

export function isDeviceTrusted(
  trustedDevices: Record<string, TrustedDevice>,
  blockedDevices: Record<string, BlockedDevice>,
  peer: Pick<PeerInfo, 'id' | 'publicKey' | 'publicKeyHash'>
) {
  const trusted = trustedDevices[peer.id];
  return Boolean(trusted && trusted.publicKey === peer.publicKey && !isDeviceBlocked(blockedDevices, peer.id, peer.publicKeyHash));
}

export function trustedDeviceFromPeer(peer: TrustableDevice, trustedAt = Date.now()): TrustedDevice {
  return {
    id: peer.id,
    name: peer.name,
    platform: peer.platform,
    publicKey: peer.publicKey,
    publicKeyHash: peer.publicKeyHash,
    trustedAt
  };
}

export function blockedDeviceFromTrust(
  id: string,
  peer?: Partial<TrustableDevice>,
  trusted?: Partial<TrustedDevice>,
  blockedAt = Date.now()
): BlockedDevice {
  return {
    id,
    name: peer?.name || trusted?.name || id,
    publicKeyHash: peer?.publicKeyHash || trusted?.publicKeyHash,
    blockedAt
  };
}
