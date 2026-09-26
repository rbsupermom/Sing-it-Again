import {applyAction, replay} from './singo-engine.js';
import {stableStringify} from './state-data.js';

// A source ID identifies a performance, not a delivery of a snapshot. Replaying
// the shared records repairs interrupted saves without counting a song twice.
const key = value => encodeURIComponent(value).replaceAll("'", '%27');
const normalized = value => String(value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
const songIdentity = song => normalized(song.title) + '|' + normalized(song.artist);
export function iso(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
// Keep performances after midnight in the same karaoke night.
function nightDate(value) {
  const d = new Date(value);
  d.setHours(d.getHours() - 6);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function entryHistory(kind, pairId, items, uid) {
  const scope = `${kind}:${pairId}:`;
  const performances = [];
  for (const item of items) {
    if (item.status !== 'sung' || (kind === 'challenge'
      ? item.recipientUid !== uid : ![item.senderUid, item.recipientUid].includes(uid))) continue;
    const at = iso(item.completedAt) || iso(item.createdAt);
    if (!at) continue; // Wait for an acknowledged server timestamp.
    performances.push({id: scope + item.id, night: scope + item.id, at,
      estimated: !iso(item.completedAt), song: {title: item.title, artist: item.artist},
      performer: kind === 'duet' ? 'together' : 'me', label: kind === 'duet' ? 'Duet' : 'Challenge'});
  }
  return {scope, performances, nights: []};
}

export function singoHistory(pairId, room, uid, archived = false) {
  const scope = `singo:${pairId}:${room.sessionId}:`;
  let state = replay({...room, revision: 0});
  let roundPerformances = [];
  const performances = [], nights = [];
  const created = iso(room.createdAt);
  if (created && uid === room.hostUid) nights.push({id: scope, at: created, activate: !archived});
  for (let revision = 1; revision <= room.revision; revision++) {
    const action = room.events[String(revision)];
    let next;
    try { next = applyAction(state, action, room); } catch { continue; }
    const at = iso(action.at) || created;
    if (action.type === 'round') {
      performances.push(...roundPerformances);
      roundPerformances = [];
    } else if (action.type === 'sing' && at) {
      const performance = next.performances.at(-1);
      roundPerformances.push({id: scope + revision, night: scope, at,
        uid: action.actor, song: performance.song, performer: 'me', label: 'Singo-Bingo',
        estimated: !iso(action.at)});
    } else if (action.type === 'undo') {
      roundPerformances.pop();
    } else if (action.type === 'accept' && uid === room.guestUid && at && !nights.length) {
      nights.push({id: scope, at, activate: !archived});
    }
    state = next;
  }
  performances.push(...roundPerformances);
  return {scope, performances: performances.filter(p => p.uid === uid), nights};
}

export function reconcileHistory(original, batches, now = new Date().toISOString()) {
  const data = JSON.parse(JSON.stringify(original));
  data.backstageNights ||= {};
  data.queue ||= [];
  const oldPerformances = data.performances;
  const scopes = batches.map(b => b.scope);
  const desired = batches.flatMap(b => b.performances).sort((a,b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const bySource = new Map(oldPerformances.filter(p => p.backstageSource).map(p => [p.backstageSource, p]));
  const retained = oldPerformances.filter(p => !p.backstageSource || !scopes.some(scope => p.backstageSource.startsWith(scope)));
  const touched = new Set(oldPerformances.filter(p => !retained.includes(p)).map(p => p.songId));

  function sessionFor(id, at, activate) {
    const mapped = data.sessions.find(s => s.id === data.backstageNights[id]);
    if (mapped) return mapped; // A repeated snapshot must not reopen an ended night.
    const today = nightDate(at) === nightDate(now);
    const active = data.sessions.find(s => s.id === data.activeSessionId && !s.endedAt);
    const separateGameNight = id.startsWith('singo:') && Object.entries(data.backstageNights)
      .some(([source, sessionId]) => source.startsWith('singo:') && source !== id && sessionId === active?.id);
    let session = !separateGameNight && active && nightDate(active.startedAt) === nightDate(at) ? active : null;
    if (!session) session = data.sessions.find(s => s.startedAt <= at && s.endedAt && at <= s.endedAt);
    if (!session && !id.startsWith('singo:')) session = data.sessions.find(s => s.backstageDate === nightDate(at) && !s.endedAt);
    if (!session) {
      session = {id: 'backstage-night:' + key(id), name: id.startsWith('singo:') ? 'Singo-Bingo Night' : 'Karaoke Night',
        startedAt: at, endedAt: activate && today ? null : at,
        rotation: {singersAhead: 0, avgMinutes: 4}, theme: null, backstageDate: nightDate(at)};
      data.sessions.push(session);
    }
    if (activate && today && !session.endedAt) {
      if (active && active.id !== session.id) active.endedAt = at;
      data.activeSessionId = session.id;
    }
    data.backstageNights[id] = session.id;
    return session;
  }

  for (const night of batches.flatMap(b => b.nights).sort((a,b) => a.at.localeCompare(b.at))) {
    sessionFor(night.id, night.at, night.activate);
  }
  for (const source of desired) {
    const previous = bySource.get(source.id);
    let song = data.songs.find(s => s.id === previous?.songId) || data.songs.find(s => songIdentity(s) === songIdentity(source.song));
    if (!song) {
      song = {id: 'backstage-song:' + key(songIdentity(source.song)), ...source.song,
        favorite: false, ourJam: source.performer === 'together', tags: [],
        sourcePlaylists: ['Backstage'], notes: '', count: 0, lastSung: null};
      data.songs.push(song);
    }
    const session = data.sessions.find(s => s.id === previous?.sessionId) || sessionFor(source.night, source.at, !source.estimated);
    touched.add(song.id);
    retained.push({id: previous?.id || 'backstage-performance:' + key(source.id), songId: song.id,
      sessionId: session.id, sessionName: session.name, sessionTheme: session.theme || null,
      sungAt: source.at, performer: source.performer, backstageSource: source.id,
      sourceLabel: source.label, timeEstimated: source.estimated});
    if (!previous && nightDate(source.at) === nightDate(now)) data.queue = data.queue.filter(id => id !== song.id);
  }
  data.performances = retained;
  for (const id of touched) {
    const song = data.songs.find(s => s.id === id);
    if (!song) continue;
    const old = oldPerformances.filter(p => p.songId === id);
    const current = retained.filter(p => p.songId === id);
    song.count = Math.max(0, (song.count || 0) + current.length - old.length);
    // Preserve an imported last-sung value unless a removed performance supplied it.
    const removedLast = old.some(p => p.sungAt === song.lastSung && !current.some(q => q.id === p.id));
    const times = current.map(p => p.sungAt);
    if (song.lastSung && !removedLast) times.push(song.lastSung);
    song.lastSung = times.sort().at(-1) || null;
  }
  return stableStringify(data) === stableStringify(original) ? original : data;
}
