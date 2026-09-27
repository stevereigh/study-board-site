/* Canonical data remains plain text. DOM textContent is the rendering boundary. */
let STUDY = null;
let PLAYER = null;
let SNAPSHOT = null;
let CATALOG = {};
let PLAN_GAMES = [];
let ACTIVITY_GAMES = [];
const TASK_STORAGE_KEY = 'study-board:tasks:v1';

function textElement(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

async function loadStudyContext(live) {
  STUDY = null;
  PLAN_GAMES = [];
  ACTIVITY_GAMES = [];
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
      PLAN_GAMES = games?.items || [];
    }
  }
  if (live?.activity && /^\d{4}-W\d{2}$/.test(live.activity.weekId)) {
    const games = await loadJSON(`./data/games/${live.activity.weekId}.json`);
    ACTIVITY_GAMES = games?.items || [];
  }
}

function taskState() {
  try { return JSON.parse(localStorage.getItem(TASK_STORAGE_KEY) || '{}'); }
  catch (_) { return {}; }
}

function setTaskState(key, done) {
  const state = taskState();
  if (done) state[key] = true; else delete state[key];
  try { localStorage.setItem(TASK_STORAGE_KEY, JSON.stringify(state)); return true; }
  catch (_) { return false; }
}

function planTasks() {
  if (!STUDY) return [];
  return STUDY.focus.flatMap((focus, focusIndex) => focus.recommendationIds.map(recommendationId => ({
    key: `${STUDY.id}:${recommendationId}`, recommendationId, focus, focusIndex,
    concept: CATALOG.concepts[focus.conceptId]
  })));
}

function renderProgress() {
  const tasks = planTasks();
  const state = taskState();
  const done = tasks.filter(task => state[task.key]).length;
  document.querySelectorAll('[data-study-progress]').forEach(element => {
    element.textContent = tasks.length ? `${done}/${tasks.length} complete` : 'No tasks';
  });
  const count = document.getElementById('c-map');
  if (count) count.textContent = tasks.length ? `${done}/${tasks.length}` : '—';
}

function evidenceLink(game, evidence) {
  const link = textElement('a', `${game.opponent} · move ${Math.ceil(evidence.ply / 2)} · ${evidence.signal.replaceAll('-', ' ')}`);
  link.href = `https://lichess.org/${encodeURIComponent(game.id)}/${game.color}#${evidence.ply - 1}`;
  link.target = '_blank'; link.rel = 'noopener';
  return link;
}

function appendIssueDetails(box) {
  if (!STUDY?.review?.issues?.length) return;
  const evidence = new Map(PLAN_GAMES.flatMap(game => game.evidence.map(item => [item.id, {game, evidence: item}])));
  const heading = textElement('h4', 'Patterns found in the reviewed games');
  heading.className = 'issue-heading';
  box.append(heading);
  for (const issue of STUDY.review.issues) {
    const details = document.createElement('details');
    details.className = 'review-issue';
    const pct = issue.percentage == null ? '' : ` (${issue.percentage}%)`;
    details.append(textElement('summary', `${issue.label} · ${issue.affectedGames} of ${issue.eligibleGames} games${pct}`));
    const links = textElement('div', '', 'issue-links');
    for (const id of issue.evidenceIds.slice(0, 8)) {
      const match = evidence.get(id);
      if (match) links.append(evidenceLink(match.game, match.evidence));
    }
    if (links.childElementCount) details.append(links);
    box.append(details);
  }
}

function buildTask(task, compact = false) {
  const {focus, recommendationId, concept, focusIndex} = task;
  const recommendation = CATALOG.recommendations[recommendationId];
  const section = textElement('section', '', 'study-focus study-task');
  section.dataset.taskKey = task.key;
  const label = document.createElement('label');
  label.className = 'task-check';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox'; checkbox.checked = Boolean(taskState()[task.key]);
  const title = textElement('span', `${focusIndex + 1}. ${concept?.name || focus.conceptId} · ${focus.minutes} min`);
  label.append(checkbox, title);
  section.append(label);
  const saved = textElement('span', 'Saved on this browser', 'task-save');
  saved.hidden = true;
  checkbox.addEventListener('change', () => {
    const ok = setTaskState(task.key, checkbox.checked);
    saved.textContent = ok ? 'Saved on this browser' : 'Could not save on this browser';
    saved.hidden = false;
    document.querySelectorAll('.study-task').forEach(copy => {
      if (copy.dataset.taskKey !== task.key) return;
      copy.classList.toggle('done', checkbox.checked);
      const copyBox = copy.querySelector('input[type="checkbox"]');
      if (copyBox) copyBox.checked = checkbox.checked;
    });
    renderProgress();
  });
  section.classList.toggle('done', checkbox.checked);
  section.append(saved, textElement('p', focus.reason, 'why'));
  const seenReadings = new Set();
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
  if (!compact) {
    const list = document.createElement('ol');
    focus.exercises.forEach(exercise => list.append(textElement('li', exercise)));
    section.append(list, textElement('p', 'During play: ' + focus.playReminders.join(' '), 'gist'));
  }
  return section;
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
  const top = textElement('div', '', 'plan-topline');
  top.append(textElement('p', 'Monday review · based on the previous completed week', 'kicker'),
             textElement('span', '', 'plan-progress'));
  top.lastChild.dataset.studyProgress = '';
  const narrative = STUDY.review?.narrative || STUDY.summary.replace('No games this week.', 'No games in that completed week.');
  box.replaceChildren(top, textElement('p', narrative, 'weekly-narrative'));
  appendIssueDetails(box);
  box.append(textElement('h4', 'This week’s checklist', 'checklist-heading'));
  for (const task of planTasks()) box.append(buildTask(task));
  const reviews = PLAN_GAMES.flatMap(game => game.evidence.map(evidence => ({game, evidence}))).slice(0, 8);
  if (reviews.length) {
    box.append(textElement('h4', 'Positions from the completed week'));
    for (const {game, evidence} of reviews) {
      const details = document.createElement('details');
      details.append(textElement('summary', 'Engine note (read after reviewing)'), textElement('p', evidence.note));
      box.append(evidenceLink(game, evidence), details);
    }
  }
  box.append(textElement('p', STUDY.generalReminders.join(' '), 'gist'));
  const details = document.createElement('details');
  details.append(textElement('summary', 'Scope and limitations'));
  STUDY.limitations.forEach(note => details.append(textElement('p', note)));
  box.append(details);
  renderProgress();
  return true;
}

// Files selected here remain in this tab. They are never sent to the server.
const PRIVATE_BOOKS = new Map();
const BOOK_LIBRARY_DB = 'study-board-private-library';
const BOOK_LIBRARY_STORE = 'handles';
let BOOK_DIRECTORY = null;
let BOOK_DIRECTORY_NAME = '';
let BOOK_LIBRARY_STATUS = '';
let readingDialog;
let readerVersion = 0;

function normalizeBookWords(value) {
  const ignored = new Set(['the', 'and', 'from', 'into', 'with', 'that', 'this', 'book', 'chess', 'pdf', 'standard']);
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/)
    .filter(word => word.length >= 3 && !ignored.has(word));
}

function bookFileScore(book, filename) {
  const fileWords = new Set(normalizeBookWords(filename.replace(/\.(pdf|txt)$/i, '')));
  const identity = normalizeBookWords(`${book.title} ${(book.authors || []).join(' ')}`);
  return [...new Set(identity)].reduce((score, word) => score + (fileWords.has(word) ? word.length : 0), 0);
}

function openBookDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('Browser storage is unavailable.')); return; }
    const request = indexedDB.open(BOOK_LIBRARY_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(BOOK_LIBRARY_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storedBookDirectory() {
  const db = await openBookDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(BOOK_LIBRARY_STORE).objectStore(BOOK_LIBRARY_STORE).get('directory');
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

async function storeBookDirectory(handle) {
  const db = await openBookDatabase();
  try {
    await new Promise((resolve, reject) => {
      const request = db.transaction(BOOK_LIBRARY_STORE, 'readwrite').objectStore(BOOK_LIBRARY_STORE).put(handle, 'directory');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

async function directoryFiles(directory, depth = 0) {
  const files = [];
  for await (const entry of directory.values()) {
    if (entry.kind === 'file' && /\.(pdf|txt)$/i.test(entry.name)) files.push(entry);
    else if (entry.kind === 'directory' && depth < 2) files.push(...await directoryFiles(entry, depth + 1));
  }
  return files;
}

function refreshBookButtons() {
  document.querySelectorAll('[data-private-book]').forEach(button => {
    button.textContent = PRIVATE_BOOKS.has(button.dataset.privateBook) ? 'Open exact page' : 'Connect book folder';
  });
}

async function indexBookDirectory(directory) {
  const handles = await directoryFiles(directory);
  const rows = await Promise.all(handles.map(async handle => ({handle, file: await handle.getFile()})));
  await indexBookFiles(rows, directory.name);
  BOOK_DIRECTORY = directory;
}

async function indexBookFiles(rows, folderName) {
  for (const [bookId, saved] of PRIVATE_BOOKS) {
    if (saved.source !== 'folder') continue;
    if (saved.url) URL.revokeObjectURL(saved.url);
    PRIVATE_BOOKS.delete(bookId);
  }
  for (const book of Object.values(CATALOG.books || {})) {
    const ranked = rows.map(row => ({...row, score: bookFileScore(book, row.file.name)}))
      .filter(row => row.score >= 8)
      .sort((a, b) => b.score - a.score || Number(/\.pdf$/i.test(b.file.name)) - Number(/\.pdf$/i.test(a.file.name)));
    if (!ranked.length || PRIVATE_BOOKS.get(book.id)?.source === 'picker') continue;
    const match = ranked[0];
    PRIVATE_BOOKS.set(book.id, {file: match.file, handle: match.handle,
      type: /\.pdf$/i.test(match.file.name) ? 'pdf' : 'txt', url: null, source: 'folder'});
  }
  BOOK_DIRECTORY_NAME = folderName;
  BOOK_LIBRARY_STATUS = `${PRIVATE_BOOKS.size} of ${Object.keys(CATALOG.books || {}).length} books connected from “${folderName}”.`;
  refreshBookButtons();
}

async function connectBookDirectory(forceChoose = false) {
  if (!('showDirectoryPicker' in window)) throw new Error('Folder connection requires a Chromium browser such as Edge or Chrome.');
  let directory = !forceChoose && BOOK_DIRECTORY;
  if (directory) {
    const permission = await directory.queryPermission({mode: 'read'});
    if (permission !== 'granted' && await directory.requestPermission({mode: 'read'}) !== 'granted') directory = null;
  }
  if (!directory) directory = await window.showDirectoryPicker({mode: 'read', id: 'study-board-books'});
  await indexBookDirectory(directory);
  try { await storeBookDirectory(directory); }
  catch (_) { BOOK_LIBRARY_STATUS += ' This browser could not remember the folder after reload.'; }
  return directory;
}

async function restoreBookDirectory() {
  try {
    const directory = await storedBookDirectory();
    if (!directory) return;
    BOOK_DIRECTORY = directory;
    BOOK_DIRECTORY_NAME = directory.name;
    if (await directory.queryPermission({mode: 'read'}) === 'granted') await indexBookDirectory(directory);
    else BOOK_LIBRARY_STATUS = `Reconnect “${directory.name}” to open exact pages.`;
  } catch (_) {
    // The per-book picker remains available when persistent handles are unsupported.
  }
}

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
  const open = textElement('button', PRIVATE_BOOKS.has(chapter.bookId) ? 'Open exact page' : 'Connect book folder');
  open.type = 'button';
  open.dataset.privateBook = chapter.bookId;
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
  const intro = textElement('p', 'Connect the folder containing your chess PDFs once and recommendations open at the cited page. Edge and Chrome can remember the folder; other browsers keep it connected until reload. Files stay on this device and are never uploaded.');
  const locationNote = textElement('p', where.section || chapter.title);
  if (where.pdfPageStart) locationNote.append(document.createTextNode(` · PDF viewer page ${where.pdfPageStart}${where.pdfPageEnd > where.pdfPageStart ? '–' + where.pdfPageEnd : ''}${where.printedPages ? ' · printed pages ' + where.printedPages : ''}. Page links use the supplied PDF, including its cover pages.`));
  else if (where.ebookLocation) locationNote.append(document.createTextNode(' · ' + where.ebookLocation));
  const folderActions = textElement('div', '', 'reader-folder-actions');
  const connect = textElement('button', BOOK_DIRECTORY ? 'Reconnect book folder' : 'Connect book folder');
  connect.type = 'button';
  const replace = textElement('button', 'Choose a different folder');
  replace.type = 'button';
  replace.hidden = !BOOK_DIRECTORY;
  folderActions.append(connect, replace);
  const libraryStatus = textElement('p', BOOK_LIBRARY_STATUS, 'reader-library-status');
  const label = textElement('label', 'Or choose only this book (PDF or TXT): ');
  const picker = document.createElement('input');
  picker.type = 'file'; picker.accept = '.pdf,.txt';
  label.append(picker);
  const folderPicker = document.createElement('input');
  folderPicker.type = 'file'; folderPicker.accept = '.pdf,.txt'; folderPicker.multiple = true; folderPicker.hidden = true;
  folderPicker.setAttribute('webkitdirectory', '');
  folderActions.append(folderPicker);
  const status = textElement('p', '', 'reader-status');
  status.setAttribute('role', 'status');
  const content = textElement('div', '', 'reader-content');
  readingDialog.replaceChildren(close, heading, intro, locationNote, folderActions, libraryStatus, label, status, content);
  if (!readingDialog.open) readingDialog.showModal();

  async function display(saved) {
    content.replaceChildren();
    status.textContent = `Selected: ${saved.file.name}`;
    if (saved.type === 'pdf') {
      if (!saved.url) saved.url = URL.createObjectURL(saved.file);
      const url = saved.url + (where.pdfPageStart ? '#page=' + where.pdfPageStart : '');
      const external = textElement('a', where.pdfPageStart ? `Open full PDF at page ${where.pdfPageStart}` : 'Open PDF in a new tab');
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
  async function connectFolder(forceChoose) {
    if (!('showDirectoryPicker' in window)) {
      folderPicker.click();
      return;
    }
    libraryStatus.textContent = 'Connecting folder…';
    try {
      await connectBookDirectory(forceChoose);
      libraryStatus.textContent = BOOK_LIBRARY_STATUS;
      replace.hidden = false;
      connect.textContent = 'Reconnect book folder';
      const saved = PRIVATE_BOOKS.get(chapter.bookId);
      if (saved) await display(saved);
      else status.textContent = `No confident match for ${book.title}. Choose only this book below, or select a different folder.`;
    } catch (error) {
      libraryStatus.textContent = error?.name === 'AbortError' ? 'Folder selection cancelled.' : (error?.message || 'The folder could not be connected.');
    }
  }
  connect.addEventListener('click', () => connectFolder(false));
  replace.addEventListener('click', () => connectFolder(true));
  folderPicker.addEventListener('change', async () => {
    const files = [...folderPicker.files];
    if (!files.length) return;
    libraryStatus.textContent = 'Connecting folder…';
    try {
      const folderName = files[0].webkitRelativePath?.split('/')[0] || 'selected folder';
      await indexBookFiles(files.map(file => ({file, handle: null})), folderName);
      libraryStatus.textContent = BOOK_LIBRARY_STATUS + ' Reconnect after reloading this browser.';
      const saved = PRIVATE_BOOKS.get(chapter.bookId);
      if (saved) await display(saved);
      else status.textContent = `No confident match for ${book.title}. Choose only this book below.`;
    } catch (error) {
      libraryStatus.textContent = error?.message || 'The folder could not be connected.';
    }
  });
  picker.addEventListener('change', async () => {
    const file = picker.files[0];
    if (!file) return;
    const type = /\.pdf$/i.test(file.name) ? 'pdf' : /\.txt$/i.test(file.name) ? 'txt' : null;
    if (!type) { status.textContent = 'Choose a PDF or TXT file.'; return; }
    if (where.pdfPageStart && type !== 'pdf') { status.textContent = 'This reading uses PDF page numbers. Choose the PDF copy for the page link.'; return; }
    const previous = PRIVATE_BOOKS.get(chapter.bookId);
    if (previous?.url) URL.revokeObjectURL(previous.url);
    const saved = {file, type, url: null, source: 'picker'};
    PRIVATE_BOOKS.set(chapter.bookId, saved);
    refreshBookButtons();
    try { await display(saved); } catch { status.textContent = 'The selected file could not be read. Choose it again.'; }
  });
  const saved = PRIVATE_BOOKS.get(chapter.bookId);
  if (saved) display(saved).catch(() => { status.textContent = 'The selected file could not be read. Choose it again.'; });
}
