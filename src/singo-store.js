import {doc,onSnapshot,runTransaction,serverTimestamp} from 'firebase/firestore';
import {appendAction,deal,normalizePool,replay,applyAction} from './singo-engine.js';
export function singoStore(db,pairId,user) {
  const ref=doc(db,'pairs',pairId,'singo','current');
  return {
    listen(next,error) {return onSnapshot(ref,{includeMetadataChanges:true},snap=>next(snap.exists()?snap.data():null,!snap.metadata.fromCache),error);},
    async create({guestUid,names,pool,mode,seed}) {
      const sessionId=crypto.randomUUID();
      const cleaned=normalizePool(pool);deal(cleaned,mode,seed);
      await runTransaction(db,async tx=>{
        const snap=await tx.get(ref);
        if(snap.exists()) throw new Error('A game already exists. Open it to continue.');
        tx.set(ref,{sessionId,hostUid:user.uid,guestUid,names,pool:cleaned,mode,seed,revision:0,events:{},createdAt:serverTimestamp()});
      });
    },
    async send(action, expectedRound, expectedSessionId) {
      await runTransaction(db,async tx=>{
        const snap=await tx.get(ref);
        if(!snap.exists()) throw new Error('This game could not be found.');
        const room=snap.data();
        if((expectedSessionId && room.sessionId!==expectedSessionId)||replay(room).round!==expectedRound) throw new Error('A new round has started. Open your updated card.');
        const command={...action,actor:user.uid};
        if(action.type==='round'&&action.newNight) {
          applyAction(replay(room),command,room);
          const archive=doc(db,'pairs',pairId,'singoArchive',room.sessionId);
          tx.set(archive,room);
          tx.set(ref,{...room,sessionId:crypto.randomUUID(),seed:action.seed,mode:action.mode,revision:0,events:{},createdAt:serverTimestamp()});
        }else{
          const next=appendAction(room,command);
          tx.update(ref,next.data);
        }
      });
    }
  };
}
