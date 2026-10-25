import fs from 'node:fs';
import path from 'node:path';
import { JoinError } from './join.js';

// Profile metadata is only a hint; it does not prove a valid Google session.
export function accountHint(profileDir) {
  try {
    const prefs = JSON.parse(fs.readFileSync(path.join(profileDir, 'Default', 'Preferences'), 'utf8'));
    const accounts = Array.isArray(prefs.account_info) ? prefs.account_info : [];
    return accounts.map(a => ({ name:String(a.full_name || a.given_name || ''), email:String(a.email || '') }))
      .filter(a => a.name || a.email);
  } catch { return []; }
}

export async function waitForGoogleLogin(page, { url, timeoutMs = 10 * 60_000, shouldStop = () => null, onWaiting = () => {} }) {
  const target = new URL(url);
  if (target.protocol !== 'https:' || target.hostname !== 'meet.google.com') {
    throw new JoinError('signin_required', 'automatic login continuation requires a Google Meet URL');
  }
  const check = () => {
    const reason = shouldStop();
    if (reason) { const error = new JoinError('aborted', 'login cancelled'); error.reason = reason; throw error; }
    if (page.isClosed()) throw new JoinError('signin_required', 'login window was closed; start again when ready');
  };
  check();
  const login = new URL('https://accounts.google.com/ServiceLogin');
  login.searchParams.set('continue', target.href);
  onWaiting();
  await page.bringToFront();
  try { await page.goto(login.href, { waitUntil:'domcontentloaded', timeout:30_000 }); }
  catch (error) { check(); if (error.name !== 'TimeoutError') throw error; }
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    check();
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new JoinError('signin_required', 'login timed out; retry when ready');
    try {
      await page.waitForURL(u => u.origin === target.origin && u.pathname === target.pathname,
        { waitUntil:'domcontentloaded', timeout:Math.min(1000, remaining) });
      check(); return;
    } catch (error) {
      check(); if (error.name !== 'TimeoutError') throw error;
    }
  }
}
