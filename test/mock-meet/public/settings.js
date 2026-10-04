// "More options" menu and the Settings dialog (Captions tab → Meeting language).
import { h, icon } from './dom.js';
import { languageName, offeredLanguages } from './captions.js';

/**
 * The menu opened by "More options". Added to the DOM only while open.
 * @param {{ onSettings: () => void, log: (type: string, detail?: unknown) => void }} o
 */
export function createOptionsMenu({ onSettings, log }) {
  const item = (label, onClick) =>
    h('li', { role: 'menuitem', tabindex: '-1', class: 'menu-item', onClick }, h('span', {}, label));
  const el = h('ul', { role: 'menu', 'aria-label': 'Call options', class: 'menu' },
    item('Change layout', () => close()),
    item('Full screen', () => close()),
    item('Report a problem', () => close()),
    item('Settings', () => {
      close();
      onSettings();
    }),
  );
  /** @type {HTMLElement | null} */
  let host = null;
  const isOpen = () => el.isConnected;
  function close() {
    if (isOpen()) log('menu', 'closed');
    el.remove();
  }
  return {
    el,
    isOpen,
    close,
    /** @param {HTMLElement} parent */
    mount(parent) {
      host = parent;
    },
    toggle() {
      if (isOpen()) return close();
      host?.append(el);
      log('menu', 'opened');
    },
  };
}

const TABS = ['Audio', 'Video', 'General', 'Captions', 'Reactions'];

/**
 * Modal Settings dialog. The Captions tab holds the "Meeting language" dropdown whose
 * `<ul aria-label="Meeting language">` stays display:none until opened; clicking an `li`
 * (even via element.click() while hidden) selects the caption language. With
 * langPicker 'combobox' the tab has no language list (only the caption bar can change it).
 * @param {{ state: any, onLanguage: (code: string) => void, onClose: () => void, langList?: string,
 *           langPicker?: 'combobox'|'settings'|'both' }} o
 * @returns {HTMLElement} the scrim element containing the dialog
 */
export function createSettingsDialog({ state, onLanguage, onClose, langList = '', langPicker = 'both' }) {
  const content = h('div', { class: 'settings-content' });
  const tabButtons = TABS.map((name) =>
    h('button', { type: 'button', role: 'tab', class: 'settings-tab', 'aria-label': name, 'aria-selected': 'false', onClick: () => select(name) },
      h('span', {}, name)));

  function select(name) {
    tabButtons.forEach((b) => b.setAttribute('aria-selected', String(b.getAttribute('aria-label') === name)));
    content.replaceChildren(name === 'Captions' ? captionsPanel() : placeholderPanel(name));
  }

  function placeholderPanel(name) {
    const rows = {
      Audio: ['Microphone', 'Permission needed'],
      Video: ['Camera', 'Permission needed'],
      General: ['Leave empty calls', 'On'],
      Reactions: ['Show reactions', 'On'],
    }[name];
    return h('section', {}, h('h2', {}, name), h('div', { class: 'setting-row' }, h('div', {}, rows[0]), h('div', { class: 'hint' }, rows[1])));
  }

  function captionsPanel() {
    if (langPicker === 'combobox') {
      return h('section', {},
        h('h2', {}, 'Captions'),
        h('div', { class: 'setting-row' },
          h('div', {}, h('div', {}, 'Meeting language'), h('div', { class: 'hint' }, 'Change the meeting language from the captions bar')),
          h('div', { class: 'hint' }, languageName(state.captionLang)),
        ),
      );
    }
    const triggerLabel = h('span', {}, languageName(state.captionLang));
    const list = h('ul', { role: 'listbox', 'aria-label': 'Meeting language', class: 'select-list', style: 'display: none' },
      offeredLanguages(langList).map(([code, label]) =>
        h('li', { role: 'option', 'data-value': langList === 'nodatavalue' ? null : code, 'data-code': code, 'aria-selected': String(code === state.captionLang), onClick: () => choose(code) }, label)));
    const trigger = h('button', {
      type: 'button',
      class: 'select-trigger',
      'aria-haspopup': 'listbox',
      'aria-expanded': 'false',
      onClick: () => setOpen(list.style.display === 'none'),
    }, triggerLabel, icon('down'));

    function setOpen(open) {
      list.style.display = open ? 'block' : 'none';
      trigger.setAttribute('aria-expanded', String(open));
    }
    function choose(code) {
      onLanguage(code);
      triggerLabel.textContent = languageName(code);
      for (const li of list.children) li.setAttribute('aria-selected', String(li.dataset.code === code));
      setOpen(false);
    }

    return h('section', {},
      h('h2', {}, 'Captions'),
      h('div', { class: 'setting-row' },
        h('div', {}, h('div', {}, 'Meeting language'), h('div', { class: 'hint' }, 'Language that everyone is speaking in the meeting')),
        h('div', { class: 'select' }, trigger, list),
      ),
    );
  }

  select('Audio');
  return h('div', { class: 'scrim' },
    h('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Settings', class: 'dialog settings-dialog' },
      h('div', { class: 'dialog-header' },
        h('h2', {}, 'Settings'),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close dialog', onClick: onClose }, icon('close'))),
      h('div', { class: 'settings-body' }, h('nav', { role: 'tablist', class: 'settings-tabs' }, tabButtons), content),
    ),
  );
}
