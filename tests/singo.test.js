import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deal,songKey,normalizePool,replay,appendAction,squareState,progress,applyAction,LINES} from '../src/singo-engine.js';
import {SHARED_POOL} from '../src/singo-pool.js';
const pool=normalizePool(SHARED_POOL);
function game(mode='traditional',seed=123){return {hostUid:'b',guestUid:'e',names:['Becca','Erica'],mode,seed,pool,events:{},revision:0};}
function send(g,type,actor='b',extra={}){Object.assign(g,appendAction(g,{type,actor,...extra}).data);return replay(g);}
function start(mode,seed){const g=game(mode,seed);send(g,'accept','e');return g;}
function reveal(g,p,i){let s=replay(g);while(!s.calls.includes(s.cards[p][i].number))s=send(g,'call');send(g,'reveal',p?'e':'b',{index:i});}
function sing(g,p,i){reveal(g,p,i);return send(g,'sing',p?'e':'b',{index:i});}

test('Traditional has 48 globally unique card songs and standard numbered columns over many deals',()=>{
  for(let seed=0;seed<100;seed++){
    const {cards,callOrder}=deal(pool,'traditional',seed);
    assert.equal(new Set(cards.flat().filter(s=>s.song).map(s=>songKey(s.song))).size,48);
    assert.equal(new Set(callOrder).size,75);
    for(const c of cards){assert.equal(c[12].song,null);for(let i=0;i<25;i++)if(i!==12){assert.ok(c[i].number>i%5*15&&c[i].number<=(i%5+1)*15);}assert.equal(new Set(c.map(s=>s.number)).size,25);}
  }
});
test('shared pool normalizes remasters, karaoke labels, punctuation and cover versions',()=>{
  assert.equal(songKey({title:'Ironic - 2015 Remaster'}),songKey({title:'Ironic'}));
  assert.equal(songKey({title:'Don’t Stop!',artist:'A'}),songKey({title:"Don't Stop",artist:'B'}));
  assert.equal(normalizePool([{title:'Song (Originally Performed by Artist) [Vocal Version]',artist:'Karaoke Band'}])[0].artist,'Artist');
});
test('short pools fail with a useful message',()=>{assert.throws(()=>deal(pool.slice(0,49),'traditional',1),/at least 50/);assert.throws(()=>deal(pool.slice(0,25),'heat',1),/at least 26/);});
test('invited guest must accept; only host calls; uncalled songs cannot be revealed or sung',()=>{
  const g=game();assert.throws(()=>send(g,'call'),/not accepting/);assert.throws(()=>send(g,'accept','b'),/invitation/);send(g,'accept','e');assert.throws(()=>send(g,'call','e'),/host/);assert.throws(()=>send(g,'reveal','b',{index:0}),/Wait/);assert.throws(()=>send(g,'sing','b',{index:0}),/Reveal/);
});
test('revealed line is pending, center is not free, only the fifth performance wins',()=>{
  const g=start();for(let i=0;i<5;i++)reveal(g,0,i);
  let s=replay(g);assert.equal(s.status,'playing');assert.equal(progress(s,0).earned,0);assert.equal(progress(s,0).pending,1);assert.equal(squareState(s,0,12),'revealed');
  for(let i=0;i<4;i++)send(g,'sing','b',{index:i});assert.equal(replay(g).winner,null);s=send(g,'sing','b',{index:4});assert.equal(s.winner,'b');assert.throws(()=>send(g,'call'),/not accepting/);
});
test('Traditional center exclusions do not disclose assigned songs',()=>{
  const g=start(),s=replay(g);assert.throws(()=>send(g,'center','b',{index:12,song:s.cards[1][0].song}),/^Error: That song is unavailable for your center. Try another song\.$/);
  send(g,'center','b',{index:12,song:{title:'Unassigned Center Song',artist:'Singer'}});assert.throws(()=>send(g,'center','e',{index:12,song:{title:'Unassigned Center Song',artist:'Cover'}}),/unavailable/);
  const next=send(g,'sing','b',{index:12});assert.equal(squareState(next,0,12),'earned');
});
test('Heat claims block hidden opponent squares, and undo restores them',()=>{
  const g=start('heat');let s=replay(g);const i=s.cards[0].findIndex(c=>c.song&&s.cards[1].some(b=>b.song&&songKey(b.song)===songKey(c.song)));const j=s.cards[1].findIndex(c=>c.song&&songKey(c.song)===songKey(s.cards[0][i].song));
  s=sing(g,0,i);assert.equal(squareState(s,1,j),'blocked');assert.equal(s.cards[1][j].revealed,false);assert.ok(progress(s,1).possible<12);assert.throws(()=>send(g,'sing','e',{index:j}));s=send(g,'undo');assert.equal(squareState(s,1,j),'hidden');assert.equal(progress(s,1).possible,12);
});
test('Heat center can claim opponent song, but never duplicate its own card',()=>{
  const g=start('heat');const s=replay(g),own=new Set(s.cards[0].filter(c=>c.song).map(c=>songKey(c.song)));const j=s.cards[1].findIndex(c=>c.song&&!own.has(songKey(c.song)));
  send(g,'center','b',{index:12,song:s.cards[1][j].song});let next=send(g,'sing','b',{index:12});assert.equal(squareState(next,1,j),'blocked');assert.throws(()=>send(g,'center','e',{index:12,song:s.cards[1][0].song}),/unavailable/);
});
test('correction reopens a win and cannot undo an earlier performance after another singer',()=>{
  const g=start();for(let i=0;i<5;i++)sing(g,0,i);assert.equal(replay(g).status,'won');send(g,'undo');assert.equal(replay(g).status,'playing');sing(g,1,0);assert.throws(()=>send(g,'undo','b'),/most recent/);
});
test('same-night rematches retain performed songs, a new night explicitly clears them',()=>{
  const g=start();sing(g,0,0);const used=songKey(replay(g).cards[0][0].song);send(g,'end');let s=send(g,'round','b',{mode:'traditional',seed:456,newNight:false});assert.ok(s.used.includes(used));assert.ok(s.cards.flat().filter(c=>c.song).every(c=>songKey(c.song)!==used));send(g,'accept','e');assert.throws(()=>send(g,'center','b',{index:12,song:{title:replay(g).used[0],artist:'A'}}),/unavailable/);send(g,'end');s=send(g,'round','b',{mode:'heat',seed:2,newNight:true});assert.deepEqual(s.used,[]);assert.equal(s.night,2);
});
test('reconnect reproduces exactly the same card, calls, claims, and winner',()=>{
  const g=start('heat');sing(g,0,0);assert.deepEqual(replay(JSON.parse(JSON.stringify(g))),replay(g));
});
test('draw is declared only when all lines on both boards are blocked',()=>{
  const g=start('heat');const s=replay(g);
  // Build a legal correction input to exercise settlement of fully blocked cards.
  for(let p=0;p<2;p++)for(let i=0;i<25;i++)if(i!==12)s.used.push(songKey(s.cards[p][i].song));
  s.performances=[{player:0,index:12,key:'temporary',song:{title:'Temporary',artist:'A'}}];
  const next=applyAction(s,{type:'undo',actor:'b'},g);assert.equal(next.status,'draw');assert.equal(progress(next,0).possible,0);assert.equal(progress(next,1).possible,0);
});
test('malformed or unauthorized commands are ignored on replay and cannot award squares',()=>{
  const g=game();g.events={'1':{type:'accept',actor:'b'},'2':{type:'sing',actor:'outsider',index:0}};g.revision=2;assert.equal(replay(g).status,'invited');assert.equal(progress(replay(g),0).earned,0);
});
