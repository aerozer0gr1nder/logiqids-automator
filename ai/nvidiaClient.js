const INSTRUCTION = `You are an expert tutor solving a school reasoning multiple-choice question. Inspect the complete question, every diagram and number, and all visible options. Solve it efficiently, then cross-check that the chosen option satisfies the question and that the other options do not. Do not assume option order or trust OCR text if it conflicts with the image; the image is authoritative. The answer labels are A, B, C, and D. Return exactly one uppercase letter and nothing else.`;

const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_TOKEN_LIMIT = 8192;
const MAX_TOKEN_LIMIT = 131072;
const FALLBACK_MODEL = 'nvidia/nemotron-3.5-super-vl-120b-a12b';

function abortAfter(controller, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  let timer;
  const check = () => {
    const remaining = deadline - performance.now();
    if (remaining <= 0) controller.abort();
    else timer = setTimeout(check, Math.min(remaining, 2_147_000_000));
  };
  check();
  return () => clearTimeout(timer);
}

export function parseModelAnswer(raw, finishReason = 'unknown') {
  if (Array.isArray(raw)) raw = raw.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n');
  if (typeof raw !== 'string' || !raw.trim()) {
    const detail = finishReason === 'length' ? ' The output-token limit may have been exhausted during reasoning.' : '';
    throw new Error(`NVIDIA returned an empty answer (finish_reason=${finishReason}).${detail}`);
  }
  const answer = raw.trim().toUpperCase();
  if (!/^[A-D]$/.test(answer)) throw new Error(`NVIDIA response must be exactly A, B, C, or D; received: ${raw.trim().slice(0, 120)}.`);
  return { status: 'success', answer, raw: raw.trim().slice(0, 1200) };
}

async function apiError(response, apiKey) {
  let body = '';
  try { body = await response.text(); } catch {}
  let detail = body.trim();
  try {
    const parsed = JSON.parse(body);
    detail = parsed.detail || parsed.message || parsed.error?.message || parsed.error || detail;
    if (typeof detail !== 'string') detail = JSON.stringify(detail);
  } catch {}
  detail = (detail || response.statusText || 'No error details returned by NVIDIA.')
    .replaceAll(apiKey, '[redacted]').slice(0, 500);
  const error = new Error(`NVIDIA API returned HTTP ${response.status}: ${detail}`);
  error.status = response.status;
  return error;
}

async function readStreamedCompletion(response) {
  if (!response.body?.getReader) throw new Error('NVIDIA streaming response has no readable body.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', raw = '', finishReason = 'unknown', completionTokens;
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let event;
      try { event = JSON.parse(payload); } catch { continue; }
      const choice = event?.choices?.[0];
      const content = choice?.delta?.content;
      if (typeof content === 'string') raw += content;
      else if (Array.isArray(content)) raw += content.filter(part => typeof part?.text === 'string').map(part => part.text).join('');
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (event?.usage?.completion_tokens != null) completionTokens = event.usage.completion_tokens;
    }
    if (done) break;
  }
  return { raw, finishReason, completionTokens };
}

export async function solveImage(dataUrl, cfg = {}, choices = [], questionText = '', onAttempt = () => {}) {
  if (!cfg.apiKey) throw new Error('Add your NVIDIA API key in Settings.');
  if (typeof dataUrl !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/i.test(dataUrl)) throw new Error('Question screenshot is missing or is not a supported image.');
  const url = cfg.endpoint || 'https://integrate.api.nvidia.com/v1/chat/completions';
  if (!url.startsWith('https://integrate.api.nvidia.com/')) throw new Error('This build supports NVIDIA Build endpoints at integrate.api.nvidia.com only.');
  const configuredTimeout = Number(cfg.timeout ?? cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const timeout = Number.isFinite(configuredTimeout) ? Math.max(10_000, Math.min(Number.MAX_SAFE_INTEGER, configuredTimeout)) : DEFAULT_TIMEOUT_MS;
  const legacyRetries = cfg.attempts == null ? Number(cfg.retries ?? 2) + 1 : null;
  const requestedAttempts = Number(cfg.attempts ?? legacyRetries ?? 3);
  const attempts = Number.isSafeInteger(requestedAttempts) && requestedAttempts >= 1 ? requestedAttempts : 3;
  const configuredTokenLimit = Number(cfg.tokenLimit ?? DEFAULT_TOKEN_LIMIT);
  const maxTokens = Number.isInteger(configuredTokenLimit) ? Math.max(1, Math.min(MAX_TOKEN_LIMIT, configuredTokenLimit)) : DEFAULT_TOKEN_LIMIT;
  const requestedModel = cfg.model || FALLBACK_MODEL;
  // These configurations have failed in the user's live runs (reasoning budget
  // exhaustion and an NVIDIA 410 retirement response). Muse Glimmer is active,
  // multimodal, and returns reasoning separately from the final answer.
  let model = /nemotron-3-nano-omni.*reasoning|meta\/llama-3\.2-90b-vision-instruct|meta\/muse-glimmer-30b/i.test(requestedModel)
    ? FALLBACK_MODEL
    : requestedModel;
  let fallbackUsed = model !== requestedModel;
  if (model !== requestedModel) {
    try { await onAttempt({ type: 'model', requestedModel, model, reason: 'The configured model is retired or exhausted its completion budget in prior runs.' }); } catch {}
  }
  const image = dataUrl.startsWith('data:') ? dataUrl : `data:image/png;base64,${dataUrl}`;
  let last;
  for (let i=0;i<attempts;i++) {
    try { await onAttempt({ type: 'attempt', number: i + 1, total: attempts }); } catch {}
    const controller = new AbortController(), clearAbortTimer = abortAfter(controller, timeout);
    try {
      const textContext = typeof questionText === 'string' ? questionText.trim().slice(0, 1800) : '';
      const requestBody = { model, temperature:1.0, top_p:0.95, max_tokens:maxTokens, stream:true,
        messages:[{role:'system',content:INSTRUCTION},{role:'user',content:[{type:'text',text:`Solve this school reasoning question. Use the screenshot as the source of truth for diagrams and choices. ${textContext ? `Readable page text for OCR support: ${textContext}` : ''} Visible answer labels: ${choices.join(', ') || 'A, B, C, D'}. Solve and verify the answer, then return exactly one of these letters and nothing else.`},{type:'image_url',image_url:{url:image}}]}] };
      if (model === FALLBACK_MODEL) {
        requestBody.reasoning_effort = 'low';
      }
      const response = await fetch(url, { method:'POST', headers:{'Authorization':`Bearer ${cfg.apiKey}`,'Content-Type':'application/json','Accept':'text/event-stream'}, signal:controller.signal,
      body:JSON.stringify(requestBody) });
      if (!response.ok) throw await apiError(response, cfg.apiKey);
      const { raw, finishReason, completionTokens } = await readStreamedCompletion(response);
      try { await onAttempt({ type: 'raw', number: i + 1, finishReason, completionTokens, raw: raw.trim().slice(0, 1200) }); } catch {}
      return parseModelAnswer(raw, finishReason);
    } catch(e) {
      last = e;
      if (e?.status === 410 && !fallbackUsed && model !== FALLBACK_MODEL && i + 1 < attempts) {
        const retiredModel = model;
        model = FALLBACK_MODEL;
        fallbackUsed = true;
        try { await onAttempt({ type: 'model', requestedModel: retiredModel, model, reason: 'NVIDIA reported that the configured model is no longer available.' }); } catch {}
        try { await onAttempt({ type: 'retry', number: i + 1, total: attempts, error: `Model retired; retrying with ${FALLBACK_MODEL}.` }); } catch {}
      } else if (e?.status >= 400 && e.status < 500 && e.status !== 429) {
        try { await onAttempt({ type: 'fatal', error: e.message }); } catch {}
        break;
      } else if (i + 1 < attempts) {
        try { await onAttempt({ type: 'retry', number: i + 1, total: attempts, error: e?.message || 'NVIDIA request failed.' }); } catch {}
      }
      if (i + 1 < attempts) await new Promise(r=>setTimeout(r,700*(i+1)));
    }
    finally { clearAbortTimer(); }
  }
  const finalError = new Error(last?.name === 'AbortError' ? `NVIDIA request attempt timed out after ${Math.round(timeout/1000)} seconds.` : (last?.message || 'NVIDIA request failed.'));
  if (last?.status) finalError.status = last.status;
  throw finalError;
}
