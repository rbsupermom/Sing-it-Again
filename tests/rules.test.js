import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, collection, setDoc, getDoc, addDoc, updateDoc, serverTimestamp } from 'firebase/firestore';

test('personal songs stay private and only the invited partner can join Backstage', async () => {
  const env = await initializeTestEnvironment({
    projectId: 'sing-it-again-rules-test',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync('firestore.rules', 'utf8')
    }
  });
  try {
    const becca = env.authenticatedContext('becca', { email: 'becca@example.com' }).firestore();
    const erica = env.authenticatedContext('erica', { email: 'erica@example.com' }).firestore();
    const stranger = env.authenticatedContext('stranger', { email: 'stranger@example.com' }).firestore();
    const privatePath = 'users/becca/private/state';
    await assertSucceeds(setDoc(doc(becca, privatePath), { data: { songs: ['Black Velvet'] } }));
    await assertFails(getDoc(doc(erica, privatePath)));
    await assertFails(getDoc(doc(stranger, privatePath)));

    const pairId = 'karaokePair1234567890';
    const pairPath = 'pairs/' + pairId;
    await assertSucceeds(setDoc(doc(becca, pairPath), {
      ownerUid: 'becca', ownerName: 'Becca', partnerUid: null, partnerName: '',
      inviteeEmail: 'erica@example.com', createdAt: serverTimestamp()
    }));
    await assertSucceeds(getDoc(doc(erica, pairPath)));
    await assertFails(getDoc(doc(stranger, pairPath)));
    await assertFails(addDoc(collection(becca, pairPath, 'messages'), {
      type: 'text', senderUid: 'becca', text: 'Early message', createdAt: serverTimestamp()
    }));
    await assertFails(updateDoc(doc(stranger, pairPath), {
      partnerUid: 'stranger', partnerName: 'Stranger'
    }));
    await assertSucceeds(updateDoc(doc(erica, pairPath), {
      partnerUid: 'erica', partnerName: 'Erica'
    }));

    await assertSucceeds(addDoc(collection(becca, pairPath, 'messages'), {
      type: 'song', senderUid: 'becca', title: 'Shallow', artist: 'Lady Gaga',
      text: 'Duet?', createdAt: serverTimestamp()
    }));
    await assertFails(addDoc(collection(stranger, pairPath, 'messages'), {
      type: 'text', senderUid: 'stranger', text: 'Hello', createdAt: serverTimestamp()
    }));
    const challenge = doc(collection(becca, pairPath, 'challenges'));
    await assertSucceeds(setDoc(challenge, {
      senderUid: 'becca', recipientUid: 'erica', title: 'Shallow',
      artist: 'Lady Gaga', note: 'Try it!', status: 'pending', createdAt: serverTimestamp()
    }));
    await assertFails(updateDoc(challenge, { status: 'accepted' }));
    await assertSucceeds(updateDoc(doc(erica, challenge.path), { status: 'accepted' }));
    await assertFails(updateDoc(doc(stranger, challenge.path), { status: 'sung' }));
    await assertSucceeds(updateDoc(doc(erica, challenge.path), { status: 'sung' }));
    const duet=doc(collection(becca,pairPath,'duets'));
    await setDoc(duet,{senderUid:'becca',recipientUid:'erica',title:'Shallow',artist:'Lady Gaga',note:'',status:'pending',createdAt:serverTimestamp()});
    await updateDoc(doc(erica,duet.path),{status:'accepted'});
    await assertFails(updateDoc(duet,{status:'sung',completedAt:new Date('2000-01-01')}));
    await assertSucceeds(updateDoc(duet,{status:'sung',completedAt:serverTimestamp()}));
    assert.ok((await getDoc(doc(erica,duet.path))).data().completedAt.toMillis()>0);
    await assertFails(updateDoc(duet,{completedAt:serverTimestamp()}));
    const timedChallenge=doc(collection(becca,pairPath,'challenges'));
    await setDoc(timedChallenge,{senderUid:'becca',recipientUid:'erica',title:'Black Velvet',artist:'Alannah Myles',note:'',status:'pending',createdAt:serverTimestamp()});
    await updateDoc(doc(erica,timedChallenge.path),{status:'accepted'});
    await assertFails(updateDoc(timedChallenge,{status:'sung',completedAt:serverTimestamp()}));
    await assertSucceeds(updateDoc(doc(erica,timedChallenge.path),{status:'sung',completedAt:serverTimestamp()}));
  } finally {
    await env.cleanup();
  }
});
