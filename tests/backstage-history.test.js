import {test} from 'node:test';
import assert from 'node:assert/strict';
import {entryHistory, singoHistory, reconcileHistory} from '../src/backstage-history.js';
import {appendAction, normalizePool} from '../src/singo-engine.js';
import {SHARED_POOL} from '../src/singo-pool.js';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';

const now = '2026-09-26T20:00:00.000Z';
const earlier = '2026-09-25T20:00:00.000Z';
const empty = () => ({songs: [], performances: [], sessions: [], activeSessionId: null, queue: []});
const entry = (values = {}) => ({id:'one',senderUid:'becca',recipientUid:'erica',title:'Shallow',artist:'Lady Gaga',
  status:'sung',createdAt:earlier,completedAt:now,...values});
const history = (kind, uid, items=[entry()]) => entryHistory(kind,'pair',items,uid);
function game() {return {sessionId:'night1',hostUid:'becca',guestUid:'erica',names:['Becca','Erica'],
  createdAt:now,mode:'heat',seed:123,pool:normalizePool(SHARED_POOL),revision:0,events:{}};}
function command(g,type,actor='becca',extra={}) {
  Object.assign(g,appendAction(g,{type,actor,at:now,...extra}).data);
}
function center(g,actor,title) {
  command(g,'center',actor,{index:12,song:{title,artist:'Test artist'}});
  command(g,'sing',actor,{index:12});
}

test('challenge completion belongs only to its singer; repeated delivery is idempotent',()=>{
  const batch=history('challenge','erica');
  const data=reconcileHistory(empty(),[batch],now);
  assert.equal(data.performances.length,1);
  assert.equal(data.songs[0].count,1);
  assert.equal(data.songs[0].lastSung,now);
  assert.equal(data.performances[0].sungAt,now);
  assert.equal(data.performances[0].timeEstimated,false);
  assert.equal(data.activeSessionId,data.sessions[0].id);
  assert.equal(reconcileHistory(data,[batch],now),data);
  assert.equal(reconcileHistory(empty(),[history('challenge','becca')],now).performances.length,0);
});
test('a duet is one Together performance in each account even when the other partner confirms',()=>{
  for(const uid of ['becca','erica']) {
    const data=reconcileHistory(empty(),[history('duet',uid)],now);
    assert.equal(data.performances.length,1);
    assert.equal(data.performances[0].performer,'together');
    assert.equal(data.songs[0].ourJam,true);
  }
  assert.equal(history('duet','outsider').performances.length,0);
});
test('existing active night, song preferences, imported totals and theme survive linking',()=>{
  const data=empty();
  data.sessions.push({id:'manual-night',name:'Outpost with Erica',startedAt:now,endedAt:null,theme:'Power Ballads'});
  data.activeSessionId='manual-night';
  data.songs.push({id:'mine',title:'SHALLOW',artist:'Lady Gaga',favorite:true,count:7,lastSung:earlier});
  data.queue=['mine','another'];
  const next=reconcileHistory(data,[history('duet','becca')],now);
  assert.equal(next.sessions.length,1);
  assert.equal(next.performances[0].sessionId,'manual-night');
  assert.equal(next.performances[0].sessionTheme,'Power Ballads');
  assert.equal(next.songs[0].count,8);
  assert.equal(next.songs[0].favorite,true);
  assert.deepEqual(next.queue,['another']);
});
test('Singo host starts a night on invite; guest starts on acceptance, not merely receiving it',()=>{
  const g=game();
  let host=reconcileHistory(empty(),[singoHistory('pair',g,'becca')],now);
  let guest=reconcileHistory(empty(),[singoHistory('pair',g,'erica')],now);
  assert.ok(host.activeSessionId);
  assert.equal(guest.activeSessionId,null);
  assert.equal(host.performances.length,0);
  command(g,'accept','erica');
  guest=reconcileHistory(guest,[singoHistory('pair',g,'erica')],now);
  assert.ok(guest.activeSessionId);
  host.sessions[0].endedAt=now;host.activeSessionId=null;
  host=reconcileHistory(host,[singoHistory('pair',g,'becca')],now);
  assert.equal(host.activeSessionId,null,'background snapshots do not reopen a manually ended show');
});
test('Singo reveal does not log a performance; undo removes only the corrected singer record',()=>{
  const g=game();command(g,'accept','erica');
  command(g,'center','becca',{index:12,song:{title:'My center',artist:'Artist'}});
  let data=reconcileHistory(empty(),[singoHistory('pair',g,'becca')],now);
  assert.equal(data.performances.length,0);
  command(g,'sing','becca',{index:12});
  data=reconcileHistory(data,[singoHistory('pair',g,'becca')],now);
  assert.equal(data.performances.length,1);assert.equal(data.songs[0].count,1);
  assert.equal(singoHistory('pair',g,'erica').performances.length,0);
  command(g,'undo');
  data=reconcileHistory(data,[singoHistory('pair',g,'becca')],now);
  assert.equal(data.performances.length,0);assert.equal(data.songs[0].count,0);assert.equal(data.songs[0].lastSung,null);
  command(g,'sing','becca',{index:12});
  data=reconcileHistory(data,[singoHistory('pair',g,'becca')],now);
  assert.equal(data.performances.length,1);assert.equal(data.songs[0].count,1);
});
test('rematches and archived rooms retain earlier performances with stable source IDs',()=>{
  const g=game();command(g,'accept','erica');center(g,'becca','First song');
  let data=reconcileHistory(empty(),[singoHistory('pair',g,'becca')],now);
  const sessionId=data.activeSessionId;
  command(g,'end');command(g,'round','becca',{mode:'heat',seed:321,newNight:false});
  command(g,'accept','erica');center(g,'becca','Second song');
  data=reconcileHistory(data,[singoHistory('pair',g,'becca')],now);
  assert.equal(data.performances.length,2);assert.equal(data.sessions.length,1);
  const fresh={...game(),sessionId:'night2',createdAt:'2026-09-26T22:00:00.000Z'};
  data=reconcileHistory(data,[singoHistory('pair',g,'becca',true),singoHistory('pair',fresh,'becca')],now);
  assert.equal(data.performances.length,2);
  assert.equal(data.sessions.length,2,'an explicitly different game night gets a new session');
  assert.notEqual(data.activeSessionId,sessionId);
});
test('legacy completions are recovered with estimated time without starting a historical night',()=>{
  const batch=history('duet','becca',[entry({completedAt:undefined})]);
  let data=reconcileHistory(empty(),[batch],now);
  assert.equal(data.performances[0].sungAt,earlier);
  assert.equal(data.performances[0].timeEstimated,true);
  assert.equal(data.activeSessionId,null);
  assert.equal(reconcileHistory(data,[batch],now),data);
});
test('all completed entries are backfilled beyond the chat display limit; other sources are retained',()=>{
  const items=Array.from({length:100},(_,i)=>entry({id:String(i)}));
  let data=reconcileHistory(empty(),[history('duet','becca',items)],now);
  assert.equal(data.performances.length,100);assert.equal(data.songs[0].count,100);
  data=reconcileHistory(data,[history('challenge','becca')],now);
  assert.equal(data.performances.length,100);
});
test('invalid Singo commands do not become history and remote state rollback is repairable',()=>{
  const g=game();command(g,'accept','erica');center(g,'becca','My song');
  g.events[String(++g.revision)]={type:'sing',index:12,actor:'erica',at:now};
  const batch=singoHistory('pair',g,'becca');
  const a=reconcileHistory(empty(),[batch],now),b=reconcileHistory(empty(),[batch],now);
  assert.deepEqual(a,b);assert.equal(a.performances.length,1);
  assert.equal(singoHistory('pair',g,'erica').performances.length,0);
});

test('the real app renders linked performances in Home, History and Tonight',()=>{
  const dom=new JSDOM(readFileSync('index.html','utf8'),{runScripts:'outside-only',url:'https://example.test'});
  const w=dom.window;w.scrollTo=()=>{};
  const script=[...w.document.querySelectorAll('script')].find(s=>s.textContent.includes('function defaultState()'));
  w.eval(script.textContent);
  const data=reconcileHistory(w.KaraokeApp.emptyState(),[history('duet','becca')],now);
  w.KaraokeApp.setState(data);
  for(const id of ['recentList','historyList','sungTonightList']) {
    const text=w.document.getElementById(id).textContent;
    assert.match(text,/Shallow/);assert.match(text,/Duet/);
  }
  assert.match(w.document.getElementById('sungTonightCount').textContent,/1 song/);
  assert.match(w.document.getElementById('homeGreeting').textContent,/live/);
  dom.window.close();
});
