/* ── Canopus global VHS tape theme controller ──
   Shared by every page. Reads/writes the same key the terminal's
   `theme` command uses, so switching themes anywhere (or in another
   tab) keeps the whole app in sync. */
(function(){
  var KEY='canopus_term_theme';
  var clockTimer=null;

  function getTheme(){
    try{ return localStorage.getItem(KEY)||'modern'; }catch(e){ return 'modern'; }
  }

  function formatTimestamp(){
    var now=new Date();
    var h=now.getHours();
    var ampm=h>=12?'PM':'AM';
    var h12=h%12; if(h12===0)h12=12;
    var m=String(now.getMinutes()).padStart(2,'0');
    var months=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    var dateLine=months[now.getMonth()]+'. '+now.getDate()+' '+now.getFullYear();
    return [ampm+' '+h12+':'+m, dateLine];
  }

  function updateClock(){
    var el=document.querySelector('#vhs-global-overlay .vhs-timestamp');
    if(!el)return;
    var lines=formatTimestamp();
    el.innerHTML=lines[0]+'<br>'+lines[1];
  }

  function applyGlobalVHS(on){
    document.documentElement.classList.toggle('vhs-mode',on);
    var overlay=document.getElementById('vhs-global-overlay');
    if(on){
      if(!overlay){
        overlay=document.createElement('div');
        overlay.id='vhs-global-overlay';
        overlay.innerHTML=
          '<div class="vhs-noise"></div>'+
          '<div class="vhs-scanlines"></div>'+
          '<div class="vhs-tracking"></div>'+
          '<div class="vhs-vignette"></div>'+
          '<div class="vhs-timestamp"></div>'+
          '<div class="vhs-rec"><span class="vhs-rec-dot"></span>REC</div>';
        (document.body||document.documentElement).appendChild(overlay);
      }
      updateClock();
      if(!clockTimer)clockTimer=setInterval(updateClock,15000);
    } else if(overlay){
      overlay.remove();
      if(clockTimer){clearInterval(clockTimer);clockTimer=null;}
    }
  }

  // Apply as soon as this script runs (as early in <body> as possible).
  applyGlobalVHS(getTheme()==='vhs');

  // Keep in sync if the theme is changed from another open tab/page.
  window.addEventListener('storage',function(e){
    if(e.key===KEY) applyGlobalVHS(e.newValue==='vhs');
  });

  // Exposed so the terminal's `theme` command can flip this instantly
  // on the current page without a reload.
  window.canopusApplyGlobalVHS=applyGlobalVHS;
})();