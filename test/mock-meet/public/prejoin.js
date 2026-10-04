// Prejoin ("green room") and lobby screens.
import { h, icon } from './dom.js';

/**
 * Self-view with the microphone / camera toggles. The same element moves from the prejoin
 * screen to the lobby screen, like in Meet.
 * @param {{ state: any, log: (type: string, detail?: unknown) => void }} o
 */
export function createPreview({ state, log }) {
  const video = h('div', { class: 'preview-video' });
  const micButton = h('button', { type: 'button', class: 'round-btn' });
  const camButton = h('button', { type: 'button', class: 'round-btn' });

  function render() {
    micButton.setAttribute('aria-label', state.micOff ? 'Turn on microphone' : 'Turn off microphone');
    micButton.dataset.isMuted = String(state.micOff);
    micButton.classList.toggle('is-off', state.micOff);
    micButton.replaceChildren(icon(state.micOff ? 'micOff' : 'mic'));
    camButton.setAttribute('aria-label', state.camOff ? 'Turn on camera' : 'Turn off camera');
    camButton.dataset.isMuted = String(state.camOff);
    camButton.classList.toggle('is-off', state.camOff);
    camButton.replaceChildren(icon(state.camOff ? 'camOff' : 'cam'));
    video.classList.toggle('is-off', state.camOff);
    video.replaceChildren(state.camOff ? h('div', { class: 'preview-label' }, 'Camera is off') : '');
  }

  micButton.addEventListener('click', () => {
    state.micOff = !state.micOff;
    log('mic', state.micOff ? 'off' : 'on');
    render();
  });
  camButton.addEventListener('click', () => {
    state.camOff = !state.camOff;
    log('camera', state.camOff ? 'off' : 'on');
    render();
  });
  render();

  return {
    el: h('div', { class: 'preview' }, video, h('div', { class: 'preview-controls' }, micButton, camButton)),
    render,
  };
}

/**
 * Prejoin screen. Anonymous: "What's your name?" + name input + "Ask to join" (clicks are ignored
 * while the name is empty). Signed in: "Ready to join?" + "Join now". The continue_dialog
 * scenario covers the page with the devices dialog; the CTA is ignored until it is dismissed.
 * @param {{ state: any, cfg: import('./config.js').MockConfig, preview: ReturnType<typeof createPreview>,
 *           onJoin: () => void, log: (type: string, detail?: unknown) => void }} o
 */
export function prejoinScreen({ state, cfg, preview, onJoin, log }) {
  const nameInput = cfg.signedIn
    ? null
    : h('input', { type: 'text', 'aria-label': 'Your name', jsname: 'YPqjbf', placeholder: 'Your name', autocomplete: 'off', maxlength: '60' });
  const cta = h('button', { type: 'button', class: 'btn-primary cta' }, h('span', {}, cfg.signedIn ? 'Join now' : 'Ask to join'));
  /** @type {HTMLElement | null} */
  let devicesDialog = null;

  const nameIsEmpty = () => !!nameInput && nameInput.value.trim() === '';
  const renderCta = () => cta.classList.toggle('is-disabled', nameIsEmpty());

  nameInput?.addEventListener('input', () => {
    state.name = nameInput.value;
    renderCta();
  });
  cta.addEventListener('click', () => {
    if (devicesDialog) return log('cta_ignored', 'devices dialog is open');
    if (nameIsEmpty()) return log('cta_ignored', 'name is empty');
    state.name = nameInput ? nameInput.value.trim() : cfg.account;
    onJoin();
  });
  renderCta();

  const root = h('main', { class: 'prejoin' },
    preview.el,
    h('div', { class: 'join-panel' },
      h('h1', {}, cfg.signedIn ? 'Ready to join?' : 'What’s your name?'),
      nameInput,
      h('div', { class: 'join-actions' }, cta),
    ),
  );

  if (cfg.scenario === 'continue_dialog') {
    devicesDialog = h('div', { class: 'scrim' },
      h('div', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'devices-title', class: 'dialog devices-dialog' },
        h('h2', { id: 'devices-title' }, 'Do you want people to see and hear you in the meeting?'),
        h('p', {}, 'You can still turn off your microphone and camera anytime in the meeting.'),
        h('div', { class: 'dialog-actions vertical' },
          h('button', { type: 'button', class: 'btn-primary', onClick: () => log('allow_devices_clicked') },
            h('span', {}, 'Allow microphone and camera')),
          h('button', {
            type: 'button',
            class: 'btn-text',
            onClick: () => {
              devicesDialog?.remove();
              devicesDialog = null;
              state.micOff = true;
              state.camOff = true;
              preview.render();
              log('continue_without_devices');
            },
          }, h('span', {}, 'Continue without microphone and camera')),
        ),
      ),
    );
    root.append(devicesDialog);
  }
  return root;
}

/**
 * Lobby: waiting to be admitted. Meet shows a "Leave call" button here too.
 * @param {{ preview: ReturnType<typeof createPreview>, onLeave: () => void }} o
 */
export function lobbyScreen({ preview, onLeave }) {
  return h('main', { class: 'prejoin lobby' },
    preview.el,
    h('div', { class: 'join-panel' },
      h('h1', {}, 'Asking to be let in…'),
      h('p', {}, 'You’ll join the call when someone lets you in'),
      h('div', { class: 'join-actions' },
        h('button', { type: 'button', class: 'round-btn hangup', 'aria-label': 'Leave call', onClick: onLeave }, icon('hangup'))),
    ),
  );
}
