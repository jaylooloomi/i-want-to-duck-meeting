// In-call screen: participant tiles, caption area, toolbar, "Got it" popup, options menu and
// settings dialog, plus the "c" captions shortcut.
import { h, icon, avatarUrl, later } from './dom.js';
import { createOptionsMenu, createSettingsDialog } from './settings.js';

const OTHERS = ['王小明', 'Arthur'];
const POPUP_DELAY_MS = 800;

/**
 * @param {{ state: any, cfg: import('./config.js').MockConfig,
 *           captions: ReturnType<typeof import('./captions.js').createCaptions>,
 *           onLeave: () => void, log: (type: string, detail?: unknown) => void }} o
 */
export function createInCall({ state, cfg, captions, onLeave, log }) {
  // --- participant tiles -----------------------------------------------------------------
  const tile = (id, name, extra = {}, ...children) =>
    h('div', { class: 'tile', 'data-participant-id': `spaces/${cfg.code}/devices/${id}`, ...extra },
      h('img', { class: 'tile-avatar', alt: '', src: avatarUrl(name) }),
      h('div', { class: 'tile-name' }, name),
      children);
  const otherTiles = OTHERS.map((name, i) => tile(String(101 + i), name));
  const selfTile = tile('self', state.name, { 'data-self-name': 'You', class: 'tile self' }, h('div', { class: 'tile-badge' }, 'You'));
  // A leftover self-preview from the green room; the bot must not count it as a participant.
  const artifactTile = h('div', { class: 'tile artifact', 'data-participant-id': `spaces/${cfg.code}/devices/self-preview` },
    h('span', {}, 'Backgrounds and effects'));
  const tiles = h('div', { class: 'tiles' }, otherTiles, selfTile, artifactTile);
  const captionHost = h('div', { class: 'caption-host' });

  // --- toolbar ---------------------------------------------------------------------------
  const micButton = h('button', { type: 'button', class: 'round-btn' });
  const camButton = h('button', { type: 'button', class: 'round-btn' });
  const captionsButton = h('button', { type: 'button', class: 'round-btn' });
  const avatarCount = cfg.noCount
    ? h('div', { class: 'avatar-count' })
    : h('div', { class: 'avatar-count', 'data-avatar-count': String(OTHERS.length + 1) }, String(OTHERS.length + 1));
  const peopleButton = h('button', { type: 'button', class: 'icon-btn people', 'aria-label': cfg.noCount ? 'People' : `People - ${OTHERS.length + 1} joined` },
    icon('people'), avatarCount);
  const moreButton = h('button', { type: 'button', class: 'round-btn', 'aria-label': 'More options', 'aria-haspopup': 'menu' }, icon('more'));
  const leaveButton = h('button', { type: 'button', class: 'round-btn hangup', 'aria-label': 'Leave call', onClick: onLeave }, icon('hangup'));

  function renderToolbar() {
    micButton.setAttribute('aria-label', state.micOff ? 'Turn on microphone' : 'Turn off microphone');
    micButton.classList.toggle('is-off', state.micOff);
    micButton.replaceChildren(icon(state.micOff ? 'micOff' : 'mic'));
    camButton.setAttribute('aria-label', state.camOff ? 'Turn on camera' : 'Turn off camera');
    camButton.classList.toggle('is-off', state.camOff);
    camButton.replaceChildren(icon(state.camOff ? 'camOff' : 'cam'));
    captionsButton.setAttribute('aria-label', state.captionsOn ? 'Turn off captions' : 'Turn on captions');
    captionsButton.setAttribute('aria-pressed', String(state.captionsOn));
    captionsButton.classList.toggle('is-active', state.captionsOn);
    captionsButton.replaceChildren(icon('cc'));
  }

  function setCaptions(on) {
    state.captionsOn = on;
    captions.setVisible(on);
    renderToolbar();
    log('captions', on ? 'on' : 'off');
  }

  micButton.addEventListener('click', () => {
    state.micOff = !state.micOff;
    renderToolbar();
  });
  camButton.addEventListener('click', () => {
    state.camOff = !state.camOff;
    renderToolbar();
  });
  captionsButton.addEventListener('click', () => setCaptions(!state.captionsOn));

  // --- options menu + settings dialog ------------------------------------------------------
  const overlays = h('div', { class: 'overlays' });
  /** @type {HTMLElement | null} */
  let settingsDialog = null;
  const closeSettings = () => {
    settingsDialog?.remove();
    settingsDialog = null;
  };
  const menu = createOptionsMenu({
    log,
    onSettings: () => {
      closeSettings();
      settingsDialog = createSettingsDialog({ state, onLanguage: (code) => captions.setLanguage(code), onClose: closeSettings, langList: cfg.langList });
      overlays.append(settingsDialog);
    },
  });
  menu.mount(overlays);
  moreButton.addEventListener('click', (event) => {
    event.stopPropagation();
    menu.toggle();
  });
  const onDocumentClick = (event) => {
    if (menu.isOpen() && !menu.el.contains(/** @type {Node} */ (event.target))) menu.close();
  };

  // --- keyboard: "c" toggles captions, Escape closes menu / dialog --------------------------
  const onKeyDown = (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    if (target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
    if (event.key === 'Escape') {
      if (menu.isOpen()) menu.close();
      else closeSettings();
      return;
    }
    if (event.key.toLowerCase() === 'c' && !event.ctrlKey && !event.metaKey && !event.altKey) setCaptions(!state.captionsOn);
  };

  // --- "Got it" info popup, shortly after joining ------------------------------------------
  const popup = h('div', { role: 'dialog', 'aria-modal': 'false', 'aria-label': 'Others may see your video differently', class: 'info-popup' },
    h('p', {}, 'Others may see your video differently. Your preview is mirrored, but others see it the right way round.'),
    h('div', { class: 'dialog-actions' },
      h('button', { type: 'button', class: 'btn-text', onClick: () => { popup.remove(); log('popup_dismissed'); } }, h('span', {}, 'Got it'))));
  const popupTimer = later(POPUP_DELAY_MS, () => overlays.append(popup));
  // A notification that stays up (tests: a chat message quoting an end-screen phrase).
  const toastTimer = cfg.toast ? later(cfg.toastAtMs, () => overlays.append(h('div', { role: 'status', class: 'toast' }, cfg.toast))) : null;

  // --- clock + meeting code ----------------------------------------------------------------
  const clock = h('span', { class: 'clock' });
  const renderClock = () => {
    clock.textContent = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };
  renderClock();
  const clockTimer = setInterval(renderClock, 10_000);

  const root = h('main', { class: 'incall' },
    h('div', { class: 'stage' }, tiles, captionHost),
    h('div', { class: 'toolbar' },
      h('div', { class: 'toolbar-left' }, clock, h('span', { class: 'divider' }, '|'), h('span', {}, cfg.code)),
      h('div', { class: 'toolbar-center' }, micButton, camButton, captionsButton, moreButton, leaveButton),
      h('div', { class: 'toolbar-right' }, peopleButton),
    ),
    overlays,
  );

  captions.mount(captionHost);
  renderToolbar();
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('click', onDocumentClick);

  return {
    root,
    setCaptions,
    /** Everybody else leaves: only the bot (and the preview artifact) remain. */
    setAlone() {
      otherTiles.forEach((t) => t.remove());
      if (!cfg.noCount) {
        avatarCount.dataset.avatarCount = '1';
        avatarCount.textContent = '1';
        peopleButton.setAttribute('aria-label', 'People - 1 joined');
      }
      if (cfg.aloneHint) tiles.append(h('div', { class: 'alone-hint' }, 'You’re the only one here'));
      log('alone');
    },
    destroy() {
      if (popupTimer !== null) clearTimeout(popupTimer);
      if (toastTimer !== null) clearTimeout(toastTimer);
      clearInterval(clockTimer);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('click', onDocumentClick);
      menu.close();
      closeSettings();
    },
  };
}
