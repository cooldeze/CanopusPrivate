/* ============================================================
   ALFRED — Canopus dashboard assistant widget
   A floating square box (middle-right edge, visible on every page).
   Tap it to open a small chat panel. Type things like:
     "open sky"                       -> navigates pages
     "schedule study 5 to 6pm"        -> adds a session
     "study at 5pm for an hour"       -> adds a session
     "start a 25 min focus timer"     -> sets + starts the timer
     "what time is it"                -> tells you the time
     "what's on my schedule"          -> lists today's sessions
     "what's next"                    -> next upcoming session
     "take a break" / "10 min break"  -> logs a break, starting now

   Everything is parsed on-device with plain regex against your own
   local data (sessions, timer, clock). There is no model, no
   network call, and nothing to hallucinate — every reply is either
   a real action taken on your data or a fixed, honest fallback line.
   ============================================================ */
(function(){
'use strict';

const HISTORY_KEY='canopus_alfred_widget_log';
const MAX_TURNS=8; // how many past exchanges we keep around in the log

const PAGES=['focus','schedule','progress','sky','capsule','literature','features','terminal'];
const PAGE_ALIASES={
  home:'focus',main:'focus',dashboard:'focus',timer:'focus',
  sessions:'schedule',plan:'schedule',planner:'schedule',calendar:'schedule',
  stats:'progress',stat:'progress',progresspage:'progress',
  stars:'sky',space:'sky',astronomy:'sky',
  journal:'capsule',reels:'capsule',
  books:'literature',reading:'literature',lit:'literature',
  tools:'features',more:'features',
  term:'terminal',console:'terminal',cmd:'terminal'
};

function resolvePage(name){
  if(!name)return null;
  const n=String(name).trim().toLowerCase().replace(/[^a-z]/g,'');
  if(PAGES.includes(n))return n;
  if(PAGE_ALIASES[n])return PAGE_ALIASES[n];
  return null;
}

/* ================================================================
   Deterministic intent parsing.
   Navigate / schedule / timer / queries are all resolved here with
   plain regex against real page state — no classifier, no model,
   nothing that can invent an action that wasn't asked for.
   ================================================================ */

function normalizeWords(text){
  return text.toLowerCase().replace(/[^a-z0-9:.\s]/g,' ').replace(/\s+/g,' ').trim();
}

/* ---- navigate ---- */
const NAV_VERB_RE=/\b(open|go\s*to|goto|show|navigate\s*to|switch\s*to|take me to|jump to|view|pull up)\b/i;
function findNavPage(rawText){
  const text=normalizeWords(rawText);
  const allAliases=Object.assign({},PAGE_ALIASES);
  PAGES.forEach(p=>{ allAliases[p]=p; });
  const words=text.split(' ').filter(Boolean);
  // whole message is just a page name/alias, e.g. "sky"
  if(words.length<=2){
    for(const w of words){ if(allAliases[w]) return resolvePage(w); }
  }
  // otherwise require an explicit navigation verb alongside a page word
  if(NAV_VERB_RE.test(rawText)){
    for(const w of words){ if(allAliases[w]) return resolvePage(w); }
  }
  return null;
}

/* ---- timer ---- */
const TIMER_WORD_RE=/\b(timer|pomodoro|focus session|study session)\b/i;
function findTimerMinutes(rawText){
  let m=rawText.match(/(\d{1,3})\s*(?:min|mins|minute|minutes)\b/i);
  if(m)return parseInt(m[1],10);
  m=rawText.match(/(\d{1,2})\s*(?:hour|hr|hrs|hours)\b/i);
  if(m)return parseInt(m[1],10)*60;
  return null;
}
function findTimerIntent(rawText){
  if(!TIMER_WORD_RE.test(rawText))return null;
  const startVerb=/\b(start|begin|set|run|do)\b/i.test(rawText)||TIMER_WORD_RE.test(rawText);
  if(!startVerb)return null;
  const minutes=findTimerMinutes(rawText)||25;
  return {minutes:Math.max(1,Math.min(180,minutes))};
}

/* ---- schedule ----
   "schedule"/"plan" are ambiguous — they're also just the name of a
   page ("what's on my schedule today?"), so those two only count as
   scheduling intent when a concrete time is also present. Stronger,
   unambiguous verbs (block off / slot in / pencil in / add ... to
   schedule) count on their own and prompt for a time if missing.
   A bare "study at 5pm for an hour" with no verb at all still counts
   if it names a time AND an activity type. */
const SCHEDULE_STRONG_RE=/\b(block off|slot in|pencil in)\b/i;
const SCHEDULE_WEAK_RE=/\b(schedule|plan)\b/i;
const SCHEDULE_ADD_RE=/\badd\b.*\b(session|to (?:my )?(?:schedule|calendar|day|plan))\b/i;
const SESSION_TYPE_WORD_RE=/\b(study|read|homework|revision|revise|work|meeting|call|project|break|rest|nap|lunch|snack|exercise|gym|workout|run|jog|yoga|walk|session)\b/i;
function findScheduleIntent(rawText){
  const times=findTimeRange(rawText)||findAtFor(rawText);
  const strong=SCHEDULE_STRONG_RE.test(rawText)||SCHEDULE_ADD_RE.test(rawText);
  if(strong){
    if(!times)return {needsTime:true};
    return {start:times.start,end:times.end,type:guessSessionType(rawText),name:guessSessionName(rawText)};
  }
  const weak=SCHEDULE_WEAK_RE.test(rawText);
  if(weak && times){
    return {start:times.start,end:times.end,type:guessSessionType(rawText),name:guessSessionName(rawText)};
  }
  if(!weak && times && SESSION_TYPE_WORD_RE.test(rawText)){
    return {start:times.start,end:times.end,type:guessSessionType(rawText),name:guessSessionName(rawText)};
  }
  return null;
}
function parseClock(s){
  const m=s.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if(!m)return null;
  let h=parseInt(m[1],10);const mi=m[2]?parseInt(m[2],10):0;const ap=m[3]?m[3].toLowerCase():null;
  if(h>23||mi>59)return null;
  if(ap==='pm'&&h<12)h+=12;
  if(ap==='am'&&h===12)h=0;
  return String(h).padStart(2,'0')+':'+String(mi).padStart(2,'0');
}
function findTimeRange(text){
  const re=/(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:to|-|–|until|till)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i;
  const m=text.match(re);
  if(!m)return null;
  let t1=m[1].trim(),t2=m[2].trim();
  const hasAP=s=>/am|pm/i.test(s);
  if(!hasAP(t1)&&hasAP(t2)) t1+=t2.match(/am|pm/i)[0];
  else if(hasAP(t1)&&!hasAP(t2)) t2+=t1.match(/am|pm/i)[0];
  const start=parseClock(t1),end=parseClock(t2);
  if(start==null||end==null)return null;
  return {start,end};
}
function findAtFor(text){
  const re=/at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*for\s*(an hour and a half|half an hour|half a hour|an hour|a hour|\d+\s*(?:hour|hr|hrs|hours|min|mins|minute|minutes))\b/i;
  const m=text.match(re);
  if(!m)return null;
  const start=parseClock(m[1]);
  if(start==null)return null;
  const durText=m[2].toLowerCase();
  let dur;
  if(durText==='an hour and a half')dur=90;
  else if(durText==='half an hour'||durText==='half a hour')dur=30;
  else if(durText==='an hour'||durText==='a hour')dur=60;
  else{
    const dm=durText.match(/(\d+)\s*(hour|hr|hrs|hours|min|mins|minute|minutes)/i);
    dur=parseInt(dm[1],10);
    if(/hour|hr/i.test(dm[2]))dur*=60;
  }
  return {start,end:addMinutes(start,dur)};
}
function guessSessionType(text){
  if(/\b(study|read|homework|revision|revise)\b/i.test(text))return 'study';
  if(/\b(work|meeting|call|project)\b/i.test(text))return 'work';
  if(/\b(break|rest|nap|lunch|snack)\b/i.test(text))return 'break';
  if(/\b(exercise|gym|workout|run|jog|yoga|walk)\b/i.test(text))return 'exercise';
  return 'custom';
}
function guessSessionName(text){
  let t=text
    .replace(SCHEDULE_STRONG_RE,'')
    .replace(SCHEDULE_WEAK_RE,'')
    .replace(SCHEDULE_ADD_RE,'')
    .replace(/(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:to|-|–|until|till)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i,'')
    .replace(/at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*for\s*(?:an hour and a half|half an hour|half a hour|an hour|a hour|\d+\s*(?:hour|hr|hrs|hours|min|mins|minute|minutes))\b/i,'')
    .replace(/\b(today|tomorrow|tonight|this evening|this morning|this afternoon)\b/gi,'')
    .replace(/[^a-z0-9\s]/gi,' ')
    .replace(/\s+/g,' ')
    .trim();
  if(!t){
    const type=guessSessionType(text);
    const fallback={study:'Study session',work:'Work session',break:'Break',exercise:'Workout',custom:'Session'};
    return fallback[type];
  }
  return t.charAt(0).toUpperCase()+t.slice(1);
}

let history=[]; // {role, content} pairs kept for short context window
try{
  const saved=JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');
  if(Array.isArray(saved))history=saved.slice(-MAX_TURNS*2);
}catch(e){}

function saveHistory(){
  try{ localStorage.setItem(HISTORY_KEY,JSON.stringify(history.slice(-MAX_TURNS*2))); }catch(e){}
}

/* ---- clock / calendar helpers (local fallbacks if the page ones aren't global) ---- */
function pad2(n){return String(n).padStart(2,'0');}
function fmt12(hhmm){
  let [h,m]=String(hhmm).split(':').map(Number);
  const ap=h>=12?'PM':'AM';
  h=h%12; if(h===0)h=12;
  return h+':'+pad2(m)+' '+ap;
}
function todayDateStr(){
  return (typeof window.todayStr==='function') ? window.todayStr()
    : (()=>{const d=new Date();return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate());})();
}
function tomorrowDateStr(){
  const d=new Date(); d.setDate(d.getDate()+1);
  return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate());
}
function nowMinutes(){
  return (typeof window.nowMin==='function') ? window.nowMin()
    : (()=>{const d=new Date();return d.getHours()*60+d.getMinutes();})();
}
function toMinutes(hhmm){
  if(typeof window.toMin==='function')return window.toMin(hhmm);
  const [h,m]=hhmm.split(':').map(Number); return h*60+m;
}

/* ---- time / date query ---- */
const TIME_QUERY_RE=/\b(what'?s the time|what is the time|what time is it|current time|got the time)\b/i;
const DATE_QUERY_RE=/\b(what'?s the date|what is the date|what day is it|today'?s date|what'?s today'?s date)\b/i;

/* ---- schedule lookup / next session ---- */
const SCHEDULE_QUERY_RE=/\b(what'?s on (my )?(schedule|calendar|plan)|show (me )?(my )?schedule|what do i have (today|tomorrow)|my sessions|today'?s schedule|tomorrow'?s schedule|list (my )?sessions)\b/i;
const NEXT_QUERY_RE=/\b(what'?s next|next session|what'?s up next|what do i have next|anything (coming up|next)|what'?s coming up)\b/i;

function findScheduleQuery(text){
  if(!SCHEDULE_QUERY_RE.test(text))return null;
  return {day:/tomorrow/i.test(text)?'tomorrow':'today'};
}

/* ---- take a break ---- */
const BREAK_RE=/\b(take a break|need a break|time for a break|break time|gonna take a break|let'?s take a break)\b/i;
function findBreakIntent(text){
  if(!BREAK_RE.test(text))return null;
  if(findTimeRange(text)||findAtFor(text))return null; // explicit-time requests go through schedule parsing instead
  const minutes=findTimerMinutes(text)||15;
  return {minutes:Math.max(1,Math.min(120,minutes))};
}

/* ---- help / capabilities ---- */
const HELP_RE=/\b(what can you do|help me|^help$|what are your commands|show commands|capabilit(y|ies))\b/i;
const GREETING_RE=/^(hi|hello|hey|yo|sup|good\s*(morning|afternoon|evening))[\s!.?]*$/i;
const THANKS_RE=/\b(thanks|thank you|thx|ty)\b/i;

const HELP_TEXT="Here's what I can actually do: open a page (\"open sky\"), add to your schedule (\"study 5 to 6pm\"), start a timer (\"start a 25 min timer\"), take a break (\"take a 10 min break\"), or tell you the time, date, today's schedule, or what's next.";

/* ---------------- styles ---------------- */
const style=document.createElement('style');
style.textContent=`
#alfred-fab{position:fixed;right:calc(20px + env(safe-area-inset-right));top:50%;transform:translateY(-50%);width:52px;height:52px;border-radius:14px;background:var(--surf-panel-hi,#141414);border:1px solid var(--accent,#fff);display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:9000;box-shadow:0 6px 22px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.03);transition:transform .15s,box-shadow .15s;}
#alfred-fab:hover{transform:translateY(-50%) translateX(-2px);box-shadow:0 10px 28px rgba(0,0,0,.7);}
#alfred-fab svg{color:var(--accent,#fff);}
#alfred-fab .afb-dot{position:absolute;top:6px;right:6px;width:7px;height:7px;border-radius:50%;background:#4a9a6a;display:none;box-shadow:0 0 6px #4a9a6a;}
#alfred-fab.busy .afb-dot{display:block;background:#c9952a;box-shadow:0 0 6px #c9952a;animation:afb-pulse 1s ease-in-out infinite;}
@keyframes afb-pulse{0%,100%{opacity:1}50%{opacity:.35}}
#alfred-panel{position:fixed;right:calc(84px + env(safe-area-inset-right));top:50%;transform:translateY(-50%);width:320px;max-width:calc(100vw - 40px);height:420px;max-height:calc(100vh - 40px);background:var(--surf-modal,#0d0e10);border:0.5px solid var(--surf-line,#222);border-radius:16px;display:none;flex-direction:column;overflow:hidden;z-index:9001;box-shadow:0 20px 60px rgba(0,0,0,.6);font-family:'Inter',sans-serif;}
#alfred-panel.open{display:flex;}
#alfred-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:0.5px solid var(--surf-line,#222);flex-shrink:0;}
#alfred-head .ah-title{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:500;letter-spacing:.06em;color:#fff;text-transform:uppercase;}
#alfred-head .ah-title i{color:var(--accent,#fff);font-size:15px;}
#alfred-head .ah-close{background:none;border:none;color:#555;cursor:pointer;font-size:16px;padding:4px;}
#alfred-head .ah-close:hover{color:#aaa;}
#alfred-log{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px;}
#alfred-log::-webkit-scrollbar{width:5px;}
#alfred-log::-webkit-scrollbar-thumb{background:#2a2a2a;border-radius:3px;}
.af-msg{max-width:88%;font-size:12.5px;line-height:1.5;padding:8px 11px;border-radius:11px;white-space:pre-wrap;word-break:break-word;}
.af-msg.user{align-self:flex-end;background:var(--accent-soft,rgba(255,255,255,.08));color:#fff;border-bottom-right-radius:3px;}
.af-msg.bot{align-self:flex-start;background:var(--surf-panel-hi,#141414);color:#ddd;border-bottom-left-radius:3px;}
.af-msg.sys{align-self:center;color:#666;font-size:10.5px;letter-spacing:.03em;background:none;padding:2px 6px;}
.af-msg.err{align-self:flex-start;color:#c1705a;background:rgba(193,112,90,.1);}
.af-action-tag{display:inline-flex;align-items:center;gap:4px;font-size:9.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--accent,#fff);opacity:.7;margin-bottom:4px;}
#alfred-inputrow{display:flex;gap:8px;padding:10px;border-top:0.5px solid var(--surf-line,#222);flex-shrink:0;}
#alfred-input{flex:1;background:var(--surf-panel,#0a0a0a);border:0.5px solid var(--surf-line,#222);border-radius:9px;padding:9px 11px;color:#fff;font-size:12.5px;font-family:'Inter',sans-serif;resize:none;outline:none;}
#alfred-input:focus{border-color:var(--accent,#fff);}
#alfred-send{width:36px;height:36px;flex-shrink:0;border-radius:9px;background:var(--accent,#fff);color:var(--accent-on,#000);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:15px;}
#alfred-send:disabled{opacity:.4;cursor:default;}
#alfred-hint{padding:0 14px 10px;font-size:10px;color:#555;flex-shrink:0;}
body.light #alfred-fab{background:#f3f1ea;}
body.light #alfred-panel{background:#fff;box-shadow:0 20px 60px rgba(0,0,0,.18);}
body.light .af-msg.bot{background:#f0ede4;color:#222;}
body.light #alfred-input{background:#f5f3ec;color:#111;}
@media (max-width:520px){
  #alfred-panel{right:12px;left:12px;width:auto;top:auto;bottom:calc(84px + env(safe-area-inset-bottom));transform:none;max-height:calc(100vh - 160px);}
  #alfred-fab{right:calc(14px + env(safe-area-inset-right));}
}
`;
document.head.appendChild(style);

/* ---------------- markup ---------------- */
const fab=document.createElement('div');
fab.id='alfred-fab';
fab.title='Alfred';
fab.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.6 4.2L18 9l-4.4 1.8L12 15l-1.6-4.2L6 9l4.4-1.8L12 3z"/><path d="M19 14l.8 2.1L22 17l-2.2.9L19 20l-.8-2.1L16 17l2.2-.9L19 14z"/><path d="M5 14l.6 1.6L7.5 16 5.6 16.7 5 18.4l-.6-1.7L2.5 16l1.9-.4L5 14z"/></svg><span class="afb-dot"></span>';

const panel=document.createElement('div');
panel.id='alfred-panel';
panel.innerHTML=`
  <div id="alfred-head">
    <div class="ah-title"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M12 3l1.6 4.2L18 9l-4.4 1.8L12 15l-1.6-4.2L6 9l4.4-1.8L12 3z"/></svg>Alfred</div>
    <button class="ah-close" id="alfred-close" title="Close"><i class="ti ti-x"></i></button>
  </div>
  <div id="alfred-log"></div>
  <div id="alfred-hint">Try: "open sky" · "schedule gym 6 to 7pm" · "start a 25 min timer" · "take a break" · "what's next"</div>
  <div id="alfred-inputrow">
    <textarea id="alfred-input" rows="1" placeholder="Ask Alfred..."></textarea>
    <button id="alfred-send" title="Send"><i class="ti ti-arrow-up"></i></button>
  </div>
`;

document.addEventListener('DOMContentLoaded',mount);
if(document.readyState==='complete'||document.readyState==='interactive')mount();

function mount(){
  if(document.getElementById('alfred-fab'))return;
  document.body.appendChild(fab);
  document.body.appendChild(panel);
  fab.addEventListener('click',togglePanel);
  document.getElementById('alfred-close').addEventListener('click',closePanel);
  document.getElementById('alfred-send').addEventListener('click',send);
  const input=document.getElementById('alfred-input');
  input.addEventListener('keydown',e=>{
    if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}
  });
  input.addEventListener('input',()=>{
    input.style.height='auto';
    input.style.height=Math.min(input.scrollHeight,90)+'px';
  });
  renderLogFromHistory();
  if(!history.length){
    appendMsg('bot',"Evening. I'm Alfred — fully local now, no AI guesswork. I can open a page, manage your schedule, run a timer, log a break, or tell you the time and what's next. Just ask.");
  }
}

function togglePanel(){
  panel.classList.contains('open')?closePanel():openPanel();
}
function openPanel(){
  panel.classList.add('open');
  const input=document.getElementById('alfred-input');
  setTimeout(()=>input.focus(),50);
  scrollLog();
}
function closePanel(){ panel.classList.remove('open'); }

document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&panel.classList.contains('open'))closePanel();
});

/* ---------------- chat log rendering ---------------- */
function scrollLog(){
  const log=document.getElementById('alfred-log');
  log.scrollTop=log.scrollHeight;
}
function appendMsg(kind,text,actionLabel){
  const log=document.getElementById('alfred-log');
  const div=document.createElement('div');
  div.className='af-msg '+kind;
  if(actionLabel){
    const tag=document.createElement('div');
    tag.className='af-action-tag';
    tag.textContent='✓ '+actionLabel;
    div.appendChild(tag);
    const txt=document.createElement('div');
    txt.textContent=text;
    div.appendChild(txt);
  } else {
    div.textContent=text;
  }
  log.appendChild(div);
  scrollLog();
  return div;
}
function renderLogFromHistory(){
  const log=document.getElementById('alfred-log');
  log.innerHTML='';
  history.forEach(m=>{
    if(m.role==='user')appendMsg('user',m.content);
    else if(m.role==='assistant')appendMsg('bot',m.displayText||m.content);
  });
}

/* ---------------- sending ---------------- */
function send(){
  const input=document.getElementById('alfred-input');
  const text=input.value.trim();
  if(!text)return;
  input.value='';
  input.style.height='auto';
  appendMsg('user',text);
  history.push({role:'user',content:text});
  saveHistory();

  // ---- deterministic checks first: no model call, no hallucination risk ----
  const navPage=findNavPage(text);
  if(navPage && typeof window.showPage==='function'){
    window.showPage(navPage);
    const reply='Opening '+navPage+'.';
    appendMsg('bot',reply,'Opened '+navPage);
    history.push({role:'assistant',content:reply,displayText:reply});
    saveHistory();
    return;
  }

  const timerIntent=findTimerIntent(text);
  if(timerIntent){
    const ok=startTimerFromAlfred(timerIntent);
    const reply=ok?('Starting a '+timerIntent.minutes+' minute timer.'):"I can't reach the timer controls from here.";
    appendMsg('bot',reply, ok?'Timer started':null);
    history.push({role:'assistant',content:reply,displayText:reply});
    saveHistory();
    return;
  }

  const schedIntent=findScheduleIntent(text);
  if(schedIntent && schedIntent.needsTime){
    const reply="What time should that be? e.g. \"schedule gym 6 to 7pm\" or \"study at 5pm for an hour\".";
    appendMsg('bot',reply);
    history.push({role:'assistant',content:reply,displayText:reply});
    saveHistory();
    return;
  }
  if(schedIntent){
    const ok=addSessionFromAlfred(schedIntent);
    const reply=ok?(schedIntent.name+', '+schedIntent.start+' to '+schedIntent.end+' — added.'):"I can't reach the schedule from here.";
    appendMsg('bot',reply, ok?'Added to schedule':null);
    history.push({role:'assistant',content:reply,displayText:reply});
    saveHistory();
    return;
  }

  if(TIME_QUERY_RE.test(text)){
    const now=new Date();
    let h=now.getHours(),m=now.getMinutes();const ap=h>=12?'PM':'AM';h=h%12;if(h===0)h=12;
    const reply="It's "+h+':'+pad2(m)+' '+ap+'.';
    appendMsg('bot',reply);
    history.push({role:'assistant',content:reply,displayText:reply});
    saveHistory();
    return;
  }

  if(DATE_QUERY_RE.test(text)){
    const reply='Today is '+new Date().toLocaleDateString(undefined,{weekday:'long',year:'numeric',month:'long',day:'numeric'})+'.';
    appendMsg('bot',reply);
    history.push({role:'assistant',content:reply,displayText:reply});
    saveHistory();
    return;
  }

  const nextQuery=NEXT_QUERY_RE.test(text);
  const schedQuery=findScheduleQuery(text);
  if((nextQuery||schedQuery) && typeof window.sessions!=='undefined'){
    const dateStr=(schedQuery&&schedQuery.day==='tomorrow')?tomorrowDateStr():todayDateStr();
    const isToday=dateStr===todayDateStr();
    let daySessions=window.sessions.filter(s=>(s.date||todayDateStr())===dateStr).sort((a,b)=>toMinutes(a.start)-toMinutes(b.start));
    if(nextQuery && !schedQuery){
      if(isToday) daySessions=daySessions.filter(s=>toMinutes(s.start)>=nowMinutes());
      const next=daySessions[0];
      const reply=next
        ? 'Next up: '+next.name+' at '+fmt12(next.start)+' (until '+fmt12(next.end)+').'
        : (isToday?"Nothing else on the schedule today.":"Nothing scheduled.");
      appendMsg('bot',reply);
      history.push({role:'assistant',content:reply,displayText:reply});
      saveHistory();
      return;
    }
    const label=schedQuery.day==='tomorrow'?'tomorrow':'today';
    const reply=daySessions.length
      ? "Here's "+label+": "+daySessions.map(s=>s.name+' ('+fmt12(s.start)+'\u2013'+fmt12(s.end)+')').join(', ')+'.'
      : "Nothing on the schedule for "+label+" yet.";
    appendMsg('bot',reply);
    history.push({role:'assistant',content:reply,displayText:reply});
    saveHistory();
    return;
  }

  const breakIntent=findBreakIntent(text);
  if(breakIntent){
    const ok=addBreakFromAlfred(breakIntent.minutes);
    const reply=ok?('Logged a '+breakIntent.minutes+' minute break starting now — go stretch.'):"I can't reach the schedule from here.";
    appendMsg('bot',reply, ok?'Break logged':null);
    history.push({role:'assistant',content:reply,displayText:reply});
    saveHistory();
    return;
  }

  if(HELP_RE.test(text)){
    appendMsg('bot',HELP_TEXT);
    history.push({role:'assistant',content:HELP_TEXT,displayText:HELP_TEXT});
    saveHistory();
    return;
  }

  if(GREETING_RE.test(text.trim())){
    const reply="Hello. What can I help you with — your schedule, a timer, or a break?";
    appendMsg('bot',reply);
    history.push({role:'assistant',content:reply,displayText:reply});
    saveHistory();
    return;
  }

  if(THANKS_RE.test(text)){
    const reply="Anytime.";
    appendMsg('bot',reply);
    history.push({role:'assistant',content:reply,displayText:reply});
    saveHistory();
    return;
  }

  // ---- nothing matched: honest fallback, no guessing, no network call ----
  appendMsg('bot',HELP_TEXT);
  history.push({role:'assistant',content:HELP_TEXT,displayText:HELP_TEXT});
  saveHistory();
}

/* ---------------- action execution ---------------- */

function addSessionFromAlfred(p){
  if(typeof window.sessions==='undefined'||typeof window.saveSessions!=='function')return false;
  const name=(p.name||'Session').toString().slice(0,60);
  const validTypes=['study','work','break','exercise','custom'];
  const type=validTypes.includes(p.type)?p.type:'study';
  const date=(typeof window.schedDate!=='undefined'&&window.schedDate)||(window.todayStr&&window.todayStr())||new Date().toISOString().slice(0,10);
  window.sessions.push({name,type,start:p.start,end:p.end,notes:'',date});
  window.saveSessions();
  if(typeof window.renderSessions==='function' && document.getElementById('page-schedule') && document.getElementById('page-schedule').classList.contains('active')){
    window.renderSessions();
  }
  return true;
}

function addBreakFromAlfred(minutes){
  if(typeof window.sessions==='undefined'||typeof window.saveSessions!=='function')return false;
  const now=new Date();
  const start=pad2(now.getHours())+':'+pad2(now.getMinutes());
  const end=addMinutes(start,minutes);
  const date=todayDateStr();
  window.sessions.push({name:'Break',type:'break',start,end,notes:'',date});
  window.saveSessions();
  if(typeof window.renderSessions==='function' && document.getElementById('page-schedule') && document.getElementById('page-schedule').classList.contains('active')){
    window.renderSessions();
  }
  return true;
}

function startTimerFromAlfred(p){
  if(typeof window.setTimer!=='function'||typeof window.toggleTimer!=='function')return false;
  let m=parseInt(p.minutes,10);
  if(!m||m<1)m=25;
  m=Math.max(1,Math.min(180,m));
  if(typeof window.showPage==='function')window.showPage('schedule');
  window.setTimer(m,null);
  const qbs=document.querySelectorAll('.qb');
  qbs.forEach(b=>b.classList.toggle('sel',b.textContent.trim()===m+'m'));
  if(!window.timerRunning)window.toggleTimer();
  return true;
}

function addMinutes(hhmm,mins){
  const [h,m]=hhmm.split(':').map(Number);
  let total=h*60+m+mins;
  total=((total%1440)+1440)%1440;
  const nh=Math.floor(total/60),nm=total%60;
  return String(nh).padStart(2,'0')+':'+String(nm).padStart(2,'0');
}

})();