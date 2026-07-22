/* ── Canopus global harsh UI mode controller ──
   Shared by every page that also carries the retro CRT theme. Reads/
   writes 'canopus_harsh_ui' in localStorage, so toggling it anywhere
   (or in another tab) keeps the whole app in sync — mirrors exactly
   how retro-theme.js handles 'canopus_term_theme'. */
(function(){
  var KEY='canopus_harsh_ui';

  function isOn(){
    try{ return localStorage.getItem(KEY)==='1'; }catch(e){ return false; }
  }

  function apply(on){
    document.documentElement.classList.toggle('harsh-ui',!!on);
  }

  // Apply as soon as this script runs (as early in <body> as possible).
  apply(isOn());

  // Keep in sync if harsh mode is toggled from another open tab/page.
  window.addEventListener('storage',function(e){
    if(e.key===KEY) apply(e.newValue==='1');
  });

  // Exposed so the terminal's `harsh` command can flip this instantly
  // on the current page without a reload, and so index.html can check
  // canopusGetHarsh() on load to decide whether the Terminal should be
  // the landing screen instead of Focus.
  window.canopusApplyHarsh=apply;
  window.canopusGetHarsh=isOn;
  window.canopusSetHarsh=function(on){
    try{ localStorage.setItem(KEY, on?'1':'0'); }catch(e){}
    apply(on);
  };
})();