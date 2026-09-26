import './singo.js';
import { initializeApp } from 'firebase/app';
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup,
  signInWithRedirect, getRedirectResult, signOut
} from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, getDocFromServer, setDoc, updateDoc, addDoc,
  onSnapshot, query, orderBy, limit, serverTimestamp
} from 'firebase/firestore';

const app = window.KaraokeApp;
const config = window.SING_IT_AGAIN_FIREBASE_CONFIG;
const gate = document.getElementById('cloudGate');
const gateMessage = document.getElementById('gateMessage');
const gateError = document.getElementById('gateError');
const status = document.getElementById('cloudStatus');
const inviteBox = document.getElementById('backstageInvite');
const room = document.getElementById('backstageRoom');
const partnerLabel = document.getElementById('backstagePartner');
const legacyKey = app.storageKey + '_preCloud';
const legacyAvailableKey = legacyKey + ':available';
const escape = app.esc;

let auth, db, user, stateRef, pair, pairId;
let ready = false;
let suppress = false;
let unsaved = null;
let saveTimer = null;
let writeChain = Promise.resolve();
let lastState = '';
let listeners = [];
let pairListeners = [];
let messages = [], challenges = [], duets = [];
let activeTab = 'chat';
let signInBusy = false;
let inFlight = 0;
let editingInvite = false;
let accountPairId = null;
let sharedPairId = null;

function notice(message, error = false) {
  status.textContent = message;
  status.style.color = error ? 'var(--danger)' : '';
}
function errorText(error) {
  const code = error && error.code;
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return '';
  if (code === 'auth/unauthorized-domain') return 'Add this website to Firebase Authentication authorized domains.';
  if (code === 'permission-denied') return 'Access was denied. Check the Firestore rules for this project.';
  return (error && error.message) || 'Something went wrong. Please try again.';
}
function fail(error) {
  console.error('Sing it Again! cloud:', error);
  notice(errorText(error), true);
}
function modal(title, body) {
  app.showModal('<h3>' + title + '</h3>' + body);
}
function date(value) {
  const d = value && typeof value.toDate === 'function' ? value.toDate() : null;
  return d ? d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
}
function localCopyKey(uid) { return 'singItAgainAccount:' + uid; }
function storeLocal(uid, data) {
  try { localStorage.setItem(localCopyKey(uid), JSON.stringify(data)); } catch {}
}
function loadLocal(uid) {
  try { return JSON.parse(localStorage.getItem(localCopyKey(uid)) || 'null'); } catch { return null; }
}
function useState(data) {
  suppress = true;
  try {
    let next = data && Array.isArray(data.songs) && Array.isArray(data.performances) &&
      Array.isArray(data.sessions) ? data : app.emptyState();
    if (accountPairId) next = { ...next, pairId: accountPairId };
    app.setState(next);
    lastState = JSON.stringify(next);
    if (user) storeLocal(user.uid, next);
  } finally { suppress = false; }
  if (ready && user) syncBackstage();
}
function stopPairListeners() {
  window.KaraokeSingo?.connect(null);
  pairListeners.forEach(stop => stop());
  pairListeners = [];
  pair = null;
  pairId = null;
  sharedPairId = null;
  messages = []; challenges = []; duets = [];
  room.hidden = true;
  for (const id of ['backstageMessages', 'challengeList', 'duetList']) {
    document.getElementById(id).innerHTML = '';
  }
}
function stopListeners() {
  listeners.forEach(stop => stop());
  listeners = [];
  stopPairListeners();
  accountPairId = null;
}

// The old device copy is captured once, before an account can replace it.
try {
  if (localStorage.getItem(legacyAvailableKey) === null) {
    localStorage.setItem(legacyAvailableKey, String(app.hadLocalState));
  }
  if (!localStorage.getItem(legacyKey)) {
    localStorage.setItem(legacyKey, localStorage.getItem(app.storageKey) || JSON.stringify(app.getState()));
  }
} catch {}

function scheduleSave(data) {
  if (!ready || suppress || !user || !stateRef) return;
  const copy = JSON.parse(JSON.stringify(data));
  const serialized = JSON.stringify(copy);
  if (serialized === lastState) return;
  unsaved = copy;
  storeLocal(user.uid, copy);
  notice('Saving your songs…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { flush().catch(fail); }, 350);
}

function flush() {
  if (!unsaved || !stateRef) return writeChain;
  const next = unsaved;
  const target = stateRef;
  const uid = user.uid;
  unsaved = null;
  lastState = JSON.stringify(next);
  writeChain = writeChain.catch(() => {}).then(async () => {
    inFlight++;
    try {
      await setDoc(target, { data: next, updatedAt: serverTimestamp() }, { merge: true });
      if (user && user.uid === uid) notice('Your songs are synced');
    } finally { inFlight--; }
  });
  return writeChain;
}

async function loadAccount(signedIn) {
  clearTimeout(saveTimer);
  ready = false;
  unsaved = null;
  stopListeners();
  user = signedIn;
  stateRef = doc(db, 'users', user.uid, 'private', 'state');
  gate.hidden = false;
  notice('Opening ' + (user.displayName || 'your') + ' song library…');
  let snapshot;
  try {
    snapshot = await getDocFromServer(stateRef);
  } catch (error) {
    const cached = loadLocal(user.uid);
    if (!cached) {
      gate.hidden = false;
      gateMessage.textContent = 'Connect to the internet to open your songs the first time.';
      gateError.textContent = errorText(error);
      return;
    }
    useState(cached);
    ready = true;
    notice('Offline copy · changes will sync when connected');
  }
  if (snapshot) {
    if (snapshot.exists()) {
      accountPairId = snapshot.data().backstagePairId || snapshot.data().data?.pairId || null;
      useState(snapshot.data().data);
      if (accountPairId && !snapshot.data().backstagePairId) {
        await setDoc(stateRef, { backstagePairId: accountPairId }, { merge: true });
      }
    } else {
      useState(app.emptyState());
      await setDoc(stateRef, { data: app.getState(), updatedAt: serverTimestamp() });
      if (localStorage.getItem(legacyAvailableKey) === 'true' &&
          !new URLSearchParams(location.search).has('invite')) offerImport();
    }
    ready = true;
    notice('Your songs are synced');
  }
  const accountUid = user.uid;
  listeners.push(onSnapshot(stateRef, { includeMetadataChanges: true }, snap => {
    if (!user || user.uid !== accountUid || !snap.exists()) return;
    const connection = snap.data().backstagePairId || snap.data().data?.pairId;
    if (connection) accountPairId = connection;
    if (!unsaved && !inFlight && snap.data().data) {
      const remote = JSON.stringify(snap.data().data);
      if (remote !== lastState && !snap.metadata.hasPendingWrites) useState(snap.data().data);
    }
    syncBackstage();
    if (snap.metadata.fromCache || snap.metadata.hasPendingWrites) notice('Offline or saving · your changes are kept on this device');
    else notice('Your songs are synced');
  }, fail));
  syncBackstage();
  renderBackstage();
  gate.hidden = true;
  const invited = new URLSearchParams(location.search).get('invite');
  if (invited) await acceptInvite(invited);
}

function offerImport() {
  let old;
  try { old = JSON.parse(localStorage.getItem(legacyKey) || 'null'); } catch {}
  if (localStorage.getItem(legacyAvailableKey) !== 'true' ||
      !old || !Array.isArray(old.songs) || !old.songs.length ||
      localStorage.getItem(legacyKey + ':claimed')) {
    modal('Original phone data', '<p>There is no unclaimed original library on this device to import.</p>' +
      '<button class="primary-btn full" id="closeImport">Done</button>');
    document.getElementById('closeImport').onclick = app.closeModal;
    return;
  }
  modal('Bring over this phone’s songs?', '<p>This phone has ' + old.songs.length +
    ' songs and ' + (old.performances || []).length + ' performances from the original app. Import them only if they belong to your account. The original copy stays on this phone.</p>' +
    '<div class="btn-row"><button class="ghost-btn" id="skipImport">Not now</button>' +
    '<button class="primary-btn" id="confirmImport">Import my songs</button></div>');
  document.getElementById('skipImport').onclick = app.closeModal;
  document.getElementById('confirmImport').onclick = async () => {
    try {
      const current = await getDocFromServer(stateRef);
      const value = current.data()?.data;
      if (value && (value.songs?.length || value.performances?.length)) {
        throw new Error('This account already has songs. Export a backup before combining libraries.');
      }
      const imported = {
        ...app.emptyState(),
        songs: old.songs, performances: old.performances || [], sessions: old.sessions || [],
        queue: old.queue || [], activeSessionId: old.activeSessionId || null,
        companion: old.companion || { enabled: false, name: 'Erica' },
        pairId: accountPairId || app.getState().pairId || null
      };
      useState(imported);
      lastState = '';
      scheduleSave(imported);
      await flush();
      localStorage.setItem(legacyKey + ':claimed', user.uid);
      app.closeModal();
      notice('Your songs are synced');
    } catch (error) { fail(error); alert(errorText(error)); }
  };
}

async function beginSignIn() {
  if (!auth || signInBusy) return;
  signInBusy = true;
  gateError.textContent = '';
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (error) {
    if (error.code === 'auth/popup-blocked' || error.code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, new GoogleAuthProvider());
    } else gateError.textContent = errorText(error);
  } finally { signInBusy = false; }
}

function peerUid() {
  return pair && pair.partnerUid && user
    ? (pair.ownerUid === user.uid ? pair.partnerUid : pair.ownerUid)
    : null;
}
function peerName() {
  if (!pair || !user) return 'your partner';
  return pair.ownerUid === user.uid ? (pair.partnerName || 'your partner') : pair.ownerName;
}
function pairPath() { return doc(db, 'pairs', pairId); }

function syncBackstage() {
  const id = accountPairId || app.getState().pairId;
  if (id && id !== pairId) listenPair(id);
}
async function savePairConnection(id) {
  // Keep membership separate from the replaceable song-library snapshot.
  // Save explicitly, including when an older app shell is still cached.
  const target = stateRef;
  await setDoc(target, { backstagePairId: id }, { merge: true });
  accountPairId = id;
  const current = { ...app.getState(), pairId: id };
  app.setState(current);
  scheduleSave(current);
  await flush();
  listenPair(id);
}
function listenPair(id) {
  if (pairId === id && pairListeners.length) return;
  stopPairListeners();
  pairId = id;
  editingInvite = false;
  renderBackstage();
  pairListeners.push(onSnapshot(doc(db, 'pairs', id), snap => {
    if (pairId !== id || !user) return;
    if (!snap.exists()) {
      stopPairListeners();
      renderBackstage();
      notice('This Backstage invite no longer exists.', true);
      return;
    }
    pair = snap.data();
    renderBackstage();
    if (pair.partnerUid && sharedPairId !== id) subscribeShared(id);
  }, error => {
    stopPairListeners();
    renderBackstage();
    partnerLabel.textContent = 'Backstage could not reconnect. Reopen your original invite link to try again.';
    fail(error);
  }));
}
function subscribeShared(id) {
  sharedPairId = id;
  window.KaraokeSingo?.connect({db,pairId:id,user,peerUid:peerUid(),peerName:peerName()});
  for (const [name, setter] of [
    ['messages', value => { messages = value; renderMessages(); }],
    ['challenges', value => { challenges = value; renderEntries('challenge'); }],
    ['duets', value => { duets = value; renderEntries('duet'); }]
  ]) {
    const q = query(collection(db, 'pairs', id, name), orderBy('createdAt', 'desc'), limit(75));
    pairListeners.push(onSnapshot(q, snapshot => {
      if (pairId === id && user) setter(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    }, error => {
      partnerLabel.textContent = 'Backstage could not load your conversation. Refresh to reconnect.';
      fail(error);
    }));
  }
}
function inviteLink() {
  const link = new URL(location.href);
  link.search = '?invite=' + encodeURIComponent(pairId);
  link.hash = '';
  return link.toString();
}
function renderBackstage() {
  if (!user) return;
  const joined = !!peerUid();
  room.hidden = !joined;
  partnerLabel.textContent = joined
    ? 'You and ' + peerName() + ' · songs, dares, and duet plans'
    : 'Invite your singing partner to make a private Backstage together.';
  inviteBox.innerHTML = '';
  if (pairId && !pair) {
    partnerLabel.textContent = 'Reconnecting to your shared Backstage…';
    inviteBox.innerHTML = '<div class="card backstage-card"><p>Opening your conversation…</p></div>';
  } else if (!pair || editingInvite) {
    inviteBox.innerHTML =
      '<div class="card backstage-card"><h3>Invite your karaoke partner</h3>' +
      '<p>Enter the Google email your partner will use to sign in. Only that account can join your invite.</p>' +
      '<form id="inviteForm"><label for="partnerEmail">Partner’s Google email</label>' +
      '<input id="partnerEmail" type="email" required autocomplete="email" placeholder="erica@example.com">' +
      '<button class="primary-btn full" type="submit">' +
      (editingInvite ? 'Update invite' : 'Create private invite') + '</button></form></div>';
  } else if (!joined) {
    inviteBox.innerHTML = '<div class="card backstage-card"><h3>Waiting for your partner 🎤</h3>' +
      '<p>Invite for ' + escape(pair.inviteeEmail) +
      '. Share this link with her, then she can join using that Google account.</p>' +
      '<button class="primary-btn full" id="shareInvite">Share invite link</button>' +
      '<button class="ghost-btn full" id="changeInvite" style="margin-top:8px">Change email</button></div>';
  } else {
    document.querySelector('[data-new-shared="challenge"]').textContent =
      '+ Challenge ' + peerName() + ' with a song';
  }
  switchTab(activeTab);
}
function switchTab(tab) {
  activeTab = tab;
  for (const name of ['chat', 'challenges', 'duets']) {
    document.getElementById('backstage' + name[0].toUpperCase() + name.slice(1)).hidden = name !== tab;
    const button = document.querySelector('[data-backstage-tab="' + name + '"]');
    button.classList.toggle('primary-btn', name === tab);
    button.classList.toggle('ghost-btn', name !== tab);
    button.setAttribute('aria-selected', String(name === tab));
  }
}
async function createInvite(email) {
  if (!user) return;
  const clean = email.trim().toLowerCase();
  if (!clean || !clean.includes('@')) return;
  try {
    if (pair && pair.ownerUid === user.uid && !pair.partnerUid) {
      await updateDoc(pairPath(), { inviteeEmail: clean });
      editingInvite = false;
      renderBackstage();
    } else {
      const ref = doc(collection(db, 'pairs'));
      await setDoc(ref, {
        ownerUid: user.uid, ownerName: (user.displayName || 'Your partner').slice(0, 80),
        partnerUid: null, partnerName: '', inviteeEmail: clean,
        createdAt: serverTimestamp()
      });
      await savePairConnection(ref.id);
    }
  } catch (error) { fail(error); }
}
async function acceptInvite(id) {
  if (!user || !/^[A-Za-z0-9]{15,80}$/.test(id)) return;
  try {
    const ref = doc(db, 'pairs', id);
    const snap = await getDocFromServer(ref);
    if (!snap.exists()) throw new Error('This invite was not found.');
    const data = snap.data();
    const isOwner = data.ownerUid === user.uid;
    if (!isOwner && data.inviteeEmail !== (user.email || '').toLowerCase()) {
      throw new Error('This invite is for ' + data.inviteeEmail + '. Sign in with that Google account.');
    }
    if (!isOwner && data.partnerUid && data.partnerUid !== user.uid) throw new Error('This invite has already been used.');
    const existingPairId = accountPairId || app.getState().pairId;
    if (existingPairId && existingPairId !== id) {
      throw new Error('Your account is already connected to another Backstage.');
    }
    if (!isOwner && !data.partnerUid) {
      await updateDoc(ref, { partnerUid: user.uid, partnerName: (user.displayName || 'Erica').slice(0, 80) });
    }
    await savePairConnection(id);
    history.replaceState(null, '', location.pathname + location.hash);
    app.switchScreen('backstageScreen');
  } catch (error) { fail(error); alert(errorText(error)); }
}

function renderMessages() {
  const box = document.getElementById('backstageMessages');
  if (!messages.length) {
    box.innerHTML = '<div class="card empty">No messages yet. Send the first song idea!</div>';
    return;
  }
  box.innerHTML = [...messages].reverse().map(m => {
    const sender = m.senderUid === user.uid ? 'You' : peerName();
    const song = m.type === 'song'
      ? '<div class="pick-card"><strong>🎵 ' + escape(m.title) + '</strong><div class="artist">' +
        escape(m.artist) + '</div></div>' : '';
    return '<div class="card backstage-card"><div class="backstage-meta">' + escape(sender) +
      ' · ' + date(m.createdAt) + '</div>' + song +
      (m.text ? '<p>' + escape(m.text) + '</p>' : '') + '</div>';
  }).join('');
}
function renderEntries(kind) {
  const entries = kind === 'challenge' ? challenges : duets;
  const box = document.getElementById(kind === 'challenge' ? 'challengeList' : 'duetList');
  if (!entries.length) {
    box.innerHTML = '<div class="card empty">No ' + (kind === 'challenge' ? 'challenges' : 'duets') +
      ' yet. Pick a song for ' + escape(peerName()) + '!</div>';
    return;
  }
  box.innerHTML = entries.map(item => {
    const sentByMe = item.senderUid === user.uid;
    const incoming = !sentByMe;
    const actions = [];
    if (incoming && item.status === 'pending') {
      actions.push('<button class="primary-btn" data-item-action="accepted">Accept</button>');
      actions.push('<button class="ghost-btn" data-item-action="passed">Pass</button>');
    }
    if (item.status === 'accepted' && (incoming || kind === 'duet')) {
      actions.push('<button class="purple-btn" data-item-action="sung">' +
        (kind === 'duet' ? 'We sang it 🎤' : 'I sang it 🎤') + '</button>');
    }
    if (incoming) actions.push('<button class="ghost-btn" data-item-action="save-song">+ My Songs</button>');
    const label = item.status === 'pending' ? 'Waiting' :
      item.status === 'accepted' ? 'Accepted' : item.status === 'passed' ? 'Passed' : 'Sung!';
    return '<div class="card backstage-card" data-kind="' + kind + '" data-id="' + item.id + '">' +
      '<div class="backstage-meta">' + (sentByMe ? 'You sent this' : escape(peerName()) + ' sent this') +
      ' · ' + date(item.createdAt) + '</div><h3>' + escape(item.title) + '</h3>' +
      '<div class="artist">' + escape(item.artist) + '</div>' +
      (item.note ? '<p>' + escape(item.note) + '</p>' : '') +
      '<div class="tag">' + label + '</div>' +
      '<div class="backstage-actions">' + actions.join('') + '</div></div>';
  }).join('');
}

function composeShared(kind, song = null) {
  if (!peerUid()) {
    app.switchScreen('backstageScreen');
    return;
  }
  const title = kind === 'challenge' ? 'Send a song challenge' :
    kind === 'duet' ? 'Suggest a duet' : 'Send a song card';
  modal(title, '<p>' + (kind === 'challenge'
    ? 'Dare ' + escape(peerName()) + ' to try a song.'
    : kind === 'duet' ? 'Put a song on your shared duet wishlist.'
      : 'Send this song to ' + escape(peerName()) + ' in chat.') + '</p>' +
    '<form id="sharedSongForm" data-kind="' + kind + '">' +
    '<label>Song title</label><input id="sharedTitle" maxlength="120" required value="' +
    escape(song?.title || '') + '">' +
    '<label>Artist</label><input id="sharedArtist" maxlength="120" required value="' +
    escape(song?.artist || '') + '">' +
    '<label>Note (optional)</label><textarea id="sharedNote" maxlength="500" placeholder="Why this one?"></textarea>' +
    '<div class="btn-row"><button type="button" class="ghost-btn" id="cancelShared">Cancel</button>' +
    '<button class="primary-btn" type="submit">Send</button></div></form>');
  document.getElementById('cancelShared').onclick = app.closeModal;
  document.getElementById('sharedSongForm').onsubmit = async event => {
    event.preventDefault();
    const title = document.getElementById('sharedTitle').value.trim();
    const artist = document.getElementById('sharedArtist').value.trim();
    const note = document.getElementById('sharedNote').value.trim();
    if (!title || !artist) return;
    try {
      if (kind === 'song') {
        await addDoc(collection(db, 'pairs', pairId, 'messages'), {
          type: 'song', senderUid: user.uid, title, artist, text: note,
          createdAt: serverTimestamp()
        });
        activeTab = 'chat';
      } else {
        await addDoc(collection(db, 'pairs', pairId, kind === 'challenge' ? 'challenges' : 'duets'), {
          senderUid: user.uid, recipientUid: peerUid(), title, artist, note,
          status: 'pending', createdAt: serverTimestamp()
        });
        activeTab = kind === 'challenge' ? 'challenges' : 'duets';
      }
      app.closeModal();
      app.switchScreen('backstageScreen');
      switchTab(activeTab);
    } catch (error) { fail(error); alert(errorText(error)); }
  };
}
function shareSong(id) {
  const song = app.getSong(id);
  if (!song) return;
  if (!peerUid()) {
    app.switchScreen('backstageScreen');
    return;
  }
  modal('Share ' + escape(song.title), '<p>What should ' + escape(peerName()) + ' see?</p>' +
    '<button class="ghost-btn full" id="shareCard">🎵 Send song in chat</button>' +
    '<button class="purple-btn full" id="shareChallenge" style="margin-top:8px">🎤 Send a challenge</button>' +
    '<button class="primary-btn full" id="shareDuet" style="margin-top:8px">👯‍♀️ Suggest a duet</button>');
  document.getElementById('shareCard').onclick = () => composeShared('song', song);
  document.getElementById('shareChallenge').onclick = () => composeShared('challenge', song);
  document.getElementById('shareDuet').onclick = () => composeShared('duet', song);
}
async function updateEntry(kind, id, action) {
  const entries = kind === 'challenge' ? challenges : duets;
  const item = entries.find(value => value.id === id);
  if (!item) return;
  if (action === 'save-song') {
    const state = app.getState();
    const exists = state.songs.some(song =>
      song.title.toLowerCase() === item.title.toLowerCase() &&
      song.artist.toLowerCase() === item.artist.toLowerCase());
    if (exists) { notice('That song is already in My Songs'); return; }
    state.songs.push({
      id: crypto.randomUUID(), title: item.title, artist: item.artist,
      favorite: false, ourJam: kind === 'duet', tags: [], sourcePlaylists: ['Backstage'],
      notes: item.note || '', count: 0, lastSung: null
    });
    app.setState(state);
    notice('Added to My Songs');
    return;
  }
  try {
    await updateDoc(doc(db, 'pairs', pairId, kind === 'challenge' ? 'challenges' : 'duets', id),
      { status: action });
  } catch (error) { fail(error); }
}

document.getElementById('googleSignInBtn').addEventListener('click', beginSignIn);
document.getElementById('messageForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!peerUid()) return;
  const input = document.getElementById('messageText');
  const text = input.value.trim();
  if (!text) return;
  input.disabled = true;
  try {
    await addDoc(collection(db, 'pairs', pairId, 'messages'),
      { type: 'text', senderUid: user.uid, text, createdAt: serverTimestamp() });
    input.value = '';
  } catch (error) { fail(error); } finally { input.disabled = false; }
});
document.getElementById('accountBtn').addEventListener('click', () => {
  if (!user) return;
  modal('Your karaoke account', '<p>Signed in as <strong>' + escape(user.email) +
    '</strong></p><p>Your songs and history belong to this account. Backstage is shared only with your invited partner.</p>' +
    '<button class="ghost-btn full" id="importFromPhone">Import original phone data</button>' +
    '<button class="danger-btn full" id="signOutBtn" style="margin-top:8px">Sign out</button>');
  document.getElementById('importFromPhone').onclick = offerImport;
  document.getElementById('signOutBtn').onclick = async () => {
    if (unsaved) await flush();
    await writeChain;
    app.closeModal();
    await signOut(auth);
  };
});
document.getElementById('backstageScreen').addEventListener('click', async event => {
  const tab = event.target.closest('[data-backstage-tab]');
  if (tab) { switchTab(tab.dataset.backstageTab); return; }
  const newItem = event.target.closest('[data-new-shared]');
  if (newItem) { composeShared(newItem.dataset.newShared); return; }
  if (event.target.id === 'shareInvite') {
    try {
      if (navigator.share) await navigator.share({ title: 'Join me on Sing it Again!', url: inviteLink() });
      else {
        await navigator.clipboard.writeText(inviteLink());
        notice('Invite link copied');
      }
    } catch (error) {
      if (error.name !== 'AbortError') fail(error);
    }
    return;
  }
  if (event.target.id === 'changeInvite') {
    editingInvite = true;
    renderBackstage();
    return;
  }
  const action = event.target.closest('[data-item-action]');
  const card = action?.closest('[data-kind][data-id]');
  if (card) updateEntry(card.dataset.kind, card.dataset.id, action.dataset.itemAction);
});
document.getElementById('backstageScreen').addEventListener('submit', event => {
  if (event.target.id !== 'inviteForm') return;
  event.preventDefault();
  createInvite(document.getElementById('partnerEmail').value);
});

window.KaraokeCloud = { scheduleSave, shareSong };

if (!config?.apiKey || !config?.authDomain || !config?.projectId || !config?.appId) {
  gate.hidden = true;
  notice('Backstage setup is waiting for its Firebase project');
  inviteBox.innerHTML = '<div class="card backstage-card"><p>Account syncing and Backstage will open after the Firebase project is connected.</p></div>';
} else {
  const firebaseApp = initializeApp(config);
  auth = getAuth(firebaseApp);
  db = initializeFirestore(firebaseApp, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
  gate.hidden = false;
  gateMessage.textContent = 'Checking your karaoke account…';
  getRedirectResult(auth).catch(error => { gateError.textContent = errorText(error); });
  onAuthStateChanged(auth, signedIn => {
    if (!signedIn) {
      clearTimeout(saveTimer);
      ready = false;
      unsaved = null;
      stopListeners();
      user = null;
      stateRef = null;
      gate.hidden = false;
      gateMessage.textContent = 'Sign in to open your own songs and Backstage.';
      return;
    }
    loadAccount(signedIn).catch(error => {
      fail(error);
      gate.hidden = false;
      gateError.textContent = errorText(error);
    });
  });
}
