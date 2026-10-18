/** In the phone app there's nothing to install. The web version is in install.web.ts. */
export type InstallState = 'installed' | 'prompt' | 'ios' | 'none';

export function installState(): InstallState {
  return 'installed';
}

export async function promptInstall(): Promise<boolean> {
  return false;
}

export function onInstallChange(_listener: () => void): () => void {
  return () => {};
}
