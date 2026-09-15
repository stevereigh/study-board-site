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
    const seenReadings = new Set();
    for (const id of focus.recommendationIds) {
      const recommendation = CATALOG.recommendations[id];
      for (const refId of recommendation?.crossrefIds || []) {
        const ref = CATALOG.crossrefs[refId];
        const chapter = CATALOG.chapters[ref?.chapterId];
        const book = CATALOG.books[chapter?.bookId];
        if (!chapter || !book) continue;
        const key = chapter.id + JSON.stringify(ref.locator);
        if (seenReadings.has(key)) continue;
        seenReadings.add(key);
        section.append(readingCard(chapter, ref.locator, true));
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

// Files selected here remain in this tab. They are never sent to the server.
const PRIVATE_BOOKS = new Map();
let readingDialog;
let readerVersion = 0;

function readingCard(chapter, where = {}, showNotes = true) {
  const book = CATALOG.books[chapter.bookId];
  const card = textElement('div', '', 'reading-card');
  card.append(textElement('strong', book.title),
    textElement('p', `${book.authors.join(', ')}${book.edition ? ' · ' + book.edition : ''}`, 'reading-edition'),
    textElement('p', 'Read: ' + (where.section || chapter.title)));
  if (where.pdfPageStart) {
    const end = where.pdfPageEnd || where.pdfPageStart;
    const range = end === where.pdfPageStart ? where.pdfPageStart : `${where.pdfPageStart}–${end}`;
    card.append(textElement('p', `PDF viewer: ${end === where.pdfPageStart ? 'page' : 'pages'} ${range}`, 'reading-pages'));
  }
  if (where.printedPages) card.append(textElement('p', `Printed book pages: ${where.printedPages}`));
  if (where.ebookLocation) card.append(textElement('p', `Text location: ${where.ebookLocation}`));
  const actions = textElement('div', '', 'reading-actions');
  if (showNotes) {
    const notes = textElement('a', 'Read study notes');
    notes.href = '#reading=' + encodeURIComponent(chapter.id);
    notes.addEventListener('click', () => { if (location.hash === notes.hash) openReadingHash(); });
    actions.append(notes);
  } else {
    const link = textElement('a', 'Link to this reading');
    link.href = '#reading=' + encodeURIComponent(chapter.id);
    actions.append(link);
  }
  const open = textElement('button', 'Open private copy');
  open.type = 'button';
  open.addEventListener('click', () => showPrivateReading(chapter, where));
  actions.append(open);
  card.append(actions);
  return card;
}

function openReadingHash() {
  if (!location.hash.startsWith('#reading=')) return;
  let id;
  try { id = decodeURIComponent(location.hash.slice(9)); } catch { return; }
  if (!LIBRARY.some(entry => entry.chapterId === id)) return;
  LIB_BOOK = 'all';
  document.getElementById('lib-search').value = '';
  document.querySelector('[data-view="library"]').click();
  renderLibChips();
  renderLibrary();
  const entry = document.getElementById('reading-' + id);
  if (!entry) return;
  entry.open = true;
  entry.querySelector('summary').focus({preventScroll: true});
  entry.scrollIntoView({behavior: 'instant', block: 'start'});
}
window.addEventListener('hashchange', openReadingHash);

function showPrivateReading(chapter, where) {
  const version = ++readerVersion;
  const book = CATALOG.books[chapter.bookId];
  if (!readingDialog) {
    readingDialog = document.createElement('dialog');
    readingDialog.className = 'private-reader';
    readingDialog.setAttribute('aria-labelledby', 'private-reader-title');
    document.body.append(readingDialog);
    readingDialog.addEventListener('close', () => {
      ++readerVersion;
      readingDialog.replaceChildren();
    });
  }
  const heading = textElement('h3', book.title);
  heading.id = 'private-reader-title';
  const close = textElement('button', 'Close reading');
  close.type = 'button';
  close.addEventListener('click', () => readingDialog.close());
  const intro = textElement('p', 'Choose your copy of this book from this device. It stays private in this tab and is not uploaded. Choose it again after reloading or on another device.');
  const locationNote = textElement('p', where.section || chapter.title);
  if (where.pdfPageStart) locationNote.append(document.createTextNode(` · PDF viewer page ${where.pdfPageStart}${where.pdfPageEnd > where.pdfPageStart ? '–' + where.pdfPageEnd : ''}${where.printedPages ? ' · printed pages ' + where.printedPages : ''}. Page links use the supplied PDF, including its cover pages.`));
  else if (where.ebookLocation) locationNote.append(document.createTextNode(' · ' + where.ebookLocation));
  const label = textElement('label', 'Choose or replace book (PDF or TXT): ');
  const picker = document.createElement('input');
  picker.type = 'file'; picker.accept = '.pdf,.txt';
  label.append(picker);
  const status = textElement('p', '', 'reader-status');
  status.setAttribute('role', 'status');
  const content = textElement('div', '', 'reader-content');
  readingDialog.replaceChildren(close, heading, intro, locationNote, label, status, content);
  if (!readingDialog.open) readingDialog.showModal();

  async function display(saved) {
    content.replaceChildren();
    status.textContent = `Selected: ${saved.file.name}`;
    if (saved.type === 'pdf') {
      const url = saved.url + (where.pdfPageStart ? '#page=' + where.pdfPageStart : '');
      const external = textElement('a', 'Open PDF in a new tab');
      external.href = url; external.target = '_blank'; external.rel = 'noopener';
      const help = textElement('p', 'If your PDF viewer does not jump automatically, enter the PDF viewer page shown above.');
      const frame = document.createElement('iframe');
      frame.title = book.title + ' — private PDF'; frame.src = url;
      content.append(external, help, frame);
    } else {
      const value = await saved.file.text();
      if (version !== readerVersion || PRIVATE_BOOKS.get(chapter.bookId) !== saved) return;
      // Match Python splitlines, including form-feed boundaries used by this catalog.
      const lines = value.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/);
      const match = /lines\s+(\d+)[-–](\d+)/i.exec(where.ebookLocation || '');
      const pre = textElement('pre', '', 'private-text');
      if (match && Number(match[2]) <= lines.length) {
        pre.textContent = lines.slice(Number(match[1]) - 1, Number(match[2])).join('\n');
        status.append(document.createTextNode(` · showing lines ${match[1]}–${match[2]}`));
      } else {
        pre.textContent = value;
        status.append(document.createTextNode(' · use your browser’s Find command to locate the section heading.'));
      }
      content.append(pre);
    }
  }
  picker.addEventListener('change', async () => {
    const file = picker.files[0];
    if (!file) return;
    const type = /\.pdf$/i.test(file.name) ? 'pdf' : /\.txt$/i.test(file.name) ? 'txt' : null;
    if (!type) { status.textContent = 'Choose a PDF or TXT file.'; return; }
    if (where.pdfPageStart && type !== 'pdf') { status.textContent = 'This reading uses PDF page numbers. Choose the PDF copy for the page link.'; return; }
    const previous = PRIVATE_BOOKS.get(chapter.bookId);
    if (previous?.url) URL.revokeObjectURL(previous.url);
    const saved = {file, type, url: type === 'pdf' ? URL.createObjectURL(new Blob([file], {type: 'application/pdf'})) : null};
    PRIVATE_BOOKS.set(chapter.bookId, saved);
    try { await display(saved); } catch { status.textContent = 'The selected file could not be read. Choose it again.'; }
  });
  const saved = PRIVATE_BOOKS.get(chapter.bookId);
  if (saved) display(saved).catch(() => { status.textContent = 'The selected file could not be read. Choose it again.'; });
}
