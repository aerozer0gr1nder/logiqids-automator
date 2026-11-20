(() => {
  const categories=['Visual','Verbal','Analytical Thinking','Numerical Ability','Memory and Concentration'];
  const norm=s=>(s||'').replace(/\s+/g,' ').trim().toLowerCase();
  const visible=e=>!!(e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden');
  const text=e=>norm(e?.innerText||e?.value||e?.getAttribute('aria-label'));
  const clickable=e=>e?.matches('button,a,[role="button"],input[type="button"],input[type="submit"]')?e:e?.closest('button,a,[role="button"]');
  const buttons=()=>[...document.querySelectorAll('button,a,[role="button"],input[type="button"],input[type="submit"]')].filter(visible);
  function detect(){ const all=norm(document.body.innerText); if(location.pathname.includes('/worksheet/result')||all.includes('thinksheet result'))return 'results'; if(all.includes('would you like to double your xp'))return 'xp-prompt'; if(location.pathname.includes('/worksheet/online')){if(buttons().some(b=>/^next$/.test(text(b)))&&(/correct!|incorrect|solution/.test(all)))return 'feedback';if(buttons().some(b=>/^submit$/.test(text(b))))return 'question';return 'question-loading';} const hasAttempt=[...document.querySelectorAll('body *')].some(e=>visible(e)&&e.children.length===0&&norm(e.innerText)==='attempt'); if(hasAttempt&&(/resume\s+thinksheet\s*#|start a new thinksheet/.test(all)))return 'category'; if(location.pathname.includes('/worksheet/topics')||all.includes('select a skill and solve thinksheets'))return 'overview'; return 'unknown'; }
  async function message(type,p={}){return chrome.runtime.sendMessage({type,...p});}
  function banner(msg,action){let box=document.getElementById('lqa-banner');if(!box){box=document.createElement('div');box.id='lqa-banner';Object.assign(box.style,{position:'fixed',zIndex:2147483647,right:'18px',top:'18px',background:'#26234f',color:'white',padding:'14px',borderRadius:'10px',font:'14px system-ui',boxShadow:'0 4px 20px #0005',maxWidth:'330px'});document.documentElement.append(box)}box.replaceChildren(document.createTextNode(msg+' '));if(action){const b=document.createElement('button');b.textContent='Begin';b.onclick=()=>message('CONFIRM').then(()=>{running=true;box.remove();message('LOG',{message:'User confirmed on ThinkSheets overview.'});safeAdvance()});box.append(b)}}
  let prior='',running=false,waitingConfirmation=false,advancing=false,lastActionStage='',working=false,lastQuestionKey='',scanTimer=0;
  const pauseForReview=async reason=>{running=false;await message('PAUSE');await message('LOG',{message:`Paused for review: ${reason}`});};
  const exactButton=label=>buttons().find(b=>text(b)===label);
  function optionCard(letter){
    const leaves=[...document.querySelectorAll('body *')].filter(e=>visible(e)&&e.children.length===0&&norm(e.innerText)===letter.toLowerCase());
    for(const leaf of leaves){let node=leaf;for(let i=0;i<6&&node&&node!==document.body;i++,node=node.parentElement){const r=node.getBoundingClientRect(),t=norm(node.innerText);if(t.length>70||r.width<100||r.height<45)continue;const cls=String(node.className||'').toLowerCase();if(/option|answer|choice|card/.test(cls))return node;const sib=[...node.parentElement.children].filter(x=>{const q=x.getBoundingClientRect();return q.width>100&&q.height>45&&Math.abs(q.width-r.width)<35&&Math.abs(q.height-r.height)<35;});if(sib.length>=3)return node;}}
    return null;
  }
  function questionNumber(){const source=document.body.innerText||'';const explicit=source.match(/question\s*#?\s*(\d+)\s*(?:of|\/|out of)\s*\d+/i);const fraction=source.match(/\b(\d+)\s*\/\s*\d+\b/);const n=Number(explicit?.[1]||fraction?.[1]);return Number.isInteger(n)&&n>0?n:null;}
  function selectedOption(choices){for(const letter of choices){const card=optionCard(letter);if(!card)continue;const cls=String(card.className||'').toLowerCase();if(/selected|active|chosen|checked/.test(cls)||card.getAttribute('aria-pressed')==='true'||card.getAttribute('aria-checked')==='true'||card.querySelector('input:checked,[aria-checked="true"],[aria-pressed="true"]'))return letter;}return null;}
  async function submitSelectedAnswer(letter, source){
    if(!running)return;
    const q=questionNumber(),s=await message('GET_STATE'),p=s?.progress||{};
    const beforeQuestionText=norm(document.body.innerText);
    await message('PROGRESS',{progress:{question:q||p.question||1,questionsCompleted:p.questionsCompleted||0}});
    await message('LOG',{message:source==='existing'?`Question ${q||p.question||'?'} already has option ${letter} selected; submitting the saved choice.`:`Selected option ${letter}, matching NVIDIA's one-letter answer.`});
    if(!running)return;
    const submit=exactButton('submit');if(!submit||submit.disabled)throw new Error('No enabled question Submit control was found after selecting the answer.');
    submit.click();await message('LOG',{message:'Submitted the selected answer; waiting for solution feedback.'});
    const advanced=await new Promise(resolve=>{const start=Date.now(),timer=setInterval(()=>{const stage=detect(),nextQ=questionNumber(),textNow=norm(document.body.innerText);if(stage==='feedback'||stage==='results'||stage==='overview'){clearInterval(timer);resolve(stage);}else if(stage==='question'&&((q&&nextQ&&nextQ>q)||textNow!==beforeQuestionText)){clearInterval(timer);resolve('next question');}else if(Date.now()-start>10000){clearInterval(timer);resolve('timeout');}},150);});
    if(advanced==='timeout')throw new Error('Submit was clicked, but answer feedback did not appear within 10 seconds.');
    await message('LOG',{message:`Answer registered; page moved to ${advanced}.`});
  }
  async function solveCurrentQuestion(){
    if(working||!running||detect()!=='question')return; const pageText=(document.body.innerText||'').replace(/\s+/g,' ').trim();const prompt=norm(pageText).slice(0,1200);const key=`${location.href}|${prompt}`;if(key===lastQuestionKey)return;working=true;lastQuestionKey=key;
    try{
      const choices=['A','B','C','D'].filter(letter=>{const card=optionCard(letter);if(!card)return false;const r=card.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.right>0&&r.top<innerHeight&&r.left<innerWidth;});
      if(choices.length<2)throw new Error(`Only ${choices.length} visible answer choice(s) could be mapped from the page. Scroll the complete question and choices into view, then resume.`);
      const q=questionNumber(),stateNow=await message('GET_STATE'),progress=stateNow?.progress||{};
      if(q&&q!==progress.question)await message('PROGRESS',{progress:{question:q}});
      const existing=selectedOption(choices);if(existing){await submitSelectedAnswer(existing,'existing');return;}
      await message('LOG',{message:`Question and ${choices.length} visible answer choices detected. Capturing screenshot for NVIDIA vision analysis.`});
      const questionText=pageText.slice(0,1800);
      const result=await message('CAPTURE_AND_SOLVE',{choices,questionText});
      if(!running){await message('LOG',{message:'Defaults were reset while the request was running; the answer was not selected.'});return;}
      if(!result||typeof result!=='object')throw new Error('The extension background did not return a response. Check that the extension is enabled, then resume.');
      if(!result.ok)throw new Error(result.error||'Screenshot or NVIDIA vision request failed.');
      const a=result.answer;
      if(!a||typeof a!=='object'||a.status!=='success'||typeof a.answer!=='string')throw new Error('NVIDIA did not return a validated answer label.');
      const letter=String(a.answer).trim().match(/^[A-D]$/i)?.[0]?.toUpperCase();if(!letter||!choices.includes(letter))throw new Error('The model response did not match a visible answer label. No option was selected.');
      const card=optionCard(letter);if(!card)throw new Error(`Could not safely map answer ${letter} to an option card.`);
      const beforeClass=String(card.className||''),beforeBg=getComputedStyle(card).backgroundColor;
      card.scrollIntoView({block:'center'});card.click();await new Promise(r=>setTimeout(r,250));
      const afterBg=getComputedStyle(card).backgroundColor;
      const selected=/selected|active|chosen|checked/.test(String(card.className||'').toLowerCase())||card.getAttribute('aria-pressed')==='true'||card.getAttribute('aria-checked')==='true'||String(card.className||'')!==beforeClass||afterBg!==beforeBg;
      if(!selected)throw new Error(`Clicked option ${letter}, but could not verify that LogIQids selected it.`);
      await submitSelectedAnswer(letter,'ai');
    }catch(e){lastQuestionKey='';await pauseForReview(`Question solver failed: ${e?.message||String(e)}`);}finally{working=false;if(running)setTimeout(()=>safeAdvance(),100);}
  }
  async function navigateToOpenCategory(){
    const all=norm(document.body.innerText);if(!all.includes('select a skill and solve thinksheets'))return;
    const s=await message('GET_STATE'),p=s?.progress||{}, idx=Math.max(0,categories.indexOf(p.category));
    const name=categories[idx]||categories[0];
    const cards=[...document.querySelectorAll('[class*="styles_topicCardInner__"]')].filter(visible);
    let tile=cards.find(e=>norm(e.innerText).includes(name.toLowerCase()));
    if(!tile){const title=[...document.querySelectorAll('body *')].find(e=>visible(e)&&e.children.length===0&&norm(e.innerText)===name.toLowerCase());if(title){tile=title;for(let i=0;i<8&&tile.parentElement;i++,tile=tile.parentElement){const r=tile.getBoundingClientRect();if(r.width>180&&r.height>100&&norm(tile.innerText).includes(name.toLowerCase()))break;}}}
    if(!tile){await pauseForReview(`Could not locate the ${name} tile.`);return;}
    tile.scrollIntoView({block:'center'});tile.click();await message('LOG',{message:`Opened ${name} tile for ThinkSheet ${p.sheet||1}.`});
    const changed=await new Promise(resolve=>{const started=Date.now(),timer=setInterval(()=>{if(detect()==='category'){clearInterval(timer);resolve(true);}else if(Date.now()-started>8000){clearInterval(timer);resolve(false);}},250);});
    if(!changed)await pauseForReview(`Clicked ${name}, but its category panel did not appear.`);
  }
  async function clickAttempt(){
    const s=await message('GET_STATE'),sheet=s?.progress?.sheet||1;
    // Category cards and the modal can share generic IDs/classes. Find actual blue
    // lqButton actions by their rendered label and shine child across the page.
    const actions=[...document.querySelectorAll('[class*="styles_lqButton"]')].filter(e=>visible(e)&&norm(e.innerText)==='attempt'&&e.querySelector('.styles_shine__caYTx'));
    if(!actions.length){await pauseForReview('Category panel found, but no visible blue Attempt action with styles_shine__caYTx was found.');return;}
    const resumeCard=[...document.querySelectorAll('[class*="styles_worksheetCard"]')].find(e=>visible(e)&&/resume\s+thinksheet\s*#/.test(norm(e.innerText)));
    const resumeAction=resumeCard?.querySelector('[class*="styles_lqButton"]');
    const mode=resumeAction?'resume':'new';
    // Resume is scoped to its worksheet card. Otherwise the panel's single blue Attempt
    // action is the Start a new thinksheet control; duplicate IDs are ignored.
    const action=resumeAction&&visible(resumeAction)?resumeAction:actions.find(e=>/start a new thinksheet/.test(norm(e.parentElement?.innerText)))||actions[0];
    const clickTarget=action.querySelector('[class*="styles_button__"]')||action.querySelector('.styles_shine__caYTx')||action;
    if(!visible(clickTarget)){await pauseForReview('Attempt action is present but its inner clickable element is not visible.');return;}
    clickTarget.scrollIntoView({block:'center'});
    await message('LOG',{message:`Clicking the inner Attempt control (${clickTarget.className||clickTarget.tagName}); mode=${mode}.`});
    clickTarget.click();
    await message('LOG',{message:`Attempt click sent for ${mode==='resume'?'Resume':'Start new'} ThinkSheet ${sheet} (${categories[Math.max(0,categories.indexOf(s?.progress?.category))]||'current category'}).`});
    const changed=await new Promise(resolve=>{const started=Date.now(),timer=setInterval(()=>{if(location.pathname.includes('/worksheet/online')){clearInterval(timer);resolve(true);}else if(Date.now()-started>8000){clearInterval(timer);resolve(false);}},250);});
    if(!changed)await pauseForReview('Attempt control was clicked, but the question page did not open.');
    else { await message('LOG',{message:'ThinkSheet question page opened.'}); setTimeout(()=>safeAdvance(),600); }
  }
  async function safeAdvance(){
    if(!running||advancing)return; const stage=detect(); if(stage==='question'){solveCurrentQuestion();return;} if(stage==='overview'||stage==='category'){advancing=true;try{if(stage==='overview')await navigateToOpenCategory();else await clickAttempt();}finally{setTimeout(()=>{advancing=false;safeAdvance();},1200);}return;} if(lastActionStage===stage)return; let target=null, label='';
    if(stage==='xp-prompt'){
      const booster=document.querySelector('.styles_boosterModal__aXS3J,[class*="styles_boosterModal__"]');
      const svgClose=booster?.querySelector('.styles_closeIcon__3IKj2,[class*="styles_closeIcon__"]');
      if(svgClose&&visible(svgClose)) target=svgClose;
      if(!target){
        const dialogs=[...document.querySelectorAll('[role="dialog"],.modal,.popup,[class*="modal" i],[class*="Modal" i]')].filter(visible);
        const scope=dialogs.find(d=>/double your xp/.test(text(d)))||document.body;
        target=[...scope.querySelectorAll('button,[role="button"],a,[class*="close" i],[aria-label*="close" i],[title*="close" i]')].find(e=>{
          const cls=e.className?.baseVal||e.className||'';
          return visible(e)&&(/^(close|×|x)$/.test(text(e))||/close|dismiss/i.test(`${e.getAttribute('aria-label')||''} ${e.getAttribute('title')||''} ${cls}`));
        });
      }
      if(!target){await message('LOG',{message:'XP prompt detected; no safe close control found. Paused for user review.'});running=false;await message('PAUSE');return;}
      label='Close optional XP prompt';
    } else if(stage==='feedback') { target=buttons().find(b=>text(b)==='next'); label='Next question'; if(target){const s=await message('GET_STATE'),p=s?.progress||{};await message('PROGRESS',{progress:{...p,questionsCompleted:(p.questionsCompleted||0)+1}});} }
    else if(stage==='results' && location.pathname.includes('/worksheet/result')) {
      const s=await message('GET_STATE'),p=s?.progress||{},i=Math.max(0,categories.indexOf(p.category));
      const next=i+1<categories.length?{sheet:p.sheet||1,category:categories[i+1],question:0}:{sheet:(p.sheet||1)+1,category:categories[0],question:0};
      await message('PROGRESS',{progress:next});await message('LOG',{message:`Completed ThinkSheet ${p.sheet||1} in ${p.category||categories[i]}; next is ThinkSheet ${next.sheet}, ${next.category}.`});target=buttons().find(b=>text(b)==='continue');label='Continue from ThinkSheet results';
    }
    if(!target)return;
    advancing=true;lastActionStage=stage;try{
      target.scrollIntoView({block:'center'});
      if(stage==='xp-prompt'){
        // The site's close control is an SVG React handler. Dispatch the user-like
        // event sequence on the SVG; SVGElement.click() is not consistently present.
        for(const type of ['pointerdown','mousedown','pointerup','mouseup','click']) target.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,composed:true,view:window}));
      } else {
        if(typeof target.click!=='function')throw new Error(`${label} control has no click handler.`);
        target.click();
      }
      await message('LOG',{message:`Dispatched ${label} action.`});
      if(stage==='xp-prompt'){
        await new Promise(r=>setTimeout(r,500));
        if(detect()==='xp-prompt'){
          const clickable=target.closest?.('button,[role="button"]');
          const fallback=clickable||target.parentElement;
          if(fallback&&fallback!==document.body){for(const type of ['pointerdown','mousedown','pointerup','mouseup','click'])fallback.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,composed:true,view:window}));await message('LOG',{message:'XP prompt remained; dispatched a fallback close action.'});await new Promise(r=>setTimeout(r,500));}
        }
        if(detect()==='xp-prompt'){await message('LOG',{message:'XP prompt is still visible after close attempts; pausing for user review.'});running=false;await message('PAUSE');}
        else await message('LOG',{message:'XP prompt closed; continuing automation.'});
      }
    }catch(e){
      if(stage==='xp-prompt'&&detect()!=='xp-prompt')await message('LOG',{message:'XP prompt closed despite a close-control exception; continuing automation.'});
      else {running=false;await message('LOG',{message:`Could not activate ${label}: ${e?.message||String(e)}. Paused for user review.`});await message('PAUSE');}
    }finally{setTimeout(()=>{advancing=false;},900);setTimeout(()=>safeAdvance(),1100);}
  }
  const observer=new MutationObserver(()=>{
    if(scanTimer)return;
    scanTimer=setTimeout(()=>{scanTimer=0;const d=detect();if(d!==prior){prior=d;if(d!==lastActionStage)lastActionStage='';message('LOG',{message:`Page state detected: ${d}.`});}if(waitingConfirmation&&d==='overview')banner('ThinkSheets page detected. Start the assistant?',true);if(running)safeAdvance();},200);
  }); observer.observe(document.documentElement,{childList:true,subtree:true});
  chrome.runtime.onMessage.addListener(async m=>{
    if(m.type==='PING')return {ok:true};
    if(m.type==='GET_PAGE_STATE')return {stage:detect(),url:location.pathname};
    if(m.type==='RUN_NOW'){running=true;const stage=detect();await message('LOG',{message:`Run command received by page script; state=${stage}.`});safeAdvance();return {ok:true,stage};}
    if(m.type==='STATE'&&m.state.status==='waiting-confirmation'&&detect()==='overview') banner('ThinkSheets page detected. Start the assistant?',true);
    if(m.type==='STATE'){waitingConfirmation=m.state.status==='waiting-confirmation';running=m.state.status==='running';if(m.state.status!=='waiting-confirmation')document.getElementById('lqa-banner')?.remove();}
  });
  async function act(el,label){if(!el||!visible(el))throw Error(`Could not safely locate ${label}.`);el.scrollIntoView({block:'center'});el.click();await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error(`${label} did not produce a detectable page change.`)),8000);setTimeout(()=>{clearTimeout(timer);resolve()},500)});}
  function snapshot(){const candidates=[...document.querySelectorAll('main, [role="main"], .question, .question-container, .quiz, body')].filter(visible);return candidates.sort((a,b)=>b.innerText.length-a.innerText.length)[0]||document.body}
  async function onSolve(){const container=snapshot();const canvas=document.createElement('canvas');const box=container.getBoundingClientRect(); // Full visible tab capture is supplied by the extension popup/API when available.
    return {container,box}; }
  // Intentionally avoid automatic question/submit clicks until page-specific controls can be verified.
  chrome.runtime.sendMessage({type:'GET_STATE'}).then(s=>{waitingConfirmation=s?.status==='waiting-confirmation';running=s?.status==='running';if(waitingConfirmation&&detect()==='overview')banner('ThinkSheets page detected. Start the assistant?',true);safeAdvance();}).catch(()=>{});
  window.__logiqidsAssistant={detect,categories,visible,text,clickable,buttons,onSolve,safeAdvance};
})();
