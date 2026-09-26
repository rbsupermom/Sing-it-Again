import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,updateDoc,serverTimestamp,runTransaction} from 'firebase/firestore';
import {normalizePool,replay,appendAction,songKey,squareState} from '../src/singo-engine.js';
import {SHARED_POOL} from '../src/singo-pool.js';
import {singoStore} from '../src/singo-store.js';

test('two authenticated players persist games; rules enforce identity, host controls and append-only history',async()=>{
  const env=await initializeTestEnvironment({projectId:'demo-singo-game',firestore:{host:'127.0.0.1',port:8080,rules:readFileSync('firestore.rules','utf8')}});
  try{
    const b=env.authenticatedContext('becca',{email:'b@example.com'}).firestore(),e=env.authenticatedContext('erica',{email:'e@example.com'}).firestore(),x=env.authenticatedContext('outsider').firestore();
    await env.withSecurityRulesDisabled(async ctx=>setDoc(doc(ctx.firestore(),'pairs/testpair'),{ownerUid:'becca',partnerUid:'erica'}));
    const path='pairs/testpair/singo/current',br=doc(b,path),er=doc(e,path),xr=doc(x,path);
    const bs=singoStore(b,'testpair',{uid:'becca'}),es=singoStore(e,'testpair',{uid:'erica'});
    await assertFails(getDoc(xr));
    await assertSucceeds(bs.create({guestUid:'erica',names:['Becca','Erica'],pool:SHARED_POOL,mode:'heat',seed:123}));
    await assertSucceeds(getDoc(er));
    await assert.rejects(es.create({guestUid:'becca',names:['Erica','Becca'],pool:SHARED_POOL,mode:'heat',seed:4}),/already exists/);
    const g=(await getDoc(br)).data();
    await assertFails(updateDoc(er,{revision:1,events:{'1':{actor:'becca',type:'accept'}}}));
    await assertFails(updateDoc(er,{revision:1,events:{'1':{actor:'erica',type:'call'}}}));
    await assertFails(updateDoc(xr,{revision:1,events:{'1':{actor:'outsider',type:'accept'}}}));
    await assertSucceeds(es.send({type:'accept'},1));
    await assertFails(updateDoc(br,{pool:[]}));
    await assertFails(updateDoc(br,{revision:2,events:{'1':{actor:'erica',type:'decline'},'2':{actor:'becca',type:'call'}}}));
    await assertFails(updateDoc(br,{revision:7,events:{'7':{actor:'becca',type:'call'}}}));
    await assertFails(updateDoc(br,{revision:2,events:{...((await getDoc(br)).data().events),'2':{actor:'becca',type:'center',index:12,song:{title:'',artist:''}}}}));
    let state=replay((await getDoc(br)).data());
    const i=state.cards[0].findIndex(c=>c.song&&state.cards[1].some(d=>d.song&&songKey(d.song)===songKey(c.song)));
    const j=state.cards[1].findIndex(c=>c.song&&songKey(c.song)===songKey(state.cards[0][i].song));
    while(!state.calls.includes(state.cards[0][i].number)||!state.calls.includes(state.cards[1][j].number)){
      await bs.send({type:'call'},1);state=replay((await getDoc(br)).data());
    }
    await bs.send({type:'reveal',index:i},1);await es.send({type:'reveal',index:j},1);
    const results=await Promise.allSettled([bs.send({type:'sing',index:i},1),es.send({type:'sing',index:j},1)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1,'simultaneous claims must have exactly one winner');
    state=replay((await getDoc(br)).data());assert.equal(state.performances.length,1);
    const winner=state.performances[0].player;assert.equal(squareState(state,1-winner,winner===0?j:i),'blocked');
    const restored=replay((await getDoc(er)).data());assert.deepEqual(restored,state,'both clients reconnect to identical game state');
    await (winner===0?bs:es).send({type:'undo'},1);state=replay((await getDoc(br)).data());assert.equal(state.performances.length,0);
    await bs.send({type:'end'},1);await bs.send({type:'round',mode:'traditional',seed:12,newNight:false},1);
    await assert.rejects(es.send({type:'sing',index:j},1),/new round/);
    await es.send({type:'accept'},2);assert.equal(replay((await getDoc(er)).data()).status,'playing');
    await bs.send({type:'end'},2);
    const oldRoom=(await getDoc(br)).data();
    await bs.send({type:'round',mode:'heat',seed:22,newNight:true},2,oldRoom.sessionId);
    assert.deepEqual((await getDoc(doc(b,'pairs/testpair/singoArchive',oldRoom.sessionId))).data(),oldRoom);
    const fresh=(await getDoc(er)).data();assert.notEqual(fresh.sessionId,oldRoom.sessionId);assert.equal(fresh.revision,0);
    await assert.rejects(es.send({type:'accept'},1,oldRoom.sessionId),/new round/);
    await es.send({type:'accept'},1,fresh.sessionId);
    await assertFails(updateDoc(doc(b,'pairs/testpair/singoArchive',oldRoom.sessionId),{mode:'heat'}));
    await assertFails(getDoc(doc(x,'pairs/testpair/singoArchive',oldRoom.sessionId)));
  }finally{await env.cleanup();}
});
