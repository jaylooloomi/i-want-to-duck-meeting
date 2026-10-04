// Full-page message screens (not found, blocked, denied, lobby timeout, end screens).
import { h } from './dom.js';

/**
 * @param {{ title: string, body?: string, buttons?: { label: string, primary?: boolean, onClick: () => void }[] }} o
 * @returns {HTMLElement}
 */
function messageScreen({ title, body, buttons = [] }) {
  return h('main', { class: 'message-screen' },
    h('h1', {}, title),
    body ? h('p', {}, body) : null,
    h('div', { class: 'message-actions' },
      buttons.map((b) => h('button', { type: 'button', class: b.primary ? 'btn-primary' : 'btn-outline', onClick: b.onClick }, h('span', {}, b.label))),
    ),
  );
}

const goHome = { label: 'Return to home screen', onClick: () => location.assign('/') };

export function notFoundScreen() {
  return messageScreen({
    title: 'Check your meeting code',
    body: 'Make sure you entered the correct meeting code in the URL, for example: https://meet.google.com/xxx-yyyy-zzz',
    buttons: [{ ...goHome, primary: true }],
  });
}

export function blockedScreen() {
  return messageScreen({
    title: 'You can’t join this video call',
    body: 'Your meeting is safe. No one can join a meeting unless invited or admitted by the host.',
    buttons: [{ ...goHome, primary: true }],
  });
}

/** @param {() => void} onAskAgain */
export function deniedScreen(onAskAgain) {
  return messageScreen({
    title: 'Someone in the call denied your request to join',
    body: 'Contact the meeting organizer for more information.',
    buttons: [{ label: 'Ask to join again', primary: true, onClick: onAskAgain }, goHome],
  });
}

export function lobbyTimeoutScreen() {
  // No "Ask to join again" here: that text means "denied" to the bot's classifier.
  return messageScreen({
    title: 'No one responded to your request to join the call',
    body: 'Try again later or contact the meeting organizer.',
    buttons: [{ ...goHome, primary: true }],
  });
}

/** @param {string} [title] custom wording (tests: an end screen the bot does not recognize) */
export function callEndedScreen(title) {
  return messageScreen({ title: title || 'The call ended because everyone left', buttons: [{ ...goHome, primary: true }] });
}

export function removedScreen() {
  return messageScreen({ title: 'You’ve been removed from the meeting', buttons: [{ ...goHome, primary: true }] });
}

export function leftScreen() {
  return messageScreen({ title: 'You left the meeting', buttons: [{ ...goHome, primary: true }] });
}
