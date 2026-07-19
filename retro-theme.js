/* ── Canopus global retro CRT theme controller ──
   Shared by every page. Reads/writes the same key the terminal's
   `theme` command uses, so switching themes anywhere (or in another
   tab) keeps the whole app in sync.

   Also controls the phosphor COLOUR (green / amber) for the retro
   theme, stored separately under 'canopus_retro_phosphor' so the
   colour choice persists independently of which theme is active. */
(function(){
  var KEY='canopus_term_theme';
  var PHOS_KEY='canopus_retro_phosphor';

  function getTheme(){
    try{ return localStorage.getItem(KEY)||'modern'; }catch(e){ return 'modern'; }
  }

  function getPhosphor(){
    try{ var p=localStorage.getItem(PHOS_KEY); return (p==='amber'||p==='blue')?p:'green'; }catch(e){ return 'green'; }
  }

  function applyPhosphor(color){
    var c=(color==='amber'||color==='blue')?color:'green';
    document.documentElement.setAttribute('data-phosphor',c);
  }

  function applyGlobalRetro(on){
    document.documentElement.classList.toggle('crt-retro',on);
    var overlay=document.getElementById('crt-global-overlay');
    if(on){
      if(!overlay){
        overlay=document.createElement('div');
        overlay.id='crt-global-overlay';
        overlay.innerHTML='<div class="crt-global-scanlines"></div><div class="crt-global-vignette"></div>';
        (document.body||document.documentElement).appendChild(overlay);
      }
    } else if(overlay){
      overlay.remove();
    }
  }

  // Apply as soon as this script runs (as early in <body> as possible).
  applyPhosphor(getPhosphor());
  applyGlobalRetro(getTheme()==='retro');

  // Keep in sync if the theme or phosphor colour is changed from another open tab/page.
  window.addEventListener('storage',function(e){
    if(e.key===KEY) applyGlobalRetro(e.newValue==='retro');
    if(e.key===PHOS_KEY) applyPhosphor(e.newValue);
  });

  // Exposed so the terminal's `theme` command can flip this instantly
  // on the current page without a reload.
  window.canopusApplyGlobalRetro=applyGlobalRetro;

  // Exposed so the terminal (`theme retro amber`) and the nav colour
  // picker's swatches can change the phosphor colour instantly, without
  // a reload, and have it persist for every other Canopus page.
  window.canopusSetPhosphor=function(color){
    var c=(color==='amber'||color==='blue')?color:'green';
    try{ localStorage.setItem(PHOS_KEY,c); }catch(e){}
    applyPhosphor(c);
  };
  window.canopusGetPhosphor=getPhosphor;
})();
