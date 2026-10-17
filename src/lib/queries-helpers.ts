export function inviteUrl(origin: string, token: string): string {
  return `${origin}/join?code=${encodeURIComponent(token)}`;
}
