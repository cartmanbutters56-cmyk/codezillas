const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const appState = { user: null, isAdmin: false, activeHunt: null, huntArchive: [], guesses: {}, clips: [], schedule: [] };
let currentPage = 'home';
let currentHuntTab = 'live';
let currentAdminTab = 'sched';
let pendingDeleteSlotIdx = null;
let activityLog = [];
let realtimeChannel = null;

// PROVIDER DATABASE
const PROVIDER_DB={
  'Pragmatic Play':{
    exact:['Gates of Olympus','Gates of Olympus 1000','Sweet Bonanza','Sweet Bonanza 1000','Starlight Princess','Starlight Princess 1000','Big Bass Bonanza','Bigger Bass Bonanza','Big Bass Splash','Big Bass Amazon Xtreme','Big Bass Bonanza Megaways','Sugar Rush','Sugar Rush 1000','The Dog House','The Dog House Megaways','Wolf Gold','Wild West Gold','The Hand of Midas','Fruit Party','Fruit Party 2','Gems Bonanza','Fire Strike','Fire Strike 2','Aztec Gems','Chilli Heat','Cleocatra','Pirate Gold','Release the Kraken','Release the Kraken 2','Spaceman','Buffalo King','Buffalo King Megaways','Madame Destiny','Lucky Lightning','Extra Juicy'],
    regex:[/gates\s*of\s*olympus/i,/sweet\s*bonanza/i,/starlight\s*princess/i,/big\s*bass/i,/dog\s*house/i,/wolf\s*gold/i,/sugar\s*rush/i,/fruit\s*party/i,/fire\s*strike/i,/gems\s*bonanza/i,/pragmatic/i,/buffalo\s*king/i,/aztec\s*gems/i,/hand\s*of\s*midas/i,/madame\s*destiny/i,/spaceman/i]
  },
  'Nolimit City':{
    exact:['Mental','Mental 2','San Quentin xWays','Tombstone RIP','Tombstone No Mercy','East Coast vs West Coast','Fire in the Hole xBomb','Fire in the Hole 2','Punk Toilet','Deadwood','Poison Eve','Warrior Graveyard xNudge','Book of Shadows','Dragon Train','Pirots','Pirots 2','Hellcatraz','Wixx'],
    regex:[/nolimit/i,/san\s*quentin/i,/tombstone/i,/punk\s*toilet/i,/fire\s*in\s*the\s*hole/i,/deadwood/i,/warrior\s*graveyard/i,/pirots/i,/xnudge/i,/xways/i,/xbomb/i,/mental\b/i,/hellcatraz/i]
  },
  'Hacksaw Gaming':{
    exact:['Chaos Crew','Chaos Crew 2','Chaos Crew 3','Wanted Dead or a Wild','Stick Em','Nitropolis','Nitropolis 2','Nitropolis 3','Nitropolis 4','Nitropolis 5','Jammin Jars','Jammin Jars 2','Jammin Jars 3','Reactoonz','Reactoonz 2','Dead or Alive 2','Book of 99','Giga Jar','Monster Pop','Piggy Riches','Piggy Riches Megaways','Sakura Fortune','Le Bandit','Le Bandit 2'],
    regex:[/chaos\s*crew/i,/stick\s*em/i,/wanted\s*(dead|or)/i,/hacksaw/i,/nitropolis/i,/jammin\s*jars/i,/reactoonz/i,/le\s*bandit/i,/sakura\s*fortune/i,/piggy\s*riches/i,/dead\s*or\s*alive/i,/giga\s*jar/i]
  }
};
const ALL_SLOTS=[];
Object.keys(PROVIDER_DB).forEach(function(p){PROVIDER_DB[p].exact.forEach(function(s){ALL_SLOTS.push({name:s,provider:p});});});

function normStr(s){return s.toLowerCase().replace(/[^a-z0-9\s]/g,'').replace(/\s+/g,' ').trim();}
function levenshtein(a,b){let m=a.length,n=b.length,dp=[];for(let i=0;i<=m;i++){dp[i]=[i];for(let j=1;j<=n;j++){if(!i)dp[i][j]=j;else dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]:1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);}}return dp[m][n];}
function detectProvider(slotName){
  if(!slotName||!slotName.trim())return{slot:slotName,provider:'Unknown'};
  let norm=normStr(slotName);
  for(let p in PROVIDER_DB){for(let i=0;i<PROVIDER_DB[p].exact.length;i++){if(normStr(PROVIDER_DB[p].exact[i])===norm)return{slot:PROVIDER_DB[p].exact[i],provider:p};}}
  for(let p in PROVIDER_DB){for(let i=0;i<PROVIDER_DB[p].regex.length;i++){if(PROVIDER_DB[p].regex[i].test(slotName))return{slot:slotName,provider:p};}}
  let best=null,bestScore=99;
  ALL_SLOTS.forEach(function(s){let sc=levenshtein(norm,normStr(s.name));if(sc<bestScore){bestScore=sc;best=s;}});
  if(best&&bestScore<=4)return{slot:best.name,provider:best.provider};
  return{slot:slotName,provider:'Other'};
}
function provTagClass(p){if(p==='Pragmatic Play')return'ptag-pp';if(p==='Hacksaw Gaming')return'ptag-hk';if(p==='Nolimit City')return'ptag-nl';return'ptag-ot';}
function onSlotInput(input){
  let val=input.value.trim().toLowerCase();
  let list=document.getElementById('autocomplete-list');
  let provInput=document.getElementById('admin-slot-prov');
  if(val.length<2){list.style.display='none';return;}
  let matches=ALL_SLOTS.filter(function(s){return normStr(s.name).indexOf(val)!==-1;}).slice(0,10);
  let detected=detectProvider(input.value);
  provInput.value=detected.provider;
  if(matches.length===0){list.style.display='none';return;}
  list.innerHTML='';
  matches.forEach(function(s){
    let item=document.createElement('div');item.className='autocomplete-item';
    item.innerHTML='<span>'+escHtml(s.name)+'</span><span style="font-size:.58rem;font-weight:700;padding:3px 8px;border-radius:6px;background:rgba(200,255,0,.07);">'+s.provider+'</span>';
    item.addEventListener('click',function(){input.value=s.name;provInput.value=s.provider;list.style.display='none';});
    list.appendChild(item);
  });
  list.style.display='block';
}
document.addEventListener('click',function(e){let l=document.getElementById('autocomplete-list');if(l)l.style.display='none';});

// STARFIELD
(function(){
  let canvas=document.getElementById('sf'),ctx=canvas.getContext('2d'),stars=[],W,H;
  function resize(){W=canvas.width=window.innerWidth;H=canvas.height=window.innerHeight;}
  resize();window.addEventListener('resize',resize);
  function initStars(){stars=[];let count=Math.floor((W*H)/5500);for(let i=0;i<count;i++){let size=Math.random();let bright=size>0.93,mid=size>0.77&&!bright;let hue=Math.random()>0.5?(0+Math.random()*20):(340+Math.random()*20);stars.push({x:Math.random()*W,y:Math.random()*H,r:bright?(1.4+Math.random()*2):(mid?(0.7+Math.random()*.9):(0.15+Math.random()*.5)),alpha:bright?(0.65+Math.random()*0.35):(mid?(0.3+Math.random()*.4):(0.08+Math.random()*.22)),hue:hue,ts:0.003+Math.random()*.01,to:Math.random()*Math.PI*2,glow:bright});}}
  initStars();window.addEventListener('resize',initStars);
  let t=0;
  function draw(){ctx.fillStyle='#080000';ctx.fillRect(0,0,W,H);t+=0.016;for(let i=0;i<stars.length;i++){let s=stars[i];let tw=0.7+0.3*Math.sin(t*s.ts*60+s.to);let a=s.alpha*tw;ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,Math.PI*2);ctx.fillStyle='hsla('+s.hue+',80%,'+(s.glow?98:75)+'%,'+a+')';ctx.fill();}requestAnimationFrame(draw);}
  draw();
})();

let cx=0,cy=0,rx=0,ry=0;
document.addEventListener('mousemove',function(e){cx=e.clientX;cy=e.clientY;document.getElementById('cur-dot').style.left=cx+'px';document.getElementById('cur-dot').style.top=cy+'px';});
(function anim(){rx+=(cx-rx)*.14;ry+=(cy-ry)*.14;document.getElementById('cur-ring').style.left=rx+'px';document.getElementById('cur-ring').style.top=ry+'px';requestAnimationFrame(anim);})();
function refreshCursor(){document.querySelectorAll('a,button,[onclick]').forEach(function(el){el.addEventListener('mouseenter',function(){document.body.classList.add('ch');});el.addEventListener('mouseleave',function(){document.body.classList.remove('ch');});});}
refreshCursor();

// SUPABASE DATA
async function fetchActiveHunt() {
  let { data, error } = await _supabase
    .from('hunts').select('*').is('ended_at', null)
    .order('id', { ascending: false }).limit(1).single();
  if (error || !data) { appState.activeHunt = null; return; }
  let { data: slots } = await _supabase
    .from('slots').select('*').eq('hunt_id', data.id).order('position', { ascending: true });
  appState.activeHunt = {
    id: data.id, startBal: data.start_bal, endBal: data.end_bal,
    guessesOpen: data.guesses_open, startedAt: data.started_at,
    slots: (slots || []).map(function(s) {
      return { name: s.name, provider: s.provider, bet: s.bet, win: s.win, opened: s.opened, calledBy: s.called_by, dbId: s.id };
    })
  };
  let { data: guesses } = await _supabase.from('guesses').select('*').eq('hunt_id', data.id);
  appState.guesses[data.id] = (guesses || []).map(function(g) {
    return { userId: g.user_id, username: g.username, avatar: g.avatar, amount: g.amount };
  });
}

async function fetchArchive() {
  let { data } = await _supabase
    .from('hunts').select('*').not('ended_at', 'is', null).order('id', { ascending: false });
  if (!data) { appState.huntArchive = []; return; }
  let enriched = await Promise.all(data.map(async function(hunt) {
    let { data: slots } = await _supabase
      .from('slots').select('*').eq('hunt_id', hunt.id).order('position', { ascending: true });
    let { data: guesses } = await _supabase.from('guesses').select('*').eq('hunt_id', hunt.id);
    appState.guesses[hunt.id] = (guesses || []).map(function(g) {
      return { userId: g.user_id, username: g.username, avatar: g.avatar, amount: g.amount };
    });
    return {
      id: hunt.id, startBal: hunt.start_bal, endBal: hunt.end_bal,
      guessesOpen: hunt.guesses_open, startedAt: hunt.started_at, endedAt: hunt.ended_at,
      slots: (slots || []).map(function(s) {
        return { name: s.name, provider: s.provider, bet: s.bet, win: s.win, opened: s.opened, calledBy: s.called_by, dbId: s.id };
      })
    };
  }));
  appState.huntArchive = enriched;
}

async function fetchClips() {
  let { data } = await _supabase
    .from('clips').select('*').order('position', { ascending: true }).order('created_at', { ascending: false });
  appState.clips = data || [];
  renderHomeClips();
}

async function fetchSchedule() {
  let { data } = await _supabase
    .from('schedule').select('*').order('day_of_week', { ascending: true });
  appState.schedule = data || [];
  if (currentPage === 'admin' && currentAdminTab === 'sched') renderAdminSchedule();
}

function renderHomeClips() {
  let active = appState.clips.filter(function(c) { return c.active; });
  let featured = active.find(function(c) { return c.featured; });
  let others = active.filter(function(c) { return !c.featured; });
  let fWrap = document.getElementById('clip-featured-wrap');
  let gWrap = document.getElementById('clip-grid-wrap');
  if (fWrap) {
    if (featured) {
      fWrap.style.display = 'block';
      fWrap.onclick = function() { openClip(featured.video_url, featured.title || 'Featured Clip', featured.kick_link || '#'); };
      fWrap.innerHTML = '<div class="clip-feat-hdr"><span class="clip-badge">Featured Clip</span><a href="https://kick.com/yama/clips" target="_blank" class="kick-link" onclick="event.stopPropagation()">View on Kick →</a></div>'
        + '<div class="clip-thumb"><img src="' + escHtml(featured.thumbnail_url || featured.video_url) + '" alt=""><div class="clip-play"><div class="play-btn"><span class="play-pulse"></span><svg width="26" height="26" viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21"/></svg></div></div><div class="clip-grad"></div></div>';
    } else {
      fWrap.style.display = 'none';
    }
  }
  if (gWrap) {
    if (others.length === 0) { gWrap.innerHTML = ''; return; }
    gWrap.innerHTML = others.map(function(c, i) {
      return '<div class="clip-card reveal" onclick="openClip(\'' + escHtml(c.video_url) + '\',\'' + escHtml(c.title || 'Clip ' + (i+1)) + '\',\'' + escHtml(c.kick_link || '#') + '\')"><div class="clip-thumb" style="aspect-ratio:16/9;"><img src="' + escHtml(c.thumbnail_url || c.video_url) + '" alt=""><div class="clip-play"><div class="play-btn play-btn-sm"><span class="play-pulse"></span><svg width="18" height="18" viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21"/></svg></div></div><div class="clip-grad"></div></div><div class="clip-card-ftr"><span class="clip-num">' + escHtml(c.title || 'CLIP ' + (i+1)) + '</span><a href="https://kick.com/yama/clips" target="_blank" class="kick-link" onclick="event.stopPropagation()">View on Kick →</a></div></div>';
    }).join('');
  }
  refreshCursor();
}

// REALTIME SUBSCRIPTION
function subscribeRealtime() {
  if (realtimeChannel) _supabase.removeChannel(realtimeChannel);
  realtimeChannel = _supabase.channel('hunt-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'hunts' }, function() {
      fetchActiveHunt().then(function() { renderAll(); showSyncBadge(); });
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'slots' }, function() {
      fetchActiveHunt().then(function() { renderAll(); showSyncBadge(); });
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'guesses' }, function() {
      fetchActiveHunt().then(function() { renderAll(); showSyncBadge(); });
    })
    .subscribe(function(status) {
      if (status === 'CHANNEL_ERROR') setTimeout(subscribeRealtime, 3000);
    });
}
function showSyncBadge() {
  let badge = document.getElementById('sync-badge');
  if (!badge) return;
  badge.classList.add('show');
  clearTimeout(window._syncTimer);
  window._syncTimer = setTimeout(function() { badge.classList.remove('show'); }, 1500);
}

// DISCORD OAUTH
function buildAuthURL(){let state=Math.random().toString(36).substring(2);try{sessionStorage.setItem('dsc_state',state);}catch(e){}return'https://discord.com/api/oauth2/authorize?'+new URLSearchParams({client_id:DISCORD_CONFIG.CLIENT_ID,redirect_uri:DISCORD_CONFIG.REDIRECT_URI,response_type:'token',scope:DISCORD_CONFIG.SCOPE,state:state}).toString();}
function startDiscordOAuth(){try{sessionStorage.setItem('pre_oauth_page',currentPage);}catch(e){}document.getElementById('oauth-loading').classList.add('open');window.location.href=buildAuthURL();}
function handleOAuthCallback(){
  let hash=window.location.hash;
  if(!hash||hash.indexOf('access_token')===-1)return;
  document.getElementById('oauth-loading').classList.add('open');
  let params={};hash.substring(1).split('&').forEach(function(p){let kv=p.split('=');params[decodeURIComponent(kv[0])]=decodeURIComponent(kv[1]||'');});
  let savedState='';try{savedState=sessionStorage.getItem('dsc_state')||'';}catch(e){}
  if(params.state&&savedState&&params.state!==savedState){document.getElementById('oauth-loading').classList.remove('open');showToast('❌ OAuth state mismatch.');history.replaceState(null,'',window.location.pathname);return;}
  let token=params.access_token;
  if(!token){document.getElementById('oauth-loading').classList.remove('open');history.replaceState(null,'',window.location.pathname);return;}
  fetch('https://discord.com/api/users/@me',{headers:{'Authorization':'Bearer '+token}})
  .then(function(r){return r.json();})
  .then(function(user){
    let avatarUrl=user.avatar?'https://cdn.discordapp.com/avatars/'+user.id+'/'+user.avatar+'.png?size=64':null;
    let userData={id:user.id,username:user.global_name||user.username,avatar:avatarUrl,token:token};
    try{localStorage.setItem('yama_user',JSON.stringify(userData));}catch(e){}
    appState.user=userData;appState.isAdmin=(user.id===DISCORD_CONFIG.ADMIN_ID);
    history.replaceState(null,'',window.location.pathname);
    try{sessionStorage.removeItem('dsc_state');}catch(e){}
    let prePage='home';try{prePage=sessionStorage.getItem('pre_oauth_page')||'home';sessionStorage.removeItem('pre_oauth_page');}catch(e){}
    document.getElementById('oauth-loading').classList.remove('open');
    showPage(prePage);renderNavUser();renderHuntTabs();renderAll();
    showToast('✓ Signed in as '+userData.username+(appState.isAdmin?' 👑':''));
  })
  .catch(function(){document.getElementById('oauth-loading').classList.remove('open');history.replaceState(null,'',window.location.pathname);showToast('❌ Discord sign-in failed.');});
}
function openDscModal(){document.getElementById('dsc-modal').classList.add('open');document.body.style.overflow='hidden';}
function closeDscModal(){document.getElementById('dsc-modal').classList.remove('open');document.body.style.overflow='';}
function askSignOut(){document.getElementById('confirm-signout').classList.add('open');document.body.style.overflow='hidden';}
function closeConfirmSignout(){document.getElementById('confirm-signout').classList.remove('open');document.body.style.overflow='';}
function confirmedLogout(){appState.user=null;appState.isAdmin=false;try{localStorage.removeItem('yama_user');}catch(e){}closeConfirmSignout();renderNavUser();renderHuntTabs();renderAll();showToast('Signed out.');}
function renderNavUser(){
  let area=document.getElementById('nav-user-area');
  if(appState.user){
    let ava=appState.user.avatar?'<img src="'+appState.user.avatar+'" alt="">':appState.user.username.substring(0,2).toUpperCase();
    area.innerHTML='<div class="user-btn" onclick="askSignOut()"><div class="u-ava">'+ava+'</div><span>'+escHtml(appState.user.username)+'</span>'+(appState.isAdmin?'<span class="admin-pill">👑 ADMIN</span>':'')+'</div>';
  } else {
    area.innerHTML='<button class="login-btn" onclick="openDscModal()">Sign In</button>';
  }
  let adminNav = document.getElementById('nav-admin');
  let adminMob = document.getElementById('mob-admin');
  if (adminNav) adminNav.style.display = appState.isAdmin ? 'inline-flex' : 'none';
  if (adminMob) adminMob.style.display = appState.isAdmin ? 'block' : 'none';
  refreshCursor();
}
function escHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

// INIT
(function init() {
  try { let u=localStorage.getItem('yama_user'); if(u){let ud=JSON.parse(u);appState.user=ud;appState.isAdmin=(ud.id===DISCORD_CONFIG.ADMIN_ID);} } catch(e) {}
  Promise.all([fetchSchedule(), fetchClips()]).then(function() {
    buildScheduleGridFromDB();
  });
  fetchActiveHunt().then(function() {
    handleOAuthCallback();
    renderNavUser();
    renderHuntTabs();
    renderAll();
    subscribeRealtime();
    updateAdminHuntIdField();
  });
})();

// HUNT TABS
function renderHuntTabs(){}
function switchTab(tab){
  currentHuntTab=tab;
  ['live','stats','archive'].forEach(function(t){
    let el=document.getElementById('tab-'+t);if(el)el.className='h-tab'+(tab===t?' active':'');
    let panel=document.getElementById('panel-'+t);if(panel)panel.style.display=tab===t?'block':'none';
  });
  if(tab==='archive')renderArchive();
  if(tab==='stats')renderStatsPanel();
}

function renderAll(){
  renderHuntLive();
  renderGuessPanel();
  renderTop3Live();
  if(currentHuntTab==='archive')renderArchive();
  if(currentHuntTab==='stats')renderStatsPanel();
}

// STATS HELPERS
function calcStats(hunt) {
  let slots = hunt.slots || [];
  let opened = slots.filter(function(s) { return s.opened; });
  let pending = slots.filter(function(s) { return !s.opened; });
  let totalWin = opened.reduce(function(a, s) { return a + (s.win || 0); }, 0);
  let totalBet = slots.reduce(function(a, s) { return a + (s.bet || 0); }, 0);
  let pendingBet = pending.reduce(function(a, s) { return a + (s.bet || 0); }, 0);
  let avgMulti = opened.length > 0 ? opened.reduce(function(a, s) { return a + (s.win && s.bet ? (s.win / s.bet) : 0); }, 0) / opened.length : 0;
  let currentBal = hunt.endBal != null ? hunt.endBal : totalWin;
  let reqMulti = pendingBet > 0 ? Math.max(0, (hunt.startBal - totalWin)) / pendingBet : 0;
  return { opened: opened.length, total: slots.length, totalWin: totalWin, totalBet: totalBet, currentBal: currentBal, avgMulti: avgMulti, reqMulti: reqMulti };
}
function getTop3(slots) {
  return slots.filter(function(s){return s.opened && s.bet && s.win!=null;})
    .map(function(s){return {name:s.name,provider:s.provider,bet:s.bet,win:s.win,multi:s.win/s.bet};})
    .sort(function(a,b){return b.multi-a.multi;}).slice(0,3);
}
function fmt(n){return'$'+parseFloat(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function fmtM(n){return parseFloat(n).toFixed(2)+'x';}
function pad(n){return String(n).padStart(2,'0');}

// TOP 3 LIVE
function renderTop3Live(){
  let wrap=document.getElementById('top3-live-body');if(!wrap)return;
  let hunt=appState.activeHunt;
  if(!hunt||!hunt.slots||hunt.slots.length===0){wrap.innerHTML='<div class="no-top3">No slots opened yet</div>';return;}
  let top3=getTop3(hunt.slots);
  if(top3.length===0){wrap.innerHTML='<div class="no-top3">No bonuses opened yet</div>';return;}
  let medals=['🥇','🥈','🥉'];
  let rankClasses=['r1','r2','r3'];
  let multiColors=['var(--gold)','#c0c0c0','#cd7f32'];
  wrap.innerHTML='';
  top3.forEach(function(s,i){
    let row=document.createElement('div');row.className='top3-row';
    row.innerHTML='<span class="top3-rank '+rankClasses[i]+'">'+medals[i]+'</span>'
      +'<div class="top3-info"><div class="top3-name">'+escHtml(s.name)+'</div><div class="top3-prov">'+escHtml(s.provider)+'</div></div>'
      +'<div style="text-align:right;"><div class="top3-multi" style="color:'+multiColors[i]+'">'+fmtM(s.multi)+'</div><div class="top3-win">'+fmt(s.win)+'</div></div>';
    wrap.appendChild(row);
  });
}

// HUNT LIVE RENDER
function renderHuntLive(){
  let hunt=appState.activeHunt;
  let noHunt=document.getElementById('no-hunt');
  let headerBar=document.getElementById('hunt-header-bar');
  let progressWrap=document.getElementById('h-progress-wrap');
  let liveFeedWrap=document.getElementById('live-feed-wrap');
  let winnerWrap=document.getElementById('winner-banner-wrap');

  if(!hunt){
    if(noHunt)noHunt.style.display='block';
    if(headerBar)headerBar.style.display='none';
    if(progressWrap)progressWrap.style.display='none';
    if(liveFeedWrap)liveFeedWrap.style.display='none';
    if(winnerWrap)winnerWrap.innerHTML='';
    let sub=document.getElementById('no-hunt-sub');
    if(sub)sub.textContent=appState.isAdmin?'Start a hunt from the Admin Control tab.':'Check back during a live stream when a bonus hunt is running!';
    return;
  }
  if(noHunt)noHunt.style.display='none';
  if(headerBar)headerBar.style.display='grid';
  if(progressWrap)progressWrap.style.display='block';
  if(liveFeedWrap)liveFeedWrap.style.display='block';

  let stats=calcStats(hunt);
  document.getElementById('s-id').textContent='#'+hunt.id;
  document.getElementById('s-bonuses').textContent=hunt.slots.length;
  document.getElementById('s-start').textContent=fmt(hunt.startBal);
  document.getElementById('s-current').textContent=fmt(stats.currentBal);
  document.getElementById('s-avg').textContent=fmtM(stats.avgMulti);
  document.getElementById('s-req').textContent=fmtM(stats.reqMulti);

  let pct=hunt.slots.length>0?(stats.opened/hunt.slots.length*100):0;
  let fill=document.getElementById('h-prog-fill');if(fill)fill.style.width=pct+'%';
  let cnt=document.getElementById('h-prog-count');if(cnt)cnt.textContent=stats.opened+' / '+hunt.slots.length;

  if(winnerWrap){
    let guesses=appState.guesses[hunt.id]||[];
    let winner=findWinner(hunt,guesses);
    if(winner&&hunt.endBal!=null){
      winnerWrap.innerHTML='<div class="winner-banner"><span class="winner-banner-trophy">🏆</span><div class="winner-banner-text">Closest guess: <strong>'+escHtml(winner.username)+'</strong> guessed <strong>'+fmt(winner.amount)+'</strong> — final balance was <strong>'+fmt(hunt.endBal)+'</strong></div><span class="winner-banner-amount">Winner!</span></div>';
    }else{winnerWrap.innerHTML='';}
  }

  let body=document.getElementById('live-feed-body');
  if(body){
    body.innerHTML='';
    if(hunt.slots.length===0){
      body.innerHTML='<div class="lft-empty">No slots added yet.</div>';
    }else{
      hunt.slots.forEach(function(slot,i){
        let multi = slot.opened && slot.bet && slot.win ? (slot.win/slot.bet) : null;
        let ptc = provTagClass(slot.provider);
        let row=document.createElement('div');
        row.className='lft-row '+(slot.opened?'opened':'');
        row.style.animationDelay=(i*0.03)+'s';
        row.innerHTML=
          '<div class="lft-num">'+(i+1)+'</div>'
          +'<div>'
            +'<div class="lft-slot-name">'+escHtml(slot.name)+'</div>'
            +(slot.calledBy?'<div class="lft-called">📣 '+escHtml(slot.calledBy)+'</div>':'')
          +'</div>'
          +'<div><span class="prov-tag '+ptc+'">'+escHtml(slot.provider)+'</span></div>'
          +'<div class="lft-bet">'+fmt(slot.bet||0)+'</div>'
          +(slot.opened
            ?'<div class="lft-win has-win">'+fmt(slot.win||0)+'</div>'
            +'<div class="lft-multi">—</div>'
            :'<div class="lft-win pending">Pending</div>'
            +'<div class="lft-multi pending">—</div>'
          );
        if(slot.opened && multi!=null){
          row.querySelector('.lft-multi').textContent=fmtM(multi);
          row.querySelector('.lft-multi').className='lft-multi';
        }
        body.appendChild(row);
      });
    }
  }
  refreshCursor();
}

// DELETE SLOT
function askDeleteSlot(idx,e){
  if(e){e.preventDefault();e.stopPropagation();}
  if(!appState.isAdmin||!appState.activeHunt)return;
  pendingDeleteSlotIdx=idx;
  let slot=appState.activeHunt.slots[idx];
  document.getElementById('delete-slot-name-text').textContent='Remove "'+slot.name+'" from the hunt?';
  document.getElementById('confirm-delete-slot').classList.add('open');
  document.body.style.overflow='hidden';
}
function closeDeleteSlotModal(){document.getElementById('confirm-delete-slot').classList.remove('open');document.body.style.overflow='';pendingDeleteSlotIdx=null;}
async function confirmedDeleteSlot() {
  if(pendingDeleteSlotIdx===null||!appState.activeHunt)return;
  let slot=appState.activeHunt.slots[pendingDeleteSlotIdx];
  await _supabase.from('slots').delete().eq('id',slot.dbId);
  closeDeleteSlotModal();
  showToast('Removed: '+slot.name);
}

// RESET ALL DATA
function openResetModal(){
  if(!appState.isAdmin)return;
  document.getElementById('confirm-reset-data').classList.add('open');
  document.body.style.overflow='hidden';
}
function closeResetModal(){
  document.getElementById('confirm-reset-data').classList.remove('open');
  document.body.style.overflow='';
}
async function confirmedResetAllData() {
  if(!appState.isAdmin)return;
  try {
    await _supabase.from('guesses').delete().gt('id', 0);
    await _supabase.from('slots').delete().gt('id', 0);
    await _supabase.from('hunts').delete().gt('id', 0);
    try { await _supabase.rpc('reset_hunt_sequence'); } catch(e) {}
    appState.activeHunt = null;
    appState.huntArchive = [];
    appState.guesses = {};
    closeResetModal();
    renderAll();
    showToast('✓ All data reset. Next hunt will be #1.');
  } catch(err) {
    closeResetModal();
    showToast('❌ Reset failed: ' + err.message);
  }
}

// ADMIN
function updateAdminHuntIdField(){let f=document.getElementById('admin-hunt-id');if(f)f.value=appState.activeHunt?appState.activeHunt.id:'Auto';}

async function adminStartHunt() {
  let sb=parseFloat(document.getElementById('admin-start-bal').value);
  if(!sb||sb<=0){showToast('Enter a valid starting balance.');return;}
  let {data,error}=await _supabase.from('hunts').insert({start_bal:sb,guesses_open:true,started_at:new Date().toISOString()}).select().single();
  if(error){showToast('Error starting hunt: '+error.message);return;}
  showToast('Hunt #'+data.id+' started! ✓');
}
async function adminEndHunt() {
  if(!appState.activeHunt){showToast('No active hunt.');return;}
  let stats=calcStats(appState.activeHunt);
  await _supabase.from('hunts').update({ended_at:new Date().toISOString(),guesses_open:false,end_bal:stats.currentBal}).eq('id',appState.activeHunt.id);
  showToast('Hunt ended! Final balance: '+fmt(stats.currentBal));
}
async function adminAddSlot() {
  if(!appState.activeHunt){showToast('Start a hunt first.');return;}
  let name=document.getElementById('admin-slot-name').value.trim();
  if(!name){showToast('Enter a slot name.');return;}
  let bet=parseFloat(document.getElementById('admin-slot-bet').value)||5;
  let calledBy=document.getElementById('admin-slot-called-by').value.trim();
  let detected=detectProvider(name);
  let position=appState.activeHunt.slots.length;
  await _supabase.from('slots').insert({
    hunt_id:appState.activeHunt.id,name:detected.slot||name,provider:detected.provider,
    bet:bet,opened:false,position:position,called_by:calledBy||null
  });
  document.getElementById('admin-slot-name').value='';
  document.getElementById('admin-slot-prov').value='';
  document.getElementById('admin-slot-bet').value='';
  document.getElementById('admin-slot-called-by').value='';
  showToast(name+' added ✓');
}
async function adminToggleGuess() {
  if(!appState.activeHunt){showToast('Start a hunt first.');return;}
  let newState=!appState.activeHunt.guessesOpen;
  await _supabase.from('hunts').update({guesses_open:newState}).eq('id',appState.activeHunt.id);
  showToast('Guesses '+(newState?'OPENED ✓':'CLOSED ✕'));
}
async function adminConfirmSlotResult(idx) {
  if(!appState.activeHunt)return;
  let inp=document.getElementById('res-win-'+idx);
  if(!inp||inp.value===''){showToast('Enter a win amount first.');return;}
  let w=parseFloat(inp.value);
  if(isNaN(w)||w<0){showToast('Invalid amount.');return;}
  let slot=appState.activeHunt.slots[idx];
  await _supabase.from('slots').update({win:w,opened:true}).eq('id',slot.dbId);
  showToast(slot.name+' → '+fmt(w)+' ✓');
}
async function adminEditSlotResult(idx) {
  if(!appState.activeHunt)return;
  let slot=appState.activeHunt.slots[idx];
  await _supabase.from('slots').update({win:null,opened:false}).eq('id',slot.dbId);
  showToast(slot.name+' reset.');
}

function renderAdminPanel(){
  if(!appState.isAdmin)return;
  let hasHunt=!!(appState.activeHunt);
  let hasSlots=hasHunt&&appState.activeHunt.slots.length>0;
  let card=document.getElementById('hunt-state-card');
  if(card){
    card.className='hunt-state-card '+(hasHunt?'hunt-state-active':'hunt-state-inactive');
    document.getElementById('hunt-state-label').textContent=hasHunt?'Active Hunt':'No Active Hunt';
    document.getElementById('hunt-state-val').textContent=hasHunt?'Hunt #'+appState.activeHunt.id+' · Live':'Ready to Start';
    document.getElementById('hunt-state-val').style.color=hasHunt?'var(--neon)':'var(--text3)';
  }
  let sf=document.getElementById('start-form-area');if(sf)sf.style.display=hasHunt?'none':'flex';
  let ef=document.getElementById('end-form-area');if(ef)ef.style.display=hasHunt?'flex':'none';
  let ss=document.getElementById('a-slot-sec');if(ss)ss.style.display=hasHunt?'block':'none';
  let rs=document.getElementById('a-res-sec');if(rs)rs.style.display=hasSlots?'block':'none';
  let ar=document.getElementById('admin-actions-row');if(ar)ar.style.display=hasHunt?'flex':'none';
  if(hasHunt){
    let gtb=document.getElementById('guess-toggle-btn');
    if(gtb){
      if(appState.activeHunt.guessesOpen){gtb.className='guess-toggle-btn guess-closed-btn';gtb.textContent='✕ Close Guesses';}
      else{gtb.className='guess-toggle-btn guess-open-btn';gtb.textContent='✓ Open Guesses';}
    }
  }
  if(hasSlots)renderAdminResultsList();
  updateAdminHuntIdField();
}

function renderAdminResultsList(){
  if(!appState.activeHunt||!appState.isAdmin)return;
  let container=document.getElementById('admin-res-list');if(!container)return;
  container.innerHTML='';
  appState.activeHunt.slots.forEach(function(slot,i){
    let row=document.createElement('div');row.className='admin-result-row';
    row.innerHTML=
      '<div class="admin-result-name" title="'+escHtml(slot.name)+'">'+escHtml(slot.name)
        +(slot.calledBy?'<span style="color:var(--text3);font-size:.58rem;font-weight:600;margin-left:5px;">· '+escHtml(slot.calledBy)+'</span>':'')
      +'</div>'
      +'<input class="admin-input" type="number" id="res-win-'+i+'" placeholder="Win $…" step="0.01" value="'+(slot.win!=null?slot.win:'')+'" style="font-size:.8rem;padding:7px 10px;height:34px;"/>'
      +'<div style="font-size:.68rem;font-weight:700;color:'+(slot.opened?'var(--green)':'var(--text3)')+';">'+(slot.opened?fmt(slot.win||0)+' ✓':'Pending')+'</div>'
      +'<button class="arc-btn arc-check'+(slot.opened?' done':'')+'" title="Confirm win" onclick="adminConfirmSlotResult('+i+')">✓</button>'
      +'<button class="arc-btn arc-edit" title="Edit/reset" onclick="adminEditSlotResult('+i+')">✎</button>'
      +'<button class="arc-btn arc-del" title="Remove slot" onclick="askDeleteSlot('+i+',event)">✕</button>';
    container.appendChild(row);
  });
  refreshCursor();
}

// ADMIN DASHBOARD
function switchAdminTab(tab) {
  currentAdminTab = tab;
  ['sched','clips','hunt'].forEach(function(t) {
    let el = document.getElementById('ad-tab-'+t); if (el) el.className = 'ad-tab' + (tab===t ? ' active' : '');
    let panel = document.getElementById('ad-panel-'+t); if (panel) panel.style.display = tab===t ? 'block' : 'none';
  });
  if (tab === 'sched') renderAdminSchedule();
  if (tab === 'clips') renderAdminClips();
  if (tab === 'hunt') renderAdminPanel();
}

function renderAdminSchedule() {
  let container = document.getElementById('admin-sched-list');
  if (!container) return;
  let days = appState.schedule;
  if (days.length === 0) {
    container.innerHTML = '<div style="color:var(--text3);padding:1rem;">No schedule data. Run the SQL migration first.</div>';
    return;
  }
  container.innerHTML = '';
  days.forEach(function(s) {
    let row = document.createElement('div');
    row.className = 'ad-sched-row';
    row.innerHTML = '<div class="ad-sched-day">' + escHtml(s.label) + '</div>'
      + '<label class="ad-toggle"><input type="checkbox" ' + (s.active ? 'checked' : '') + ' data-day="' + s.day_of_week + '" onchange="adminToggleSchedDay(this)"><span class="ad-toggle-slider"></span></label>'
      + '<input class="admin-input ad-time-input" type="text" value="' + escHtml(s.time_text || '10:00 AM') + '" data-day="' + s.day_of_week + '" placeholder="10:00 AM" />'
      + '<input class="admin-input ad-tz-input" type="text" value="' + escHtml(s.timezone || 'ET') + '" data-day="' + s.day_of_week + '" placeholder="ET" style="max-width:80px;" />';
    container.appendChild(row);
  });
}

function adminToggleSchedDay(cb) {
  let day = parseInt(cb.dataset.day);
  let s = appState.schedule.find(function(d) { return d.day_of_week === day; });
  if (s) s.active = cb.checked;
}

function adminSaveSchedule() {
  let timeInputs = document.querySelectorAll('#admin-sched-list .ad-time-input');
  let tzInputs = document.querySelectorAll('#admin-sched-list .ad-tz-input');
  timeInputs.forEach(function(inp) {
    let day = parseInt(inp.dataset.day);
    let s = appState.schedule.find(function(d) { return d.day_of_week === day; });
    if (s) s.time_text = inp.value.trim() || '10:00 AM';
  });
  tzInputs.forEach(function(inp) {
    let day = parseInt(inp.dataset.day);
    let s = appState.schedule.find(function(d) { return d.day_of_week === day; });
    if (s) s.timezone = inp.value.trim() || 'ET';
  });
  Promise.all(appState.schedule.map(function(s) {
    return _supabase.from('schedule').update({
      active: s.active, time_text: s.time_text, timezone: s.timezone
    }).eq('id', s.id);
  })).then(function() {
    let msg = document.getElementById('sched-save-msg');
    if (msg) { msg.style.opacity = '1'; setTimeout(function() { msg.style.opacity = '0'; }, 2000); }
    buildScheduleGridFromDB();
    showToast('Schedule saved!');
  }).catch(function(e) {
    showToast('Error saving schedule: ' + (e.message || e));
  });
}

function renderAdminClips() {
  let container = document.getElementById('admin-clip-list');
  let empty = document.getElementById('admin-clip-empty');
  let count = document.getElementById('ad-clip-count');
  if (!container) return;
  let clips = appState.clips;
  if (count) count.textContent = clips.length;
  if (clips.length === 0) {
    container.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';
  container.innerHTML = '';
  clips.forEach(function(c) {
    let card = document.createElement('div');
    card.className = 'ad-clip-card';
    card.innerHTML = '<div class="ad-clip-thumb"><img src="' + escHtml(c.thumbnail_url || c.video_url) + '" alt="" onerror="this.src=\'\';this.style.display=\'none\'"><div class="ad-clip-thumb-overlay"></div></div>'
      + '<div class="ad-clip-info">'
      + '<div class="ad-clip-title">' + escHtml(c.title || 'Untitled') + '</div>'
      + '</div>'
      + '<div class="ad-clip-actions">'
      + '<label class="ad-toggle-sm"><input type="checkbox" ' + (c.active ? 'checked' : '') + ' onchange="adminToggleClip(' + c.id + ',this.checked)"><span class="ad-toggle-slider"></span></label>'
      + '<span style="font-size:.6rem;color:var(--text3);">Active</span>'
      + '<button class="ad-clip-btn ad-clip-feat' + (c.featured ? ' on' : '') + '" onclick="adminSetFeatured(' + c.id + ')" title="Set as featured">★</button>'
      + '<button class="ad-clip-btn ad-clip-del" onclick="adminDeleteClip(' + c.id + ')" title="Delete">✕</button>'
      + '</div>';
    container.appendChild(card);
  });
}

async function adminUploadClip() {
  let title = document.getElementById('ad-clip-title').value.trim();
  let videoFile = document.getElementById('ad-clip-video').files[0];
  let thumbFile = document.getElementById('ad-clip-thumb').files[0];
  let kickLink = document.getElementById('ad-clip-link').value.trim();
  if (!videoFile) { showToast('Select a video file.'); return; }
  let btn = document.getElementById('ad-upload-btn');
  let prog = document.getElementById('ad-upload-progress');
  if (btn) btn.disabled = true;
  if (prog) { prog.style.display = 'block'; prog.textContent = 'Uploading video...'; }
  try {
    let videoExt = videoFile.name.split('.').pop();
    let videoPath = 'videos/' + Date.now() + '_' + Math.random().toString(36).substring(2,8) + '.' + videoExt;
    let { data: vData, error: vErr } = await _supabase.storage.from('clips').upload(videoPath, videoFile, {
      cacheControl: '3600', upsert: false
    });
    if (vErr) { showToast('Upload failed: ' + vErr.message); throw vErr; }
    let videoUrl = _supabase.storage.from('clips').getPublicUrl(videoPath).data.publicUrl;
    let thumbUrl = '';
    if (thumbFile) {
      if (prog) prog.textContent = 'Uploading thumbnail...';
      let thumbExt = thumbFile.name.split('.').pop();
      let thumbPath = 'thumbs/' + Date.now() + '_' + Math.random().toString(36).substring(2,8) + '.' + thumbExt;
      let { error: tErr } = await _supabase.storage.from('clips').upload(thumbPath, thumbFile, {
        cacheControl: '3600', upsert: false
      });
      if (!tErr) thumbUrl = _supabase.storage.from('clips').getPublicUrl(thumbPath).data.publicUrl;
    }
    if (prog) prog.textContent = 'Saving...';
    let position = appState.clips.length;
    let { error } = await _supabase.from('clips').insert({
      title: title || videoFile.name, video_url: videoUrl,
      thumbnail_url: thumbUrl, kick_link: kickLink || null,
      active: true, featured: false, position: position
    });
    if (error) { showToast('DB error: ' + error.message); throw error; }
    document.getElementById('ad-clip-title').value = '';
    document.getElementById('ad-clip-video').value = '';
    document.getElementById('ad-clip-thumb').value = '';
    document.getElementById('ad-clip-link').value = '';
    document.getElementById('ad-video-name').textContent = '';
    showToast('Clip uploaded!');
    await fetchClips();
    renderAdminClips();
  } catch (e) {
    if (prog) prog.textContent = 'Upload failed.';
  } finally {
    if (btn) btn.disabled = false;
    if (prog) setTimeout(function() { prog.style.display = 'none'; }, 2000);
  }
}

async function adminToggleClip(id, active) {
  await _supabase.from('clips').update({ active: active }).eq('id', id);
  await fetchClips();
  renderAdminClips();
  showToast(active ? 'Clip shown on site' : 'Clip hidden');
}

async function adminSetFeatured(id) {
  let clip = appState.clips.find(function(c) { return c.id === id; });
  if (!clip) return;
  let wasFeatured = clip.featured;
  if (wasFeatured) {
    await _supabase.from('clips').update({ featured: false }).eq('id', id);
  } else {
    await _supabase.from('clips').update({ featured: false }).neq('id', id);
    await _supabase.from('clips').update({ featured: true }).eq('id', id);
  }
  await fetchClips();
  renderAdminClips();
  showToast(wasFeatured ? 'Featured clip removed' : 'Featured clip set!');
}

async function adminDeleteClip(id) {
  if (!confirm('Delete this clip?')) return;
  let clip = appState.clips.find(function(c) { return c.id === id; });
  await _supabase.from('clips').delete().eq('id', id);
  if (clip && clip.video_url && clip.video_url.includes('/storage/v1/object/public/clips/')) {
    let videoPath = clip.video_url.split('/clips/')[1];
    if (videoPath) _supabase.storage.from('clips').remove([videoPath]).catch(function() {});
  }
  if (clip && clip.thumbnail_url && clip.thumbnail_url.includes('/storage/v1/object/public/clips/')) {
    let thumbPath = clip.thumbnail_url.split('/clips/')[1];
    if (thumbPath) _supabase.storage.from('clips').remove([thumbPath]).catch(function() {});
  }
  await fetchClips();
  renderAdminClips();
  showToast('Clip deleted');
}



// GUESS PANEL
function findWinner(hunt,guesses){
  if(!hunt||hunt.endBal==null||!guesses||guesses.length===0)return null;
  return guesses.reduce(function(best,g){return Math.abs(g.amount-hunt.endBal)<Math.abs(best.amount-hunt.endBal)?g:best;},guesses[0]);
}

function renderGuessPanel(){
  let hunt=appState.activeHunt;
  if(!hunt||hunt.endBal==null){
    let lastArchived=appState.huntArchive[0];
    if(lastArchived)hunt=lastArchived;
  }
  let huntId=hunt?hunt.id:null;
  let guessesOpen=!!(appState.activeHunt&&appState.activeHunt.guessesOpen);
  let guesses=huntId&&appState.guesses[huntId]?appState.guesses[huntId]:[];

  let badge=document.getElementById('guess-badge');
  if(badge){badge.className=guessesOpen?'g-open-badge':'g-closed-badge';badge.innerHTML=guessesOpen?'<span class="g-open-dot"></span>Open':'⬤ Closed';}

  let loginPrompt=document.getElementById('guess-login-prompt');
  let formArea=document.getElementById('guess-form');
  if(appState.user){
    if(loginPrompt)loginPrompt.style.display='none';
    if(formArea)formArea.style.display='block';
    let myGuess=guesses.find(function(g){return g.userId===appState.user.id;});
    let sbtn=document.getElementById('guess-submit-btn');
    let mgd=document.getElementById('my-guess-display');
    let mgv=document.getElementById('my-guess-val');
    if(myGuess){
      if(sbtn){sbtn.disabled=true;sbtn.textContent='Submitted';}
      if(mgd)mgd.style.display='block';
      if(mgv)mgv.textContent=fmt(myGuess.amount);
    }else{
      if(sbtn){sbtn.disabled=!guessesOpen;sbtn.textContent=guessesOpen?'Submit':'Closed';}
      if(mgd)mgd.style.display='none';
    }
  }else{
    if(loginPrompt)loginPrompt.style.display='flex';
    if(formArea)formArea.style.display='none';
  }

  let ll=document.getElementById('guess-list-label');
  let gl=document.getElementById('guess-list');
  if(ll)ll.textContent='Community Guesses ('+guesses.length+')';
  if(gl){
    if(guesses.length===0){gl.innerHTML='<div style="text-align:center;padding:1.4rem;color:var(--text3);font-size:.82rem;">No guesses yet — be the first!</div>';}
    else{
      let sorted=[].concat(guesses).sort(function(a,b){return a.amount-b.amount;});
      let winner=findWinner(hunt,sorted);
      gl.innerHTML='';
      sorted.forEach(function(g){
        let isMe=appState.user&&g.userId===appState.user.id;
        let isW=winner&&g.userId===winner.userId;
        let item=document.createElement('div');
        item.className='guess-item'+(isMe?' mine':'')+(isW?' winner':'');
        let ava=g.avatar?'<img src="'+g.avatar+'" alt="">':escHtml(g.username.substring(0,2).toUpperCase());
        item.innerHTML='<div class="guess-user"><div class="guess-ava">'+ava+'</div><span>'+escHtml(g.username)+(isMe?' <span style="color:var(--neon);font-size:.62rem;">(you)</span>':'')+'</span>'+(isW?'<span class="guess-winner-badge">🏆 Closest</span>':'')+'</div><span class="guess-amount">'+fmt(g.amount)+'</span>';
        gl.appendChild(item);
      });
    }
  }
  refreshCursor();
}

async function submitGuess() {
  if(!appState.user){openDscModal();return;}
  if(!appState.activeHunt){showToast('No active hunt.');return;}
  if(!appState.activeHunt.guessesOpen){showToast('Guesses are currently closed.');return;}
  let amt=parseFloat(document.getElementById('guess-input').value);
  if(isNaN(amt)||amt<=0){showToast('Enter a valid positive amount.');return;}
  if(amt>1000000){showToast('Amount too large.');return;}
  let huntId=appState.activeHunt.id;
  let existing=(appState.guesses[huntId]||[]).find(function(g){return g.userId===appState.user.id;});
  if(existing){showToast('You already submitted a guess!');return;}
  await _supabase.from('guesses').insert({
    hunt_id:huntId,user_id:appState.user.id,username:appState.user.username,
    avatar:appState.user.avatar||null,amount:amt,submitted_at:new Date().toISOString()
  });
  document.getElementById('guess-input').value='';
  showToast('Guess of '+fmt(amt)+' submitted! 🎯');
}

// STATS AND WINNERS PANEL
async function renderStatsPanel(){
  await fetchArchive();
  let container = document.getElementById('stats-panel-content');
  if (!container) return;

  let completedHunts = appState.huntArchive.filter(function(h){ return h.endBal != null; });

  if (completedHunts.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:4rem 2rem;color:var(--text3);font-size:.88rem;border:1px dashed rgba(13,48,80,.5);border-radius:16px;"><div style="font-size:2rem;margin-bottom:.75rem;">🎰</div><div style="font-family:\'Rajdhani\',sans-serif;font-size:1.2rem;font-weight:700;text-transform:uppercase;letter-spacing:1px;margin-bottom:.35rem;">No Completed Hunts Yet</div><p>Completed hunt records will appear here after the first hunt ends.</p></div>';
    return;
  }

  container.innerHTML = '';

  completedHunts.forEach(function(hunt, idx) {
    let stats = calcStats(hunt);
    let top3 = getTop3(hunt.slots);
    let guesses = appState.guesses[hunt.id] || [];
    let winner = findWinner(hunt, guesses);
    let profit = hunt.endBal - hunt.startBal;
    let dateStr = hunt.endedAt ? new Date(hunt.endedAt).toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'}) : '–';
    let medals = ['🥇','🥈','🥉'];
    let multiClasses = ['m1','m2','m3'];

    let card = document.createElement('div');
    card.className = 'stats-hunt-card reveal';
    card.dataset.delay = (idx * 80) + ''
    card.style.animationDelay = (idx * 0.06) + 's';
    card.style.animation = 'slideInSlot .4s ease both';

    let headerHtml = '<div class="shc-header">'
      + '<div class="shc-hunt-id"><span style="font-size:.9rem;">🎰</span>Hunt #' + hunt.id + '</div>'
      + '<div class="shc-meta">'
      + (profit >= 0
          ? '<span class="shc-profit-badge win">▲ ' + fmt(Math.abs(profit)) + '</span>'
          : '<span class="shc-profit-badge loss">▼ ' + fmt(Math.abs(profit)) + '</span>')
      + '<span class="shc-date">' + dateStr + '</span>'
      + '</div></div>';

    let balHtml = '<div class="shc-balances">'
      + '<div class="shc-bal-item"><div class="shc-bal-val">' + fmt(hunt.startBal) + '</div><div class="shc-bal-label">Start</div></div>'
      + '<div class="shc-bal-item"><div class="shc-bal-val" style="color:' + (profit >= 0 ? 'var(--green)' : 'var(--red)') + '">' + fmt(hunt.endBal) + '</div><div class="shc-bal-label">Final</div></div>'
      + '<div class="shc-bal-item"><div class="shc-bal-val">' + fmtM(stats.avgMulti) + '</div><div class="shc-bal-label">Avg Multi</div></div>'
      + '<div class="shc-bal-item"><div class="shc-bal-val">' + hunt.slots.length + '</div><div class="shc-bal-label">Bonuses</div></div>'
      + '</div>';

    let top3Html = '';
    if (top3.length > 0) {
      top3Html = top3.map(function(s, i) {
        return '<div class="shc-top3-row">'
          + '<span class="shc-medal">' + medals[i] + '</span>'
          + '<span class="shc-slot-name">' + escHtml(s.name) + '</span>'
          + '<div style="text-align:right;flex-shrink:0;">'
          + '<div class="shc-multi-val ' + multiClasses[i] + '">' + fmtM(s.multi) + '</div>'
          + '<div class="shc-win-small">' + fmt(s.win) + '</div>'
          + '</div></div>';
      }).join('');
    } else {
      top3Html = '<div class="shc-empty-top3">No opened slots recorded</div>';
    }

    let winnerHtml = '';
    if (winner) {
      let diff = Math.abs(winner.amount - hunt.endBal);
      let ava = winner.avatar
        ? '<img src="' + winner.avatar + '" alt="" style="width:100%;height:100%;object-fit:cover;">'
        : escHtml(winner.username.substring(0, 2).toUpperCase());
      winnerHtml = '<div class="shc-winner-block">'
        + '<div class="shc-winner-row">'
        + '<span class="shc-winner-trophy">🏆</span>'
        + '<div style="width:28px;height:28px;border-radius:50%;background:var(--discord);display:flex;align-items:center;justify-content:center;font-size:.62rem;font-weight:800;color:#fff;overflow:hidden;flex-shrink:0;">' + ava + '</div>'
        + '<div class="shc-winner-info">'
        + '<div class="shc-winner-name">' + escHtml(winner.username) + '</div>'
        + '<div class="shc-winner-guess">Guessed ' + fmt(winner.amount) + ' · off by ' + fmt(diff) + '</div>'
        + '</div>'
        + '<div class="shc-winner-badge">Winner</div>'
        + '</div>'
        + '</div>';
    } else if (guesses.length > 0) {
      winnerHtml = '<div class="shc-no-winner"><span>🤔</span><span>' + guesses.length + ' guess' + (guesses.length !== 1 ? 'es' : '') + ' submitted</span></div>';
    } else {
      winnerHtml = '<div class="shc-no-winner"><span>💬</span><span>No guesses were submitted</span></div>';
    }

    card.innerHTML = headerHtml
      + '<div class="shc-body">'
      + '<div class="shc-left">'
      + '<div class="shc-section-label c-gold">🏅 Top 3 Multipliers</div>'
      + top3Html
      + balHtml
      + '</div>'
      + '<div class="shc-right">'
      + '<div class="shc-section-label c-neon">🎯 Guess Winner</div>'
      + winnerHtml
      + (guesses.length > 0 ? '<div style="margin-top:.85rem;">'
        + '<div style="font-size:.57rem;font-weight:800;letter-spacing:2.5px;text-transform:uppercase;color:var(--text3);margin-bottom:.5rem;">All Guesses (' + guesses.length + ')</div>'
        + '<div style="display:flex;flex-direction:column;gap:.3rem;max-height:160px;overflow-y:auto;">'
        + [].concat(guesses).sort(function(a,b){return a.amount-b.amount;}).map(function(g){
            let isW = winner && g.userId === winner.userId;
            let gAva = g.avatar ? '<img src="' + g.avatar + '" alt="" style="width:100%;height:100%;object-fit:cover;">' : escHtml(g.username.substring(0,2).toUpperCase());
            return '<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 8px;background:' + (isW ? 'rgba(255,224,0,.06)' : 'rgba(200,255,0,.02)') + ';border:1px solid ' + (isW ? 'rgba(255,224,0,.25)' : 'rgba(13,48,80,.3)') + ';border-radius:6px;">'
              + '<div style="display:flex;align-items:center;gap:6px;">'
              + '<div style="width:18px;height:18px;border-radius:50%;background:var(--discord);display:flex;align-items:center;justify-content:center;font-size:.5rem;font-weight:800;color:#fff;overflow:hidden;flex-shrink:0;">' + gAva + '</div>'
              + '<span style="font-size:.75rem;font-weight:700;color:var(--text2);">' + escHtml(g.username) + '</span>'
              + (isW ? '<span style="font-size:.55rem;color:var(--gold);">🏆</span>' : '')
              + '</div>'
              + '<span style="font-family:\'Rajdhani\',sans-serif;font-size:.88rem;font-weight:700;color:var(--gold);">' + fmt(g.amount) + '</span>'
              + '</div>';
          }).join('')
        + '</div></div>'
        : '')
      + '</div>'
      + '</div>';

    container.appendChild(card);
  });
  refreshCursor();
}

// ARCHIVE
async function renderArchive(){
  await fetchArchive();
  let grid=document.getElementById('archive-grid');
  let countLabel=document.getElementById('archive-count-label');
  if(!grid)return;
  if(countLabel)countLabel.textContent=appState.huntArchive.length+' hunt'+(appState.huntArchive.length!==1?'s':'');
  if(appState.huntArchive.length===0){grid.innerHTML='<div style="text-align:center;padding:3rem;color:var(--text3);font-size:.88rem;">No archived hunts yet.</div>';return;}
  grid.innerHTML='';
  appState.huntArchive.forEach(function(hunt){
    let stats=calcStats(hunt);
    let profit=hunt.endBal!=null?(hunt.endBal-hunt.startBal):null;
    let dateStr=hunt.endedAt?new Date(hunt.endedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'–';
    let guesses=appState.guesses[hunt.id]||[];
    let winner=findWinner(hunt,guesses);
    let card=document.createElement('div');card.className = 'archive-card reveal';
    card.dataset.delay = (appState.huntArchive.indexOf(hunt) * 80) + '';
    card.innerHTML='<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.9rem;"><span class="archive-hunt-id">Hunt #'+hunt.id+'</span><span class="archive-date">'+dateStr+'</span></div>'
      +'<div class="archive-stats">'
      +'<div><div class="archive-stat-val">'+hunt.slots.length+'</div><div class="archive-stat-label">Bonuses</div></div>'
      +'<div><div class="archive-stat-val">'+fmt(hunt.startBal)+'</div><div class="archive-stat-label">Start Bal</div></div>'
      +'<div><div class="archive-stat-val">'+(hunt.endBal!=null?fmt(hunt.endBal):'—')+'</div><div class="archive-stat-label">End Bal</div></div>'
      +'<div><div class="archive-stat-val">'+fmtM(stats.avgMulti)+'</div><div class="archive-stat-label">Avg Multi</div></div>'
      +'</div>'
      +(profit!=null?'<div style="margin-bottom:.5rem;"><span class="archive-profit '+(profit>=0?'win':'loss')+'">'+(profit>=0?'▲':'▼')+' '+fmt(Math.abs(profit))+(profit>=0?' Profit':' Loss')+'</span></div>':'')
      +(winner?'<div style="font-size:.73rem;color:var(--gold);margin-bottom:.5rem;">🏆 Winner: <strong>'+escHtml(winner.username)+'</strong> ('+fmt(winner.amount)+')</div>':'')
      +'<button style="width:100%;margin-top:.65rem;padding:7px;border-radius:7px;background:rgba(200,255,0,.04);border:1px solid var(--border);color:var(--text3);font-family:\'Exo 2\',sans-serif;font-size:.72rem;font-weight:700;letter-spacing:.5px;text-transform:uppercase;transition:all .2s;" onclick="openArchModal('+hunt.id+')">View Details →</button>';
    grid.appendChild(card);
  });
  refreshCursor();
}

function openArchModal(huntId){
  let hunt=appState.huntArchive.find(function(h){return h.id===huntId;});if(!hunt)return;
  let stats=calcStats(hunt);
  let profit=hunt.endBal!=null?(hunt.endBal-hunt.startBal):null;
  let dateStr=hunt.endedAt?new Date(hunt.endedAt).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}):'–';
  document.getElementById('am-title').textContent='Hunt #'+hunt.id+' · '+dateStr;
  let guesses=appState.guesses[hunt.id]||[];
  let winner=findWinner(hunt,guesses);
  let top3=getTop3(hunt.slots);
  let medals=['🥇','🥈','🥉'];
  let rows=hunt.slots.map(function(s,i){let m=s.opened&&s.bet?(s.win/s.bet):null;return'<tr><td style="color:var(--text3);font-size:.75rem;padding:8px 12px;">'+(i+1)+'</td><td style="font-weight:700;padding:8px 12px;">'+escHtml(s.name)+(s.calledBy?'<span style="color:var(--text3);font-size:.65rem;margin-left:5px;">'+escHtml(s.calledBy)+'</span>':'')+'</td><td style="padding:8px 12px;font-size:.7rem;color:var(--text2);">'+escHtml(s.provider)+'</td><td style="color:var(--text2);padding:8px 12px;">'+fmt(s.bet||0)+'</td><td style="font-family:\'Rajdhani\',sans-serif;font-weight:700;color:'+(s.opened&&s.win>0?'var(--green)':'var(--text3)')+';padding:8px 12px;">'+(s.opened?(s.win!=null?fmt(s.win):'?'):'—')+'</td><td style="font-family:\'Rajdhani\',sans-serif;font-weight:700;color:var(--neon);padding:8px 12px;">'+(m!=null?fmtM(m):'—')+'</td></tr>';}).join('');
  let gRows=guesses.length>0?guesses.sort(function(a,b){return a.amount-b.amount;}).map(function(g){let isW=winner&&g.userId===winner.userId;let ava=g.avatar?'<img src="'+g.avatar+'" alt="">':escHtml(g.username.substring(0,2).toUpperCase());return'<div class="guess-item'+(isW?' winner':'')+'"><div class="guess-user"><div class="guess-ava">'+ava+'</div><span>'+escHtml(g.username)+'</span>'+(isW?'<span class="guess-winner-badge">🏆 Closest</span>':'')+'</div><span class="guess-amount">'+fmt(g.amount)+'</span></div>';}).join(''):'<div style="color:var(--text3);font-size:.83rem;padding:.75rem 0;">No guesses submitted.</div>';
  let top3html=top3.length>0?top3.map(function(s,i){return'<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(13,48,80,.25)"><span style="font-size:1.1rem;">'+medals[i]+'</span><span style="flex:1;font-size:.85rem;font-weight:700;">'+escHtml(s.name)+'</span><span style="font-family:\'Rajdhani\',sans-serif;font-size:1.1rem;font-weight:700;color:var(--neon);">'+fmtM(s.multi)+'</span></div>';}).join(''):'<div style="color:var(--text3);font-size:.82rem;">No opened slots.</div>';
  document.getElementById('am-body').innerHTML='<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:.65rem;margin-bottom:1.25rem;">'
    +'<div class="hunt-stat-card hsc-purple" style="padding:.9rem;"><div class="hsc-icon">🎰</div><div class="hsc-val c-purple">'+hunt.slots.length+'</div><div class="hsc-label">Bonuses</div></div>'
    +'<div class="hunt-stat-card hsc-gold" style="padding:.9rem;"><div class="hsc-icon">💵</div><div class="hsc-val c-gold">'+fmt(hunt.startBal)+'</div><div class="hsc-label">Start Bal</div></div>'
    +'<div class="hunt-stat-card '+(profit!=null&&profit>=0?'hsc-green':'hsc-pink')+'" style="padding:.9rem;"><div class="hsc-icon">📊</div><div class="hsc-val '+(profit!=null&&profit>=0?'c-green':'c-pink')+'">'+fmt(hunt.endBal||0)+'</div><div class="hsc-label">End Bal</div></div>'
    +'<div class="hunt-stat-card hsc-cyan" style="padding:.9rem;"><div class="hsc-icon">✖</div><div class="hsc-val c-cyan">'+fmtM(stats.avgMulti)+'</div><div class="hsc-label">Avg Multi</div></div>'
    +'</div>'
    +(profit!=null?'<div style="margin-bottom:1.1rem;"><span class="archive-profit '+(profit>=0?'win':'loss')+'">'+(profit>=0?'▲ Profit':'▼ Loss')+': '+fmt(Math.abs(profit))+'</span></div>':'')
    +(winner?'<div style="margin-bottom:1rem;font-size:.83rem;color:var(--gold);">🏆 Winner: <strong>'+escHtml(winner.username)+'</strong> guessed '+fmt(winner.amount)+'</div>':'')
    +'<div style="font-size:.58rem;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:var(--text3);margin-bottom:.55rem;">🏅 Top 3 Multipliers</div>'
    +'<div style="margin-bottom:1.1rem;">'+top3html+'</div>'
    +'<div style="font-size:.58rem;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:var(--text3);margin-bottom:.55rem;">Slot Results</div>'
    +'<div style="overflow-x:auto;border:1px solid var(--border);border-radius:10px;margin-bottom:1.1rem;"><table style="width:100%;border-collapse:collapse;"><thead><tr style="background:rgba(7,21,36,.8);"><th style="font-size:.56rem;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:var(--text3);padding:10px 12px;text-align:left;">#</th><th style="font-size:.56rem;text-transform:uppercase;color:var(--text3);padding:10px 12px;text-align:left;letter-spacing:2px;">Slot</th><th style="font-size:.56rem;padding:10px 12px;color:var(--text3);">Provider</th><th style="font-size:.56rem;padding:10px 12px;color:var(--text3);">Bet</th><th style="font-size:.56rem;padding:10px 12px;color:var(--text3);">Win</th><th style="font-size:.56rem;padding:10px 12px;color:var(--text3);">Multi</th></tr></thead><tbody>'+rows+'</tbody></table></div>'
    +'<div style="font-size:.58rem;font-weight:800;letter-spacing:3px;text-transform:uppercase;color:var(--text3);margin-bottom:.55rem;">Community Guesses ('+guesses.length+')</div>'
    +'<div class="guess-list">'+gRows+'</div>';
  document.getElementById('arch-modal').classList.add('open');document.body.style.overflow='hidden';
  refreshCursor();
}
function closeArchModal(e){if(!e||e.target===document.getElementById('arch-modal')||e===undefined){document.getElementById('arch-modal').classList.remove('open');document.body.style.overflow='';}}

// SCHEDULE
const SCHED_DAYS=[
  {day:0,label:'Sunday'},{day:1,label:'Monday'},{day:2,label:'Tuesday'},
  {day:3,label:'Wednesday'},{day:4,label:'Thursday'},{day:5,label:'Friday'},{day:6,label:'Saturday'}
];

function getNYComponents(utcDate) {
  let parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).formatToParts(utcDate);
  let p = {};
  parts.forEach(function(x) { p[x.type] = x.value; });
  return {
    year: parseInt(p.year), month: parseInt(p.month) - 1,
    day: parseInt(p.day), hour: parseInt(p.hour) % 24,
    minute: parseInt(p.minute), second: parseInt(p.second)
  };
}

function buildNYStreamTime(nyYear, nyMonth, nyDay) {
  let probeUTC = new Date(Date.UTC(nyYear, nyMonth, nyDay, 17, 0, 0));
  let probeNY = getNYComponents(probeUTC);
  let probeNYasUTC = new Date(Date.UTC(probeNY.year, probeNY.month, probeNY.day, probeNY.hour, probeNY.minute, probeNY.second));
  let offsetMs = probeUTC.getTime() - probeNYasUTC.getTime();
  let targetNYasUTC = new Date(Date.UTC(nyYear, nyMonth, nyDay, 10, 0, 0));
  return new Date(targetNYasUTC.getTime() + offsetMs);
}

function buildScheduleGridFromDB() {
  let now = new Date();
  let nyNow = getNYComponents(now);
  let nyDateStr = nyNow.year + '-' + String(nyNow.month+1).padStart(2,'0') + '-' + String(nyNow.day).padStart(2,'0');
  let todayDayOfWeek = new Date(nyDateStr + 'T12:00:00').getDay();
  let grid = document.getElementById('sched-grid');
  if (!grid) return;
  grid.innerHTML = '';
  let days = appState.schedule;
  if (days.length === 0) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text3);padding:1rem;">No schedule set.</div>';
    return;
  }
  days.forEach(function(s) {
    let isToday = s.day_of_week === todayDayOfWeek;
    let isActive = s.active;
    let card = document.createElement('div');
    card.className = 'sched-card' + (isToday ? ' today' : '') + (isActive ? '' : ' inactive') + ' reveal';
    card.dataset.delay = s.day_of_week * 60 + '';
    card.innerHTML = '<div class="sched-day">' + s.label + '</div>'
      + '<div class="sched-time' + (isActive ? '' : ' sched-time-off') + '">' + (isActive ? s.time_text + ' ' + s.timezone : 'Off') + '</div>'
      + '<div class="sched-tz">' + (isActive ? 'Eastern Time' : 'No stream') + '</div>'
      + (isToday ? '<div class="sched-today-badge">Today</div>' : '');
    grid.appendChild(card);
  });
}

function getNextStream() {
  let now = new Date();
  let nyNow = getNYComponents(now);
  let days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  let scheduleMap = {};
  appState.schedule.forEach(function(s) { scheduleMap[s.day_of_week] = s; });
  for (let i = 0; i < 8; i++) {
    let candDate = new Date(Date.UTC(nyNow.year, nyNow.month, nyNow.day + i));
    let candNY = getNYComponents(candDate);
    let dayOfWeek = new Date(Date.UTC(candNY.year, candNY.month, candNY.day, 12, 0, 0)).getDay();
    let daySched = scheduleMap[dayOfWeek];
    if (!daySched || !daySched.active) continue;
    let timeParts = (daySched.time_text || '10:00 AM').match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (!timeParts) continue;
    let hour = parseInt(timeParts[1]);
    let min = parseInt(timeParts[2]);
    let isPM = timeParts[3].toUpperCase() === 'PM';
    if (isPM && hour !== 12) hour += 12;
    if (!isPM && hour === 12) hour = 0;
    let streamUTC = buildNYStreamTimeGeneric(candNY.year, candNY.month, candNY.day, hour, min);
    if (streamUTC > now) {
      return { target: streamUTC, label: days[dayOfWeek] + ' ' + daySched.time_text + ' ' + daySched.timezone };
    }
  }
  return { target: null, label: '' };
}

function buildNYStreamTimeGeneric(nyYear, nyMonth, nyDay, targetHour, targetMin) {
  let probeUTC = new Date(Date.UTC(nyYear, nyMonth, nyDay, 17, 0, 0));
  let probeNY = getNYComponents(probeUTC);
  let probeNYasUTC = new Date(Date.UTC(probeNY.year, probeNY.month, probeNY.day, probeNY.hour, probeNY.minute, probeNY.second));
  let offsetMs = probeUTC.getTime() - probeNYasUTC.getTime();
  let targetNYasUTC = new Date(Date.UTC(nyYear, nyMonth, nyDay, targetHour, targetMin, 0));
  return new Date(targetNYasUTC.getTime() + offsetMs);
}

function updateCountdown() {
  let r = getNextStream();
  if (!r.target) {
    document.getElementById('cd-d').textContent = '--';
    document.getElementById('cd-h').textContent = '--';
    document.getElementById('cd-m').textContent = '--';
    document.getElementById('cd-s').textContent = '--';
    document.getElementById('cd-label').innerHTML = 'Next: <span>No upcoming stream</span>';
    return;
  }
  let diff = r.target - new Date();
  if (diff <= 0) { setTimeout(updateCountdown, 1000); return; }
  document.getElementById('cd-d').textContent = pad(Math.floor(diff / 86400000));
  document.getElementById('cd-h').textContent = pad(Math.floor(diff % 86400000 / 3600000));
  document.getElementById('cd-m').textContent = pad(Math.floor(diff % 3600000 / 60000));
  document.getElementById('cd-s').textContent = pad(Math.floor(diff % 60000 / 1000));
  document.getElementById('cd-label').innerHTML = 'Next: <span>' + r.label + '</span>';
}
updateCountdown();
setInterval(updateCountdown, 1000);

// KICK STATUS
function applyKickState(live, viewers) {
  document.getElementById('hero-checking').style.display = 'none';
  let pill = document.getElementById('hero-pill');
  pill.style.display = 'inline-flex';
  pill.textContent = live ? 'LIVE' : 'OFFLINE';
  pill.style.background = live ? 'rgba(57,255,20,.1)' : 'rgba(13,48,80,.3)';
  pill.style.border = live ? '1px solid rgba(57,255,20,.3)' : '1px solid rgba(13,48,80,.5)';
  pill.style.color = live ? 'var(--green)' : 'var(--text3)';
  document.getElementById('hero-live').style.display = live ? 'block' : 'none';
  document.getElementById('hero-offline').style.display = live ? 'none' : 'flex';
  document.getElementById('hero-viewers').style.display = live ? 'flex' : 'none';
  if (live && viewers) document.getElementById('viewer-count').textContent = viewers.toLocaleString() + ' viewers';
  document.getElementById('kf-dot').className = live ? 'kf-live' : 'kf-off';
  document.getElementById('kf-status').textContent = live ? 'LIVE' : 'Offline';
  document.getElementById('kf-status').className = live ? 'kf-status' : 'kf-status offline';
}
function checkKickStatus() {
  let KICK_API = 'https://kick.com/api/v1/channels/yama';
  let proxies = [
    'https://corsproxy.io/?url=' + encodeURIComponent(KICK_API),
    'https://api.allorigins.win/get?url=' + encodeURIComponent(KICK_API),
    'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(KICK_API)
  ];
  function tryProxy(idx) {
    if (idx >= proxies.length) { applyKickState(false, 0); return; }
    fetch(proxies[idx], { headers: { 'Accept': 'application/json' } })
      .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function(raw) {
        let data = (raw && raw.contents) ? JSON.parse(raw.contents) : raw;
        let live = !!(data && data.livestream);
        let viewers = live ? (data.livestream.viewer_count || 0) : 0;
        applyKickState(live, viewers);
      })
      .catch(function() { tryProxy(idx + 1); });
  }
  tryProxy(0);
}
checkKickStatus();
setInterval(checkKickStatus, 60000);

// CLIP MODAL
function openClip(f,t,k){let v=document.getElementById('clip-m-video');document.getElementById('clip-m-title').textContent=t;document.getElementById('clip-m-kick-link').href=k;v.src=f;v.play();document.getElementById('clip-modal').classList.add('open');document.body.style.overflow='hidden';}
function closeClipModal(e){if(e.target===document.getElementById('clip-modal'))closeClipModalDirect();}
function closeClipModalDirect(){let v=document.getElementById('clip-m-video');document.getElementById('clip-modal').classList.remove('open');v.pause();v.src='';document.body.style.overflow='';}
document.addEventListener('keydown',function(e){if(e.key==='Escape'){closeClipModalDirect();closeDscModal();closeArchModal();closeConfirmSignout();closeDeleteSlotModal();closeResetModal();}});
document.addEventListener('change',function(e){
  if (e.target && e.target.id === 'ad-clip-video') {
    let nameEl = document.getElementById('ad-video-name');
    if (nameEl && e.target.files[0]) nameEl.textContent = e.target.files[0].name;
  }
});

// NAV AND PAGES
function showPage(name){
  if (name === 'admin' && !appState.isAdmin) { showToast('Access denied.'); return; }
  currentPage=name;
  document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active');});
  document.querySelectorAll('.nav-links a').forEach(function(a){a.classList.remove('active');});
  document.querySelectorAll('.mob-menu a').forEach(function(a){a.classList.remove('active');});
  let page=document.getElementById('page-'+name);if(page)page.classList.add('active');
  let nav=document.getElementById('nav-'+name);if(nav)nav.classList.add('active');
  let mob=document.getElementById('mob-'+name);if(mob)mob.classList.add('active');
  window.scrollTo({top:0,behavior:'smooth'});
  if (name === 'admin') { switchAdminTab(currentAdminTab); }
}

function showToast(msg){let t=document.getElementById('toast');document.getElementById('toast-msg').textContent=msg;t.classList.add('show');setTimeout(function(){t.classList.remove('show');},2600);}
function toggleFaq(el){el.parentElement.classList.toggle('open');}
function toggleMob(){document.getElementById('mob-menu').classList.toggle('open');document.getElementById('hamburger').classList.toggle('open');}
function closeMob(){document.getElementById('mob-menu').classList.remove('open');document.getElementById('hamburger').classList.remove('open');}
function copyCodeBig(code){navigator.clipboard.writeText(code).then(function(){let btn=document.getElementById('big-copy-btn');if(btn){btn.textContent='✓ Copied!';btn.style.background='var(--neon)';btn.style.color='#000';setTimeout(function(){btn.textContent='Copy Code';btn.style.background='';btn.style.color='';},2000);}showToast('Code '+code+' copied!');}).catch(function(){showToast('Copy manually: '+code);});}

let _lastScrollY=0;
window.addEventListener('scroll',function(){
  let cur=window.scrollY;
  let nav=document.querySelector('nav');
  let mob=document.getElementById('mob-menu');
  if(cur>_lastScrollY&&cur>80){
    nav.classList.add('nav-hidden');
    if(mob)mob.classList.add('nav-hidden-mob');
  }else{
    nav.classList.remove('nav-hidden');
    if(mob)mob.classList.remove('nav-hidden-mob');
  }
  _lastScrollY=cur;
},{passive:true});
(function(){
  let ls = document.getElementById('loading-screen');
  let lb = document.getElementById('load-bar');
  setTimeout(function(){ lb.style.width = '100%'; }, 50);
  setTimeout(function(){
    ls.style.opacity = '0';
    setTimeout(function(){ ls.style.display = 'none'; }, 600);
  }, 2000);
})();
// SCROLL REVEAL
(function initReveal() {
  let observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      let el = entry.target;
      if (entry.isIntersecting) {
        let delay = el.dataset.delay || 0;
        setTimeout(function() {
          el.classList.add('visible');
        }, delay);
      } else {
        el.classList.remove('visible');
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

  function observeAll() {
    document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-scale')
      .forEach(function(el) {
        observer.observe(el);
      });
  }

  observeAll();

  let mutationObserver = new MutationObserver(function() {
    observeAll();
  });
  mutationObserver.observe(document.body, { childList: true, subtree: true });
})();