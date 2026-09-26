// Deterministic game rules shared by both devices. Every action is replayable.
export const LINES = [
  ...Array.from({length:5},(_,r)=>Array.from({length:5},(_,c)=>r*5+c)),
  ...Array.from({length:5},(_,c)=>Array.from({length:5},(_,r)=>r*5+c)),
  [0,6,12,18,24], [4,8,12,16,20]
];
const require = (ok, message) => { if (!ok) throw new Error(message); };
const copy = value => JSON.parse(JSON.stringify(value));
export function cleanSong(song) {
  let title = String(song.title || '').trim();
  let artist = String(song.artist || '').trim();
  const original = title.match(/\(Originally Performed by (.+?)\)/i);
  if (original) artist = original[1];
  title = title.replace(/\(Originally Performed by .+?\)/ig,'')
    .replace(/\[(?:Vocal|Karaoke|Instrumental) Version\]/ig,'')
    .replace(/\s*[-–]\s*(?:\d{4}\s*)?(?:Remaster(?:ed)?|Greatest Hits Version).*$/i,'').trim();
  return {title, artist};
}
export function songKey(song) {
  // Title identity deliberately also catches cover versions at no-repeat venues.
  return cleanSong(song).title.normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]/g,'');
}
export function normalizePool(input) {
  const seen = new Set();
  return input.map(cleanSong).filter(s => {
    const key = songKey(s);
    if (!key || !s.artist || seen.has(key)) return false;
    require(s.title.length <= 120 && s.artist.length <= 120, 'Keep song titles and artists under 120 characters.');
    seen.add(key); return true;
  });
}
function random(seed) {
  let n = seed >>> 0;
  return () => { n += 0x6D2B79F5; let t = n; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function shuffle(items, rng) {
  const a = [...items];
  for (let i=a.length-1;i>0;i--) { const j=Math.floor(rng()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}
export function deal(pool, mode, seed, used = []) {
  require(['traditional','heat'].includes(mode), 'Choose a game mode.');
  const available = normalizePool(pool).filter(s=>!used.includes(songKey(s)));
  const needed = mode === 'traditional' ? 50 : 26;
  require(available.length >= needed, `This mode needs at least ${needed} unused, unique songs, including room for centers. You have ${available.length}. Add songs or begin a new night.`);
  const rng=random(seed), all=shuffle(available,rng), cards=[];
  for(let p=0;p<2;p++) {
    const songs=mode==='traditional'?all.slice(p*24,p*24+24):shuffle(available,rng).slice(0,24);
    const columns=Array.from({length:5},(_,c)=>shuffle(Array.from({length:15},(_,i)=>c*15+i+1),rng).slice(0,5).sort((a,b)=>a-b));
    let s=0;
    cards.push(Array.from({length:25},(_,i)=>({number:i===12?0:columns[i%5][Math.floor(i/5)],song:i===12?null:songs[s++],revealed:i===12})));
  }
  return {cards,callOrder:shuffle(Array.from({length:75},(_,i)=>i+1),rng)};
}
function newRound(room, mode, seed, used, round, night) {
  const d=deal(room.pool,mode,seed,used);
  return {hostUid:room.hostUid,guestUid:room.guestUid,players:[room.hostUid,room.guestUid],mode,
    cards:d.cards,callOrder:d.callOrder,calls:[],performances:[],used:[...used],status:'invited',winner:null,round,night};
}
export function squareState(state, player, index) {
  const square=state.cards[player][index];
  if(state.performances.some(p=>p.player===player&&p.index===index)) return 'earned';
  if(square.song && (state.used.includes(songKey(square.song)) || state.performances.some(p=>p.player!==player&&p.key===songKey(square.song)))) return 'blocked';
  return square.revealed?'revealed':'hidden';
}
export function progress(state,player) {
  const values=state.cards[player].map((_,i)=>squareState(state,player,i));
  return {earned:values.filter(s=>s==='earned').length,
    possible:LINES.filter(line=>line.every(i=>values[i]!=='blocked')).length,
    pending:LINES.filter(line=>line.every(i=>values[i]==='earned'||(values[i]==='revealed'&&!!state.cards[player][i].song))).length,
    bingo:LINES.some(line=>line.every(i=>values[i]==='earned'))};
}
function settle(state) {
  state.winner=null; state.status='playing';
  for(let p=0;p<2;p++) if(progress(state,p).bingo) { state.winner=state.players[p];state.status='won';return; }
  if(state.players.every((_,p)=>progress(state,p).possible===0)) state.status='draw';
}
export function applyAction(value, action, room) {
  const s=copy(value), p=s.players.indexOf(action.actor), i=action.index;
  require(p>=0,'Only invited players can play.');
  if(action.type==='round') {
    require(action.actor===s.hostUid,'Only the host can invite a rematch.');
    require(['won','draw','ended','declined'].includes(s.status),'Finish this round first.');
    const used=action.newNight?[]:[...new Set([...s.used,...s.performances.map(v=>v.key)])];
    return newRound(room,action.mode,action.seed,used,s.round+1,s.night+(action.newNight?1:0));
  }
  if(action.type==='accept'||action.type==='decline') {
    require(action.actor===s.guestUid&&s.status==='invited','This invitation is no longer waiting for you.');
    s.status=action.type==='accept'?'playing':'declined'; return s;
  }
  if(action.type==='end') {
    require(action.actor===s.hostUid&&!['ended','declined'].includes(s.status),'Only the host can end this round.');
    s.status='ended';return s;
  }
  if(action.type==='undo') {
    const last=s.performances.at(-1);
    require(['playing','won','draw'].includes(s.status)&&last&&last.player===p,'Only the most recent performance can be corrected, by its singer.');
    s.performances.pop();settle(s);return s;
  }
  require(s.status==='playing','This round is not accepting plays.');
  if(action.type==='call') {
    require(action.actor===s.hostUid,'Only the host calls numbers.');
    require(s.calls.length<75,'All numbers have been called.');
    s.calls.push(s.callOrder[s.calls.length]);return s;
  }
  require(Number.isInteger(i)&&i>=0&&i<25,'Choose a square.');
  const sq=s.cards[p][i], status=squareState(s,p,i);
  if(action.type==='reveal') {
    require(i!==12&&status==='hidden'&&s.calls.includes(sq.number),'Wait for the host to call this number.');
    sq.revealed=true;return s;
  }
  if(action.type==='center') {
    require(i===12&&!['earned','blocked'].includes(status),'That center is already finished.');
    const song=cleanSong(action.song||{}), key=songKey(song);
    require(key&&song.artist&&song.title.length<=120&&song.artist.length<=120,'Enter a song title and artist.');
    const assigned=s.cards.flatMap((card,who)=>card.filter((_,j)=>!(who===p&&j===12)&& (s.mode==='traditional'||who===p))).filter(c=>c.song).map(c=>songKey(c.song));
    require(!assigned.includes(key)&&!s.used.includes(key)&&!s.performances.some(v=>v.key===key), 'That song is unavailable for your center. Try another song.');
    sq.song=song;return s;
  }
  if(action.type==='sing') {
    require(status==='revealed'&&sq.song,'Reveal an available song before confirming that you sang it.');
    const key=songKey(sq.song);
    require(!s.used.includes(key)&&!s.performances.some(v=>v.key===key),'That song has already been performed.');
    s.performances.push({player:p,index:i,key,song:sq.song});settle(s);return s;
  }
  throw new Error('Unknown game action.');
}
export function replay(room) {
  let s=newRound(room,room.mode,room.seed,[],1,1);
  // Invalid commands from an old/modified client cannot corrupt another player's board.
  for(let rev=1;rev<=room.revision;rev++) {
    try {s=applyAction(s,room.events[String(rev)],room);} catch { /* ignored invalid command */ }
  }
  return s;
}
export function appendAction(room, action) {
  require(room.revision<1500 || (room.revision===1500 && action.type==='end'),'This night’s game log is full. The host can end this round and start a new night.');
  const state=applyAction(replay(room),action,room);
  const revision=room.revision+1;
  return {state, data:{revision,events:{...room.events,[String(revision)]:action}}};
}
