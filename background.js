import { solveImage } from './ai/nvidiaClient.js';

const DEFAULT_SETTINGS = { model: 'nvidia/nemotron-3.5-super-vl-120b-a12b', apiKey: '', endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions', timeout: '300000', tokenLimit: '8192', attempts: '3', darkMode: false };
const DEFAULT = { status: 'idle', progress: { sheet: 0, category: 'Visual', question: 0, questionsCompleted: 0, categoriesCompleted: 0 }, logs: [] };
const CATEGORIES = ['Visual', 'Verbal', 'Analytical Thinking', 'Numerical Ability', 'Memory and Concentration'];
async function state() { return (await chrome.storage.local.get('botState')).botState || DEFAULT; }
let stateQueue = Promise.resolve();
function enqueueState(work) {
  const result = stateQueue.then(work);
  stateQueue = result.catch(() => {});
  return result;
}
async function broadcastState(n) {
  await chrome.runtime.sendMessage({type:'STATE',state:n}).catch(()=>{});
  const tabs = await chrome.tabs.query({url:['https://logiqids.com/*','https://www.logiqids.com/*']});
  await Promise.all(tabs.map(t=>chrome.tabs.sendMessage(t.id,{type:'STATE',state:n}).catch(()=>{})));
}
async function update(patch) {
  return enqueueState(async () => {
    const s = await state();
    const n = { ...s, ...patch, progress: patch.progress ? { ...s.progress, ...patch.progress } : s.progress };
    await chrome.storage.local.set({ botState: n });
    await broadcastState(n);
    return n;
  });
}
async function log(message) {
  const entry = { time: new Date().toLocaleTimeString(), message };
  return enqueueState(async () => {
    const s = await state();
    const n = { ...s, logs: [...(s.logs || []).slice(-99), entry] };
    await chrome.storage.local.set({ botState: n });
    await broadcastState(n);
    return n;
  });
}
async function ensureContent(tab) {
  if (!tab?.id || !/^https:\/\/(www\.)?logiqids\.com\//.test(tab.url || '')) throw new Error('Open LogIQids before starting.');
  try { await chrome.tabs.sendMessage(tab.id, { type: 'PING' }); }
  catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/content.js'] });
  }
  const reply = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_STATE' });
  if (!reply?.stage) throw new Error('LogIQids page script did not respond. Refresh the LogIQids tab and try again.');
  return reply.stage;
}
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    if (msg.type === 'GET_STATE') return reply(await state());
    if (msg.type === 'START') {
      try { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); const stage = await ensureContent(tab); await update({ status: 'waiting-confirmation' }); await log(`LogIQids detected (${stage}). Navigate to ThinkSheets and confirm to begin.`); return reply({ ok: true, stage }); }
      catch(e) { await update({ status: 'paused' }); await log(`Start failed: ${e.message}`); return reply({ ok: false, error: e.message }); }
    }
    if (msg.type === 'CONFIRM') {
      await update({ status: 'running' }); await log('Automation started by user.');
      try { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); const stage = await ensureContent(tab); await chrome.tabs.sendMessage(tab.id, { type: 'RUN_NOW' }); await log(`Page script acknowledged Start; current page state: ${stage}.`); }
      catch(e) { await update({ status: 'paused' }); await log(`Automation paused: ${e.message}`); }
      return reply({ ok: true });
    }
    if (msg.type === 'PAUSE') { await update({ status: 'paused' }); await log('Paused. Current progress saved.'); return reply({ ok: true }); }
    if (msg.type === 'RESUME') { await update({ status: 'running' }); await log('Resumed.'); try { const [tab]=await chrome.tabs.query({active:true,currentWindow:true}); const stage=await ensureContent(tab); await chrome.tabs.sendMessage(tab.id,{type:'RUN_NOW'}); await log(`Resume command sent to page script (${stage}).`); } catch(e) { await update({status:'paused'}); await log(`Resume failed: ${e.message}`); } return reply({ ok: true }); }
    if (msg.type === 'STOP') { await update({ status: 'stopped' }); await log('Stopped by user.'); return reply({ ok: true }); }
    if (msg.type === 'SOLVE') {
      try { const cfg = (await chrome.storage.local.get('settings')).settings || {}; const answer = await solveImage(msg.image, cfg); reply({ ok: true, answer }); }
      catch (e) { reply({ ok: false, error: e.message }); }
      return;
    }
    if (msg.type === 'CAPTURE_AND_SOLVE') {
      try {
        const tab = sender.tab;
        if (!tab?.id || !tab.windowId || !/^https:\/\/(www\.)?logiqids\.com\//.test(tab.url || '')) throw new Error('Could not identify the LogIQids question tab.');
        const cfg = (await chrome.storage.local.get('settings')).settings || {};
        if (!cfg.apiKey) throw new Error('Add your NVIDIA API key in Settings before solving a question.');
        const [activeTab] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
        if (activeTab?.id !== tab.id) throw new Error('The LogIQids question tab is not active. Return to it and resume.');
        await log('Capturing the visible question and sending it to NVIDIA.');
        const image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
        if (!image || !/^data:image\/png;base64,/.test(image)) throw new Error('The browser did not return a PNG screenshot.');
        await log(`Question screenshot captured (${Math.round(image.length / 1024)} KB).`);
        const answer = await solveImage(image, cfg, msg.choices, msg.questionText, async event => {
          if (event.type === 'model') await log(`Using ${event.model} instead of ${event.requestedModel}: ${event.reason}`);
          else if (event.type === 'attempt') await log(`NVIDIA request ${event.number}/${event.total}.`);
          else if (event.type === 'raw') await log(`AI raw answer ${event.number}: ${event.raw || `[empty; finish_reason=${event.finishReason}; completion_tokens=${event.completionTokens ?? 'unknown'}]`}`);
          else if (event.type === 'retry') await log(`NVIDIA response ${event.number} was unusable: ${event.error} Retrying.`);
          else if (event.type === 'fatal') await log(`NVIDIA request cannot be retried: ${event.error}`);
        });
        if (!answer || typeof answer !== 'object') throw new Error('NVIDIA returned no structured answer.');
        await log('NVIDIA vision response received and validated.');
        reply({ ok: true, answer });
      } catch (e) { reply({ ok: false, error: e?.message || 'Screenshot or NVIDIA request failed.' }); }
      return;
    }
    if (msg.type === 'PROGRESS') { await update({ progress: { ...(await state()).progress, ...msg.progress } }); return reply({ ok: true }); }
    if (msg.type === 'RESET_COUNTERS') {
      await update({ progress: { sheet: 0, question: 0, questionsCompleted: 0, categoriesCompleted: 0 } });
      await log('All progress counters reset from Settings.');
      return reply({ ok: true });
    }
    if (msg.type === 'RESET_DEFAULTS') {
      await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
      await update({ status: 'idle', progress: { sheet: 0, category: 'Visual', question: 0, questionsCompleted: 0, categoriesCompleted: 0 }, logs: [] });
      return reply({ ok: true });
    }
    if (msg.type === 'LOG') { await log(msg.message); return reply({ ok: true }); }
  })(); return true;
});
chrome.runtime.onInstalled.addListener(async () => {
  const RESET_VERSION = '1.0.22';
  const saved = await chrome.storage.local.get(['botState', 'defaultsResetVersion']);
  if (saved.defaultsResetVersion !== RESET_VERSION) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS, botState: DEFAULT, defaultsResetVersion: RESET_VERSION });
  } else if (!saved.botState) {
    await chrome.storage.local.set({ botState: DEFAULT });
  }
});
