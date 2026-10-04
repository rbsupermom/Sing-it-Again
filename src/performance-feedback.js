import { getApps } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, doc, collection, setDoc, onSnapshot, query, orderBy, limit, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const app = window.KaraokeApp;
const esc = app?.esc || (value => String(value || ''));
let auth, db, user, pairId;
let sharedPerformances = [], stopPerformances = null, feedbackStops = [];
let feedbackByPerformance = new Map(), published = new Set(), originalScheduleSave = null;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const safeId = value => encodeURIComponent(String(value || '')).replaceAll('%2F', '_');
const displayName = () => (user?.displayName || user?.email?.split('@')[0] || 'Singer').slice(0, 80);
const noteRating = rating => '♩'.repeat(Math.max(0, Number(rating) || 0));
const localDate = value => { const d=new Date(value); return Number.isFinite(d.getTime()) ? d.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric',year:'numeric'}) : ''; };
const localTime = value => { const d=new Date(value); return Number.isFinite(d.getTime()) ? d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}) : ''; };
function currentPairId(){ return app?.getState?.().pairId || null; }
function songFor(performance,state){ return state.songs.find(song=>song.id===performance.songId); }
function sourceLabel(performance){ return performance.sourceLabel || (performance.performer==='together'?'Duet':'Karaoke'); }
function shareable(performance){ return performance&&performance.id&&performance.sungAt&&performance.sessionId&&performance.performer!=='companion'; }

async function publishPerformance(performance,state){
  if(!user||!pairId||!shareable(performance)) return;
  const song=songFor(performance,state); if(!song?.title||!song?.artist) return;
  const archiveId=safeId(`${user.uid}__${performance.id}`); if(published.has(archiveId)) return; published.add(archiveId);
  try{ await setDoc(doc(db,'pairs',pairId,'performances',archiveId),{performanceId:String(performance.id).slice(0,300),performerUid:user.uid,performerName:displayName(),title:String(song.title).slice(0,120),artist:String(song.artist).slice(0,120),sungAt:String(performance.sungAt).slice(0,40),sessionId:String(performance.sessionId).slice(0,300),sessionName:String(performance.sessionName||'Karaoke Night').slice(0,120),sourceLabel:String(sourceLabel(performance)).slice(0,40),createdAt:serverTimestamp()}); }
  catch(error){ published.delete(archiveId); if(error?.code!=='permission-denied') console.error('Shared performance archive:',error); }
}
function publishState(state){ if(!state||!user||!pairId)return; for(const performance of state.performances||[]) publishPerformance(performance,state); }
function installSaveBridge(){ if(!window.KaraokeCloud?.scheduleSave||originalScheduleSave)return false; originalScheduleSave=window.KaraokeCloud.scheduleSave; window.KaraokeCloud.scheduleSave=data=>{originalScheduleSave(data);const nextPair=currentPairId();if(nextPair&&nextPair!==pairId)connectPair(nextPair);publishState(data);}; publishState(app.getState());return true; }
function stopFeedbackListeners(){ feedbackStops.forEach(stop=>stop());feedbackStops=[];feedbackByPerformance.clear(); }
function listenFeedback(performanceId){ const ref=collection(db,'pairs',pairId,'performances',performanceId,'feedback'); feedbackStops.push(onSnapshot(ref,snapshot=>{feedbackByPerformance.set(performanceId,snapshot.docs.map(d=>({id:d.id,...d.data()})));renderSharedPerformances();},error=>console.error('Performance feedback:',error))); }
function connectPair(id){
  if(!id||(id===pairId&&stopPerformances))return; if(stopPerformances)stopPerformances(); stopFeedbackListeners(); pairId=id;sharedPerformances=[];published.clear();
  const q=query(collection(db,'pairs',pairId,'performances'),orderBy('sungAt','desc'),limit(100));
  stopPerformances=onSnapshot(q,snapshot=>{sharedPerformances=snapshot.docs.map(d=>({id:d.id,...d.data()}));stopFeedbackListeners();sharedPerformances.forEach(item=>listenFeedback(item.id));renderSharedPerformances();},error=>{console.error('Shared performances:',error);const box=document.getElementById('sharedPerformanceList');if(box)box.innerHTML='<div class="card empty">Shared performances could not load. Check the Firebase rules and reconnect.</div>';}); publishState(app.getState());
}
function feedbackHtml(performance){ const items=feedbackByPerformance.get(performance.id)||[]; if(!items.length)return '<div class="tiny" style="margin-top:8px">No ratings yet.</div>'; return '<div style="margin-top:9px">'+items.map(item=>'<div class="tiny" style="margin-top:6px"><strong>'+esc(item.authorUid===user?.uid?'You':item.authorName)+'</strong> · <span aria-label="'+item.rating+' out of 5" style="font-size:1.35rem;color:#d6ad42">'+noteRating(item.rating)+'</span>'+(item.comment?'<div style="margin-top:2px">“'+esc(item.comment)+'”</div>':'')+'</div>').join('')+'</div>'; }
function renderSharedPerformances(){
  const box=document.getElementById('sharedPerformanceList');if(!box)return;if(!sharedPerformances.length){box.innerHTML='<div class="card empty">No shared performances yet. Songs will appear here after either of you performs.</div>';return;}let lastDate='';
  box.innerHTML=sharedPerformances.map(performance=>{const date=localDate(performance.sungAt),heading=date!==lastDate?'<div class="history-date">'+esc(date)+'</div>':'';lastDate=date;const mine=performance.performerUid===user?.uid;return heading+'<div class="card backstage-card" data-shared-performance="'+esc(performance.id)+'"><div class="backstage-meta">'+esc(mine?'You':performance.performerName)+' · '+esc(localTime(performance.sungAt))+' · '+esc(performance.sessionName)+'</div><h3 style="margin-bottom:2px">'+esc(performance.title)+'</h3><div class="artist">'+esc(performance.artist)+'</div><div class="tag" style="margin-top:7px">'+esc(performance.sourceLabel)+'</div>'+feedbackHtml(performance)+'<button class="ghost-btn full" style="margin-top:10px" data-rate-performance="'+esc(performance.id)+'">'+((feedbackByPerformance.get(performance.id)||[]).some(f=>f.authorUid===user?.uid)?'Edit my rating & note':'Rate & leave a note')+'</button></div>';}).join('');
}
function installPerformanceTab(){
  const tabs=document.querySelector('#backstageRoom .backstage-tabs'),room=document.getElementById('backstageRoom');if(!tabs||!room||document.querySelector('[data-backstage-tab="performances"]'))return;
  const button=document.createElement('button');button.className='ghost-btn';button.dataset.backstageTab='performances';button.textContent='Performances';tabs.appendChild(button);
  const panel=document.createElement('div');panel.className='backstage-tab';panel.id='backstagePerformances';panel.hidden=true;panel.innerHTML='<div class="section-title"><h3>Shared Performance History</h3><span>♩–♩♩♩♩♩</span></div><div id="sharedPerformanceList"></div>';room.appendChild(panel);
  document.getElementById('backstageScreen').addEventListener('click',event=>{const tab=event.target.closest('[data-backstage-tab]');if(!tab)return;const performancePanel=document.getElementById('backstagePerformances');if(tab.dataset.backstageTab==='performances'){event.preventDefault();event.stopImmediatePropagation();for(const name of ['Chat','Challenges','Duets'])document.getElementById('backstage'+name).hidden=true;performancePanel.hidden=false;document.querySelectorAll('[data-backstage-tab]').forEach(b=>{const active=b.dataset.backstageTab==='performances';b.classList.toggle('primary-btn',active);b.classList.toggle('ghost-btn',!active);b.setAttribute('aria-selected',String(active));});renderSharedPerformances();}else performancePanel.hidden=true;},true);
  document.getElementById('backstageScreen').addEventListener('click',event=>{const rate=event.target.closest('[data-rate-performance]');if(rate)openFeedback(rate.dataset.ratePerformance);});
}
function paintRating(rating){
  document.querySelectorAll('[data-note-rating]').forEach(button=>{const active=Number(button.dataset.noteRating)<=rating;button.style.fontSize='2rem';button.style.minWidth='52px';button.style.minHeight='54px';button.style.lineHeight='1';button.style.fontWeight='700';button.style.color=active?'#d6ad42':'';button.style.borderColor=active?'#d6ad42':'';button.style.background=active?'rgba(214,173,66,.16)':'';button.setAttribute('aria-pressed',String(active));});
}
function openFeedback(performanceId){
  const performance=sharedPerformances.find(item=>item.id===performanceId);if(!performance)return;const existing=(feedbackByPerformance.get(performanceId)||[]).find(item=>item.authorUid===user.uid);const selected=Number(existing?.rating||0);
  app.showModal('<h3>Rate this performance</h3><div class="pick-card"><div class="big">'+esc(performance.title)+'</div><div class="artist">'+esc(performance.artist)+'</div><div class="tiny" style="margin-top:5px">'+esc(performance.performerUid===user.uid?'Your performance':performance.performerName+'’s performance')+'</div></div><label>Rating</label><div id="quarterNoteRating" class="btn-row" style="justify-content:flex-start;gap:7px;flex-wrap:nowrap">'+[1,2,3,4,5].map(value=>'<button type="button" class="ghost-btn" data-note-rating="'+value+'" aria-label="'+value+' out of 5">♩</button>').join('')+'</div><div class="tiny" id="ratingReadout" style="margin:7px 0 10px">'+(selected?noteRating(selected)+' · '+selected+'/5':'Choose 1–5 quarter notes')+'</div><label>Comment (optional)</label><textarea id="performanceComment" maxlength="500" placeholder="How did it go?">'+esc(existing?.comment||'')+'</textarea><div class="btn-row"><button class="ghost-btn" id="cancelPerformanceFeedback">Cancel</button><button class="primary-btn" id="savePerformanceFeedback" '+(selected?'':'disabled')+'>Save</button></div>');
  let rating=selected;paintRating(rating);
  document.querySelectorAll('[data-note-rating]').forEach(button=>button.onclick=()=>{rating=Number(button.dataset.noteRating);paintRating(rating);document.getElementById('ratingReadout').textContent=noteRating(rating)+' · '+rating+'/5';document.getElementById('savePerformanceFeedback').disabled=false;});
  document.getElementById('cancelPerformanceFeedback').onclick=app.closeModal;
  document.getElementById('savePerformanceFeedback').onclick=async()=>{if(rating<1||rating>5)return;const comment=document.getElementById('performanceComment').value.trim().slice(0,500);const save=document.getElementById('savePerformanceFeedback');save.disabled=true;save.textContent='Saving…';try{await setDoc(doc(db,'pairs',pairId,'performances',performanceId,'feedback',user.uid),{authorUid:user.uid,authorName:displayName(),rating,comment,updatedAt:serverTimestamp()});app.closeModal();}catch(error){console.error('Save performance feedback:',error);save.disabled=false;save.textContent='Save';alert('Your rating could not be saved ('+(error?.code||'unknown error')+'). Please reconnect and try again.');}};
}
async function boot(){ if(!app)return;installPerformanceTab();for(let i=0;i<80&&!getApps().length;i++)await sleep(100);if(!getApps().length)return;auth=getAuth(getApps()[0]);db=getFirestore(getApps()[0]);for(let i=0;i<80&&!auth.currentUser;i++)await sleep(100);user=auth.currentUser;if(!user)return;for(let i=0;i<80&&!currentPairId();i++)await sleep(100);pairId=currentPairId();if(pairId)connectPair(pairId);for(let i=0;i<80&&!installSaveBridge();i++)await sleep(100); }
boot().catch(error=>console.error('Performance feedback setup:',error));
