/* ───────────────────────────────────────────────────────────
   Canopus — shared interest tracker
   Records, per feature: visit count + active time spent.
   Records, per content type: articles visited (Vault), quotes
   read (Sirius), stories opened (Literature).
   Everything lives in localStorage, on-device only.
   ─────────────────────────────────────────────────────────── */
(function(){
  var KEY = 'canopus_interests_v1';
  var FLUSH_MS = 15000;      // periodic autosave while a tab stays open
  var IDLE_MS  = 90000;      // stop counting time after this much inactivity

  function defaults(){
    return { features:{}, content:{articles:[],quotes:[],stories:[]}, firstVisit:Date.now() };
  }
  function load(){
    try{
      var raw = localStorage.getItem(KEY);
      if(!raw) return defaults();
      var d = JSON.parse(raw);
      if(!d || typeof d!=='object') return defaults();
      d.features = d.features || {};
      d.content = d.content || {articles:[],quotes:[],stories:[]};
      d.content.articles = d.content.articles || [];
      d.content.quotes = d.content.quotes || [];
      d.content.stories = d.content.stories || [];
      d.firstVisit = d.firstVisit || Date.now();
      return d;
    }catch(e){ return defaults(); }
  }
  function save(d){ try{ localStorage.setItem(KEY, JSON.stringify(d)); }catch(e){} }
  function ensureFeature(d,f){ if(!d.features[f]) d.features[f]={visits:0,seconds:0,last:0}; return d.features[f]; }

  var lastActivity = Date.now();
  ['mousemove','keydown','scroll','touchstart','click'].forEach(function(ev){
    window.addEventListener(ev, function(){ lastActivity = Date.now(); }, {passive:true});
  });

  var api = {
    visit: function(feature){
      if(!feature) return;
      var d = load();
      var f = ensureFeature(d, feature);
      f.visits++; f.last = Date.now();
      save(d);
    },
    addTime: function(feature, secs){
      if(!feature || !secs || secs<=0) return;
      var d = load();
      var f = ensureFeature(d, feature);
      f.seconds += secs; f.last = Date.now();
      save(d);
    },
    event: function(kind, id, title){
      var d = load();
      var arr = kind==='article' ? d.content.articles : kind==='quote' ? d.content.quotes : kind==='story' ? d.content.stories : null;
      if(!arr) return;
      arr.push({ id: id||'', title: title||id||'', ts: Date.now() });
      if(arr.length>1000) arr.splice(0, arr.length-1000);
      save(d);
    },
    getData: function(){ return load(); },
    clearAll: function(){ save(defaults()); }
  };
  window.CanopusTrack = api;

  /* ── active-time accounting for whichever feature is "current" ──
     Pages set this once (data-track-feature on <body>, or via
     CanopusTrack.setFeature() for single-page views like index.html) */
  var currentFeature = document.body ? document.body.getAttribute('data-track-feature') : null;
  var segStart = null;

  function segIsIdle(){ return (Date.now()-lastActivity) > IDLE_MS; }
  function startSeg(){ if(currentFeature && !document.hidden && !segIsIdle()) segStart = Date.now(); }
  function flushSeg(){
    if(segStart && currentFeature){
      var secs = Math.round((Date.now()-segStart)/1000);
      if(secs>0 && secs<3600) api.addTime(currentFeature, secs);
    }
    segStart = null;
  }

  api.setFeature = function(feature){
    flushSeg();
    currentFeature = feature;
    if(feature) api.visit(feature);
    startSeg();
  };

  if(currentFeature){ api.visit(currentFeature); startSeg(); }

  document.addEventListener('visibilitychange', function(){
    if(document.hidden) flushSeg(); else startSeg();
  });
  window.addEventListener('beforeunload', flushSeg);
  window.addEventListener('pagehide', flushSeg);
  setInterval(function(){
    if(!currentFeature) return;
    if(document.hidden || segIsIdle()){ flushSeg(); return; }
    flushSeg(); startSeg();
  }, FLUSH_MS);

  /* ── PWA service worker registration ──
     Registered here since tracker.js is loaded on every page;
     scope defaults to this file's directory (the site root). */
  if('serviceWorker' in navigator){
    window.addEventListener('load', function(){
      navigator.serviceWorker.register('sw.js').catch(function(){});
    });
  }
})();