import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {runInContext} from 'node:vm';
import * as engine from '../src/singo-engine.js';
import {SHARED_POOL} from '../src/singo-pool.js';

function ui({room=null,uid='becca',online=true}={}) {
  const dom=new JSDOM('<div id="singoStatus"></div><div id="singoContent"></div><div id="modal"></div>',{runScripts:'outside-only',url:'https://example.test'});
  const w=dom.window,alerts=[],commands=[];let value=room,next,fail;
  Object.assign(w,engine,{SHARED_POOL,alert:m=>alerts.push(m),confirm:()=>true});
  w.KaraokeApp={esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),showModal:html=>w.document.getElementById('modal').innerHTML=html,closeModal:()=>w.document.getElementById('modal').innerHTML='',switchScreen:()=>{}};
  w.singoStore=()=>({listen(n,e){next=n;fail=e;return ()=>{};},async send(action,round,session){commands.push({action,round,session});Object.assign(value,engine.appendAction(value,{...action,actor:uid}).data);next(value,true);},async create(data){value={...data,hostUid:uid,sessionId:'session',revision:0,events:{}};next(value,true);}});
  const source=readFileSync('src/singo.js','utf8').replace(/^import .*?;\n/gm,'');runInContext(source,dom.getInternalVMContext());
  w.KaraokeSingo.connect({db:{},pairId:'pair',user:{uid,displayName:'Becca'},peerUid:uid==='becca'?'erica':'becca',peerName:uid==='becca'?'Erica':'Becca'});next(value,online);
  return {w,dom,alerts,commands,emit:(v,f=true)=>{value=v;next(v,f);},fail,html:()=>w.document.getElementById('singoContent').innerHTML,click:selector=>w.document.querySelector(selector).click()};
}
function playing(mode='heat') {let g={hostUid:'becca',guestUid:'erica',names:['Becca','Erica'],mode,seed:123,sessionId:'session',pool:engine.normalizePool(SHARED_POOL),revision:0,events:{}};Object.assign(g,engine.appendAction(g,{actor:'erica',type:'accept'}).data);return g;}
const tick=()=>new Promise(r=>setTimeout(r,0));

test('entry opens shared pool setup without exposing either private library',()=>{
  const c=ui();c.click('[data-singo="setup"]');assert.match(c.w.document.getElementById('singoPool').value,/\|/);assert.equal(c.w.document.getElementById('singoMode').value,'traditional');assert.match(c.w.document.getElementById('modal').textContent,/at least 50/);
});
test('game renders 25 squares, hides uncalled titles, and only exposes host call control',()=>{
  const g=playing(),c=ui({room:g}),e=ui({room:g,uid:'erica'});assert.equal(c.w.document.querySelectorAll('[data-square]').length,25);
  for(const sq of engine.replay(g).cards[0])if(sq.song)assert.ok(!c.html().includes(sq.song.title));
  assert.ok(c.w.document.querySelector('[data-singo="call"]'));assert.equal(e.w.document.querySelector('[data-singo="call"]'),null);
});
test('clicking a called square reveals its song, then confirmed performance earns it',async()=>{
  const g=playing(),state=engine.replay(g),number=state.cards[0][0].number;
  while(!engine.replay(g).calls.includes(number))Object.assign(g,engine.appendAction(g,{type:'call',actor:'becca'}).data);
  const c=ui({room:g});c.click('[data-square="0"]');await tick();assert.match(c.html(),/Ready to sing/);c.click('[data-square="0"]');assert.ok(c.w.document.getElementById('singoConfirmSong'));c.click('#singoConfirmSong');await tick();assert.ok(c.w.document.querySelector('[data-square="0"]').classList.contains('earned'));assert.equal(c.commands.at(-1).session,'session');
});
test('offline and permission errors disable shared actions with an actionable status',()=>{
  const c=ui({room:playing(),online:false});assert.equal(c.w.document.querySelector('[data-singo="call"]').disabled,true);c.fail({code:'permission-denied'});assert.match(c.w.document.getElementById('singoStatus').textContent,/Firebase game rules/);
});
test('sign-out clears the previous game and late snapshots cannot restore it',()=>{
  const g=playing(),c=ui({room:g});c.w.KaraokeSingo.connect(null);c.emit(g);assert.match(c.html(),/Open Backstage/);assert.equal(c.w.document.querySelectorAll('[data-square]').length,0);
});
