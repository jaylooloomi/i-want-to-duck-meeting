// Small command-routing prototype. Does not install a slash command in any host.
import { parseMeetUrl } from './url.js';
import { parseTeamsUrl } from './audio-settings.js';

export function parseMeetingIntent(input) {
  const match = typeof input === 'string' && input.trim().match(/^\/meeting\s+(https:\/\/\S+)$/i);
  if (!match) throw new Error('usage: /meeting <https meeting link>');
  const raw = match[1];
  const url = new URL(raw);
  if (url.username || url.password || url.port || raw.includes('\\')) throw new Error('invalid_meeting_url');
  const teams = parseTeamsUrl(raw);
  if (teams) return { platform:'teams', url:teams, mode:'silent-notetaker', hasAutonomousJoinAdapter:false };
  if (url.hostname !== 'meet.google.com') throw new Error('unsupported_meeting_platform');
  const meet = parseMeetUrl(raw);
  return { platform:'meet', url:meet.url, mode:'silent-notetaker', hasAutonomousJoinAdapter:true };
}
