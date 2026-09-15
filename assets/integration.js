/* Canonical data remains plain text. DOM textContent is the rendering boundary. */
let STUDY = null;
let PLAYER = null;
let SNAPSHOT = null;
let CATALOG = {};
let WEEK_GAMES = [];

function textElement(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

async function loadStudyContext(live) {
  STUDY = null;
  WEEK_GAMES = [];
  const values = await Promise.all([
    loadJSON('./data/player/profile.json'), loadJSON('./data/player/ratings.json'),
    ...['concepts', 'recommendations', 'crossrefs', 'chapters', 'books'].map(name => loadJSON(`./data/knowledge/${name}.json`))
  ]);
  PLAYER = values[0];
  SNAPSHOT = values[1]?.items?.at(-1);
  ['concepts', 'recommendations', 'crossrefs', 'chapters', 'books'].forEach((name, i) => {
    CATALOG[name] = Object.fromEntries((values[i + 2]?.items || []).map(row => [row.id, row]));
  });
  if (live?.week && /^\d{4}-W\d{2}$/.test(live.week.id)) {
    STUDY = await loadJSON(`./data/weeks/${live.week.id}.json`);
    if (STUDY) {
      const previous = STUDY.gamesFrom.slice(0, 10);
      // The game archive uses the ISO week of the previous Monday.
      const d = new Date(previous + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() + 3);
      const year = d.getUTCFullYear();
      const first = new Date(Date.UTC(year, 0, 4));
      const monday = new Date(first);
      monday.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));
      const week = 1 + Math.floor((new Date(previous + 'T12:00:00Z') - monday) / 604800000);
      const games = await loadJSON(`./data/games/${year}-W${String(week).padStart(2, '0')}.json`);
      WEEK_GAMES = games?.items || [];
    }
  }
  if (live?.activity && /^\d{4}-W\d{2}$/.test(live.activity.weekId)) {
    const games = await loadJSON(`./data/games/${live.activity.weekId}.json`);
    WEEK_GAMES = games?.items || [];
  }
}

function renderCurrentRatings() {
  const box = document.getElementById('current-ratings');
  box.replaceChildren();
  if (!PLAYER?.fetchedAt) return;
  const row = textElement('div', '', 'rating-row');
  for (const [speed, label] of Object.entries({rapid: 'Rapid', blitz: 'Blitz', bullet: 'Bullet', classical: 'Classical'})) {
    const rating = PLAYER.ratings[speed];
    const provisional = SNAPSHOT?.ratings?.[speed]?.provisional;
    row.append(textElement('div', `${label}  ${rating == null ? 'Unrated' : rating + (provisional ? '?' : '')}`, 'rating-item'));
  }
  box.append(row, textElement('p', `Current ratings · synced ${new Date(PLAYER.fetchedAt).toLocaleString()} · ? = provisional`, 'hint'));
}

function renderStudyPlan() {
  if (!STUDY || document.getElementById('demo-toggle').checked) return false;
  const box = document.getElementById('assignment');
  box.replaceChildren(textElement('p', 'Monday study plan · based on the previous completed week', 'kicker'),
                      textElement('p', STUDY.summary.replace('No games this week.', 'No games in that completed week.'), 'why'));
  for (const [index, focus] of STUDY.focus.entries()) {
    const section = textElement('section', '', 'study-focus');
    section.append(textElement('h4', `${index + 1}. ${CATALOG.concepts[focus.conceptId]?.name || focus.conceptId} · ${focus.minutes} min`));
    for (const id of focus.recommendationIds) {
      const recommendation = CATALOG.recommendations[id];
      for (const refId of recommendation?.crossrefIds || []) {
        const ref = CATALOG.crossrefs[refId];
        const chapter = CATALOG.chapters[ref?.chapterId];
        const book = CATALOG.books[chapter?.bookId];
        if (!chapter || !book) continue;
        const where = ref.locator;
        const pages = where.pdfPageStart ? `PDF pages ${where.pdfPageStart}–${where.pdfPageEnd}` : (where.ebookLocation || '');
        section.append(textElement('p', `${book.title} · ${chapter.ref}: ${chapter.title} · ${pages}`, 'source-ref'));
      }
    }
    section.append(textElement('p', focus.reason, 'why'));
    const list = document.createElement('ol');
    focus.exercises.forEach(exercise => list.append(textElement('li', exercise)));
    section.append(list, textElement('p', 'During play: ' + focus.playReminders.join(' '), 'gist'));
    box.append(section);
  }
  const reviews = WEEK_GAMES.flatMap(game => game.evidence.map(evidence => ({game, evidence}))).slice(0, 8);
  if (reviews.length) {
    box.append(textElement('h4', DATA.activity ? 'Current-week positions to review' : 'Positions to review'));
    for (const {game, evidence} of reviews) {
      const link = textElement('a', `${game.opponent} · move ${Math.ceil(evidence.ply / 2)} · ${evidence.signal.replaceAll('-', ' ')}`);
      link.href = `https://lichess.org/${encodeURIComponent(game.id)}/${game.color}#${evidence.ply - 1}`;
      link.target = '_blank'; link.rel = 'noopener';
      const details = document.createElement('details');
      details.append(textElement('summary', 'Engine note (read after reviewing)'), textElement('p', evidence.note));
      box.append(link, details);
    }
  }
  box.append(textElement('p', STUDY.generalReminders.join(' '), 'gist'));
  const details = document.createElement('details');
  details.append(textElement('summary', 'Scope and limitations'));
  STUDY.limitations.forEach(note => details.append(textElement('p', note)));
  box.append(details);
  return true;
}
