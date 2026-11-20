const ids = ['model', 'endpoint', 'timeout', 'tokenLimit', 'attempts'];
const RESET_VERSION = '1.0.22';
const DEFAULT_SETTINGS = { model: 'nvidia/nemotron-3.5-super-vl-120b-a12b', apiKey: '', endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions', timeout: '300000', tokenLimit: '8192', attempts: '3', darkMode: false };
let savedSettings = {};

async function loadSettings() {
  const stored = await chrome.storage.local.get(['settings', 'botState', 'defaultsResetVersion']);
  if (stored.defaultsResetVersion !== RESET_VERSION) {
    savedSettings = { ...DEFAULT_SETTINGS };
    const botState = { status: 'idle', progress: { sheet: 0, category: 'Visual', question: 0, questionsCompleted: 0, categoriesCompleted: 0 }, logs: [] };
    await chrome.storage.local.set({ settings: savedSettings, botState, defaultsResetVersion: RESET_VERSION });
  } else {
    savedSettings = stored.settings || { ...DEFAULT_SETTINGS };
  }
  if (!Number(savedSettings.timeout) || Number(savedSettings.timeout) === 90000) {
    savedSettings.timeout = '300000';
  }
  if (!Number(savedSettings.tokenLimit)) savedSettings.tokenLimit = '8192';
  if (savedSettings.attempts == null) {
    const oldRetries = Number(savedSettings.retries ?? 2);
    savedSettings.attempts = String(Number.isSafeInteger(oldRetries) && oldRetries >= 0 ? oldRetries + 1 : 3);
    delete savedSettings.retries;
  }
  await chrome.storage.local.set({ settings: savedSettings });
  document.getElementById('darkMode').checked = savedSettings.darkMode === true;
  applyTheme(savedSettings.darkMode === true);
  for (const id of ids) {
    if (savedSettings[id] !== undefined) document.getElementById(id).value = savedSettings[id];
  }
  document.getElementById('timeout').value = Math.round(Number(savedSettings.timeout ?? 300000) / 1000);
  const savedAttempts = Number(savedSettings.attempts ?? 3);
  document.getElementById('attempts').value = Number.isSafeInteger(savedAttempts) && savedAttempts >= 1 ? savedAttempts : 3;
  document.getElementById('keyStatus').textContent = savedSettings.apiKey
    ? 'NVIDIA API key is saved. Leave the field blank to keep it.'
    : 'No API key saved yet. Add one before starting question solving.';
  updateModelNotice();
}

function updateModelNotice() {
  const value = document.getElementById('model').value;
  document.getElementById('modelStatus').textContent = /nemotron-3-nano-omni.*reasoning|meta\/llama-3\.2-90b-vision-instruct|meta\/muse-glimmer-30b/i.test(value)
    ? 'This model ran out of answer tokens or is retired. The assistant will use nvidia/nemotron-3.5-super-vl-120b-a12b for question solving.'
    : '';
}

function applyTheme(enabled) {
  document.documentElement.dataset.theme = enabled ? 'dark' : 'light';
}

document.getElementById('darkMode').addEventListener('change', async event => {
  const darkMode = event.target.checked;
  applyTheme(darkMode);
  savedSettings = { ...savedSettings, darkMode };
  await chrome.storage.local.set({ settings: savedSettings });
});

document.getElementById('model').addEventListener('input', updateModelNotice);

document.getElementById('resetDefaults').onclick = async () => {
  if (!confirm('Restore all default settings, clear the saved NVIDIA API key, and reset all counters to 0?')) return;
  const result = await chrome.runtime.sendMessage({ type: 'RESET_DEFAULTS' });
  document.getElementById('resetStatus').textContent = result?.ok
    ? 'Defaults restored. The API key is cleared and all counters are 0.'
    : `Could not restore defaults: ${result?.error || 'extension did not respond'}`;
  if (result?.ok) await loadSettings();
};

document.querySelector('#save').onclick = async () => {
  const enteredKey = document.getElementById('apiKey').value.trim();
  const settings = Object.fromEntries(ids.map(id => [id, document.getElementById(id).value.trim()]));
  const timeoutSeconds = Number(settings.timeout);
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 10 || timeoutSeconds * 1000 > Number.MAX_SAFE_INTEGER) {
    document.getElementById('saved').textContent = 'Enter a timeout of at least 10 seconds.';
    return;
  }
  settings.timeout = String(Math.round(timeoutSeconds * 1000));
  const tokenLimit = Number(settings.tokenLimit);
  if (!Number.isInteger(tokenLimit) || tokenLimit < 1 || tokenLimit > 131072) {
    document.getElementById('saved').textContent = 'Token limit must be an integer from 1 to 131072.';
    return;
  }
  settings.tokenLimit = String(tokenLimit);
  const attempts = Number(settings.attempts);
  if (!Number.isSafeInteger(attempts) || attempts < 1) {
    document.getElementById('saved').textContent = 'Request attempts must be a positive whole number.';
    return;
  }
  settings.attempts = String(attempts);
  settings.darkMode = document.getElementById('darkMode').checked;
  settings.apiKey = enteredKey || savedSettings.apiKey || '';
  if (settings.apiKey && !settings.apiKey.startsWith('nvapi-')) {
    document.getElementById('saved').textContent = 'Check the NVIDIA key format.';
    return;
  }
  await chrome.storage.local.set({ settings });
  savedSettings = settings;
  document.getElementById('apiKey').value = '';
  document.getElementById('keyStatus').textContent = settings.apiKey
    ? 'NVIDIA API key is saved. Leave the field blank to keep it.'
    : 'No API key saved yet. Add one before starting question solving.';
  updateModelNotice();
  document.getElementById('saved').textContent = 'Settings saved';
  setTimeout(() => { document.getElementById('saved').textContent = ''; }, 2000);
};

loadSettings().catch(() => {
  document.getElementById('keyStatus').textContent = 'Could not load extension settings. Reopen the Settings page.';
});
