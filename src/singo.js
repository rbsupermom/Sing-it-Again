import {SHARED_POOL} from './singo-pool.js';
import {normalizePool,replay,squareState,progress,applyAction} from './singo-engine.js';
import {singoStore} from './singo-store.js';
const app=window.KaraokeApp, esc=app.esc, root=document.getElementById('singoContent');
let connection=null,stop=null,store=null,room=null,state=null,online=false,busy=false,problem='',generation=0;
const label=n=>n===0?'Center':'BINGO'[Math.floor((n-1)/15)]+' '+n;
const modeLabel=mode=>mode==='heat'?'Turn Up the Heat 🔥':'Traditional';
const button=(id,text,cls='primary-btn',disabled=false)=>`<button class="${cls}" data-singo="${id}" ${disabled?'disabled':''}>${text}</button>`;
function modal(title,body) {app.showModal(`<h3>${title}</h3>${body}`);}
function connect(value) {
  const key=value?.pairId+':'+value?.user.uid;
  if(connection?.key===key)return;
  generation++;if(stop)stop();stop=null;connection=value?{...value,key}:null;store=null;room=null;state=null;online=false;problem='';busy=false;
  if(value) {
    store=singoStore(value.db,value.pairId,value.user);const current=generation;
    stop=store.listen((data,fresh)=>{if(current!==generation)return;room=data;state=data?replay(data):null;online=fresh;problem='';render();if(fresh)value.onHistory?.(data);},error=>{
      if(current!==generation)return;online=false;problem=error.code==='permission-denied'?'Singo-Bingo is waiting for its Firebase game rules to be published. Your songs and Backstage are still available.':'Could not connect to the game. Check your connection and reopen the app.';render();
    });
  }
  render();
}
function player(){return state.players.indexOf(connection.user.uid);}
function render() {
  const status=document.getElementById('singoStatus');
  status.textContent=problem||(!connection?'Connect with your partner in Backstage to play.':busy?'Saving your play…':online?'Game connected':'Reconnecting · game actions pause until connected');
  if(!connection){root.innerHTML='<div class="card backstage-card"><p>Singo-Bingo is for you and your invited karaoke partner.</p>'+button('backstage','Open Backstage')+'</div>';return;}
  if(!room){root.innerHTML='<div class="card backstage-card"><h3>Make a little karaoke history</h3><p>Invite '+esc(connection.peerName)+' to a song-filled bingo night. Five performed songs in a line wins!</p>'+button('setup','Create a game','primary-btn full',!online||busy)+'</div>';return;}
  const me=player(),host=connection.user.uid===state.hostUid,locked=!online||busy;
  const names=room.names;
  if(state.status==='invited') {
    root.innerHTML=`<div class="card backstage-card"><div class="singo-eyebrow">${modeLabel(state.mode)} · Round ${state.round}</div><h3>${host?'Your invite is waiting':esc(names[0])+' invited you!'}</h3><p>${host?'Waiting for '+esc(names[1])+' to accept.':'Review the shared song pool, then accept when you’re ready.'}</p><p>The host calls numbers. Reveal your songs and perform them to earn squares, including your pick-your-own center.</p><div class="btn-row">${host?button('end','Cancel invite','ghost-btn',locked):button('accept','Let’s play!','primary-btn',locked)+button('decline','Not now','ghost-btn',locked)}${button('pool','Shared song pool','ghost-btn')}</div></div>`;return;
  }
  const mine=progress(state,me),other=progress(state,1-me),ended=state.status!=='playing';
  let heading=state.status==='won'?(state.winner===connection.user.uid?'SINGO-BINGO! You won! 🎉':esc(names[state.players.indexOf(state.winner)])+' has Singo-Bingo! 🎉'):state.status==='draw'?'No open bingo lines remain':state.status==='ended'?'Round ended':state.status==='declined'?'Invitation declined':'Sing your way to five';
  root.innerHTML=`<div class="card backstage-card"><div class="singo-eyebrow">${modeLabel(state.mode)} · Round ${state.round}</div><h3>${heading}</h3><div class="singo-score"><span>You <strong>${mine.earned}</strong> sung</span><span>${esc(names[1-me])} <strong>${other.earned}</strong> sung</span></div><p class="singo-hint">${state.mode==='heat'?'First to perform claims the song. Blocked squares stay lost for this round.':'Every card has different songs. Only a performance earns a square.'}</p>${!ended?`<div class="singo-call"><span>Latest call</span><strong>${state.calls.length?label(state.calls.at(-1)):'Ready?'}</strong>${host?button('call','Call next number','primary-btn',locked||state.calls.length===75):'<span>Waiting for the host’s next call</span>'}</div>`:''}<details><summary>Called numbers (${state.calls.length}/75)</summary><p>${state.calls.map(label).join(' · ')||'No calls yet'}</p></details></div>
    <div class="singo-letters" aria-hidden="true">${[...'BINGO'].map(l=>`<span>${l}</span>`).join('')}</div>
    <div class="singo-grid" aria-label="Your Singo-Bingo card">${state.cards[me].map((sq,i)=>{
      const st=squareState(state,me,i),called=state.calls.includes(sq.number),title=st==='hidden'?'Mystery song':st==='blocked'?'Song lost':sq.song?sq.song.title:'Pick your own';
      return `<button class="singo-square ${st} ${called?'called':''}" data-square="${i}" aria-label="${esc(label(sq.number)+': '+title+'; '+st)}" ${locked?'disabled':''}><b>${i===12?'★':sq.number}</b><span>${esc(title)}</span><small>${st==='earned'?'✓ Sung':st==='blocked'?'✕ Blocked':i===12?'Sing to earn':st==='hidden'?(called?'Tap to reveal':'Not called'):'Ready to sing'}</small></button>`;
    }).join('')}</div><p class="singo-hint">${mine.possible} possible bingo lines${mine.pending&&!ended?' · A revealed line is waiting to be sung':''}. Tap a square for its song and actions.</p>
    <div class="card backstage-card"><h3>Tonight’s performances</h3>${state.performances.length?'<ol>'+state.performances.map(v=>`<li>${esc(names[v.player])}: ${esc(v.song.title)}</li>`).join('')+'</ol>':'<p>No songs earned yet.</p>'}${state.performances.at(-1)?.player===me&&['playing','won','draw'].includes(state.status)?button('undo','Correct my last performance','ghost-btn',locked):''}</div>
    <div class="btn-row">${button('rules','How to play','ghost-btn')}${host?(ended?button('rematch','Invite another round','purple-btn',locked):button('end','End round','ghost-btn',locked)):''}</div>`;
}
async function act(action,round=state?.round,sessionId=room?.sessionId) {
  if(busy||!online) return;
  busy=true;const current=generation;const target=store;render();
  try{await target.send(action,round,sessionId);if(current===generation)app.closeModal();}
  catch(error){if(current===generation){problem=error.message;alert(error.message);}}
  finally{if(current===generation){busy=false;render();}}
}
function showSetup() {
  const pool=normalizePool(SHARED_POOL);
  modal('Invite a Singo-Bingo game',`<form id="singoSetup"><p>The invite will appear for ${esc(connection.peerName)} in Singo-Bingo.</p><p>Sending starts your karaoke night, or uses the one already underway. Performed songs also appear in Home and History.</p><label for="singoMode">Game mode</label><select id="singoMode"><option value="traditional">Traditional · different songs on every card</option><option value="heat">Turn Up the Heat · race to sing shared songs</option></select><label for="singoPool">Shared song pool · one Title | Artist per line</label><p class="singo-hint">A shared starter list for both players. Edit together before inviting. Traditional needs at least 50 unique songs; Heat needs 26. Titles and cover versions count as the same song.</p><textarea id="singoPool" rows="8" required>${esc(pool.map(s=>s.title+' | '+s.artist).join('\n'))}</textarea><button class="primary-btn full" type="submit">Send game invite</button></form>`);
  document.getElementById('singoSetup').onsubmit=async event=>{
    event.preventDefault();if(busy||!online)return;
    const raw=document.getElementById('singoPool').value.split('\n').filter(l=>l.trim());
    if(raw.some(l=>l.split('|').length!==2)){alert('Use Title | Artist on each line.');return;}
    const pool=raw.map(l=>{const [title,artist]=l.split('|');return {title,artist};});
    if(pool.some(s=>!s.title.trim()||!s.artist.trim())){alert('Every song needs a title and artist.');return;}
    if(pool.length>300){alert('Keep this pool to 300 songs or fewer.');return;}
    const mode=document.getElementById('singoMode').value;
    busy=true;const current=generation;const target=store;event.submitter.disabled=true;render();
    try{await target.create({guestUid:connection.peerUid,names:[connection.user.displayName||'Host',connection.peerName],pool,mode,seed:crypto.getRandomValues(new Uint32Array(1))[0]});if(current===generation)app.closeModal();}
    catch(error){if(current===generation){alert(error.message);event.submitter.disabled=false;}}
    finally{if(current===generation){busy=false;render();}}
  };
}
function showSquare(i) {
  const me=player(),sq=state.cards[me][i],st=squareState(state,me,i),round=state.round,sessionId=room.sessionId;
  if(st==='hidden') {
    if(state.status==='playing'&&state.calls.includes(sq.number))act({type:'reveal',index:i},round,sessionId);
    else modal(label(sq.number),'<p>This song stays hidden until its number is called.</p>');
    return;
  }
  if(st==='blocked'){modal('This square is blocked','<p>Your partner performed this song first. Pick something else to sing tonight. A replacement song cannot restore this square or its bingo lines.</p>');return;}
  modal(i===12?'Pick-your-own center':label(sq.number),`${sq.song?`<h4>${esc(sq.song.title)}</h4><p>${esc(sq.song.artist)}</p>`:'<p>Choose your song, then perform it to earn the center.</p>'}${st==='earned'?'<p>✓ You sang it! This square is earned.</p>':state.status==='playing'?`<p>Choosing or queuing a song does not earn it. Confirm only after you have performed.</p>${sq.song?'<button id="singoConfirmSong" class="primary-btn full">I sang it! 🎤</button>':''}${i===12?'<form id="singoCenter"><label for="centerTitle">Song title</label><input id="centerTitle" required maxlength="120"><label for="centerArtist">Artist</label><input id="centerArtist" required maxlength="120"><button class="ghost-btn full" type="submit">Choose center song</button></form>':''}`:'<p>This round has finished.</p>'}`);
  const confirm=document.getElementById('singoConfirmSong');
  if(confirm)confirm.onclick=()=>{if(window.confirm('Have you finished singing “'+sq.song.title+'”?'))act({type:'sing',index:i},round,sessionId);};
  const form=document.getElementById('singoCenter');
  if(form)form.onsubmit=event=>{event.preventDefault();const action={type:'center',index:12,song:{title:document.getElementById('centerTitle').value,artist:document.getElementById('centerArtist').value}};try{applyAction(state,{...action,actor:connection.user.uid},room);act(action,round,sessionId);}catch(error){alert(error.message);}};
}
function rematch() {
  const round=state.round,sessionId=room.sessionId;
  modal('Invite another round',`<form id="singoRematch"><p>Same-night rematches exclude every song already performed.</p><label for="singoMode">Mode</label><select id="singoMode"><option value="traditional">Traditional</option><option value="heat">Turn Up the Heat 🔥</option></select><label><input id="singoNewNight" type="checkbox"> This is a different karaoke night (reset performed songs)</label><button class="primary-btn full" type="submit">Send round invite</button></form>`);
  document.getElementById('singoRematch').onsubmit=e=>{e.preventDefault();act({type:'round',mode:document.getElementById('singoMode').value,seed:crypto.getRandomValues(new Uint32Array(1))[0],newNight:document.getElementById('singoNewNight').checked},round,sessionId);};
}
root.addEventListener('click',event=>{
  const sq=event.target.closest('[data-square]');if(sq){showSquare(Number(sq.dataset.square));return;}
  const action=event.target.closest('[data-singo]')?.dataset.singo;
  if(action==='backstage')app.switchScreen('backstageScreen');
  if(action==='setup')showSetup();
  if(['accept','decline','call'].includes(action))act({type:action});
  if(action==='end'&&confirm('End this round for both players? Songs already performed stay excluded from same-night rematches.'))act({type:'end'});
  if(action==='undo'&&confirm('Correct your last performance? Any square blocked by that claim will reopen, and bingo will be checked again.'))act({type:'undo'});
  if(action==='rematch')rematch();
  if(action==='pool')modal('Our shared song pool','<p>Song assignments stay hidden until called.</p><ul>'+room.pool.map(s=>`<li>${esc(s.title)} · ${esc(s.artist)}</li>`).join('')+'</ul>');
  if(action==='rules')modal('How to play','<ol><li>The host calls a number. Tap matching squares to reveal songs.</li><li>Perform a song, then tap its square and “I sang it!”</li><li>Choose and perform your own center song. It is never automatically free.</li><li>Five earned squares in a row, column, or diagonal wins.</li></ol><p>Traditional: no shared card songs. Heat: your partner’s performance permanently blocks your matching square. Picking a song does not reserve it. Your center must differ from songs on your own card.</p><p>If both cards lose every bingo line, the round is a draw. Only the singer of the most recent performance can undo it, before another performance is recorded.</p>');
});
window.KaraokeSingo={connect};
render();
