async function apiFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  if (res.status === 401) { window.location.href = '/'; return null; }
  return res;
}

// FastAPI puts an error's message in "detail": a string, or a list when a field is not valid, where
// pydantic puts "Value error, " before a validator's own message. The proxy's own replies have no body.
async function errorText(res) {
  try {
    const { detail } = await res.json();
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) return detail[0].msg.replace('Value error, ', '');
  } catch {}
  return res.status === 413 ? 'File too large.' : `Something went wrong (${res.status}).`;
}

// One error at a time, in the top bar, until it is dismissed or the next action starts.
function showError(text) {
  const close = document.createElement('button');
  close.textContent = '✕';
  close.title = 'Dismiss';
  close.setAttribute('aria-label', 'Dismiss');
  close.addEventListener('click', clearError);
  document.getElementById('toast').replaceChildren(text, close);
}

function clearError() {
  document.getElementById('toast').replaceChildren();
}

let ALL_TAGS = [];
let activeFilters = new Set();
let candidateQuery = '';
let uploadTags = new Set();
let chatTags = new Set();
let resumeData = [];
let editingId = null;
let confirmingDeleteId = null;
let chatResumeId = null;
let chatResumeName = null;

const FLAG_TEXT = {
  hidden_text: 'Hidden text was removed from this PDF.',
  instruction_like_text: 'This resume contains text that reads like instructions to an AI.',
};

async function loadTags() {
  try {
    const res = await fetch('/tags');
    ALL_TAGS = (await res.json()).tags;
  } catch(e) { console.error('Could not load tags', e); }
  renderFilterBar();
  renderUploadTags();
  renderChatTags();
  renderScopeLabel();
  if (resumeData.length) renderResumeList();
}

const hasAllTags = (resume, tags) => [...tags].every(t => (resume.tags || []).includes(t));

// Letters that are not a plain letter with an accent added, so removing accents leaves them as they are.
const PLAIN = { ł: 'l', ø: 'o', đ: 'd', ð: 'd', ß: 'ss', æ: 'ae', œ: 'oe', ı: 'i', þ: 'th' };

// Lowercase with accents removed, so a search for "jose garcia" finds "José García".
const fold = s => (s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
  .replace(/[^\x00-\x7f]/g, c => PLAIN[c] ?? c);

const openPickers = new Set();

// A labeled row of tag chips that adds and removes names in `selected`.
// Closed, it shows only the picked tags; Edit opens the full set.
function renderTagPicker(rowId, labelText, selected, onChange) {
  const row = document.getElementById(rowId);
  // A redraw replaces every button, so focus goes to the one now in the same place.
  const focused = [...row.querySelectorAll('button')].indexOf(document.activeElement);
  row.innerHTML = '';
  if (!ALL_TAGS.length) return;
  const open = openPickers.has(rowId);
  const redraw = () => renderTagPicker(rowId, labelText, selected, onChange);
  const label = document.createElement('span');
  label.className = 'chip-label';
  label.textContent = labelText;
  row.appendChild(label);
  const toggle = document.createElement('button');
  toggle.className = 'tag-edit';
  toggle.textContent = open ? 'Done' : 'Edit';
  toggle.addEventListener('click', () => {
    open ? openPickers.delete(rowId) : openPickers.add(rowId);
    redraw();
  });
  row.appendChild(toggle);
  for (const tag of ALL_TAGS) {
    if (!open && !selected.has(tag.name)) continue;
    const chip = document.createElement('button');
    chip.className = 'tag-chip' + (selected.has(tag.name) ? '' : ' off');
    chip.setAttribute('aria-pressed', selected.has(tag.name));
    chip.style.cssText = `--tag-bg:${tag.bg};--tag-text:${tag.text}`;
    chip.textContent = tag.name;
    chip.addEventListener('click', () => {
      selected.has(tag.name) ? selected.delete(tag.name) : selected.add(tag.name);
      redraw();
      if (onChange) onChange();
    });
    row.appendChild(chip);
  }
  if (focused !== -1) (row.querySelectorAll('button')[focused] ?? toggle).focus();
}

function renderUploadTags() {
  renderTagPicker('uploadTagRow', 'Tags', uploadTags);
}

function renderFilterBar() {
  renderTagPicker('tagFilter', 'Filter', activeFilters, renderResumeList);
}

// A question goes to one candidate or to tags, never both: picking a tag drops the candidate.
function renderChatTags() {
  renderTagPicker('chatTagRow', 'Filter', chatTags, () => {
    if (chatResumeId) clearChatCandidate();
    else renderScopeLabel();
  });
}

async function refreshResumes() {
  try {
    const res = await apiFetch('/resumes');
    if (!res) return;
    resumeData = (await res.json()).resumes;
    renderResumeList();
    renderScopeLabel();
  } catch(e) { console.error('Could not load resumes', e); }
}

// Shows US numbers one way, whatever format the resume used.
function formatPhone(p) {
  const d = (p || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p;
}

function formatUploaded(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return isNaN(d) ? '' : d.toLocaleDateString(undefined, {year: 'numeric', month: 'short', day: 'numeric'});
}

const ICONS = {
  view: "<path d='M14 4h6v6'/><path d='M20 4l-9 9'/><path d='M18 14v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h5'/>",
  download: "<path d='M12 4v11'/><path d='M7 11l5 5 5-5'/><path d='M5 20h14'/>",
  delete: "<path d='M4 7h16'/><path d='M9 7V4h6v3'/><path d='M6 7l1 13h10l1-13'/><path d='M10 11v5M14 11v5'/>",
  retry: "<path d='M20 11a8 8 0 1 0-2.3 6'/><path d='M20 5v6h-6'/>",
};

const svgIcon = name =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

function iconButton(kind, label, onClick) {
  const btn = document.createElement('button');
  btn.className = `btn-sm btn-${kind}`;
  btn.innerHTML = svgIcon(kind);
  btn.title = label;
  btn.addEventListener('click', () => onClick(btn));
  return btn;
}

// An edit box for one of a candidate's contact fields. It saves on change, and Escape puts the saved value back.
function contactInput(resume, field, className, label, maxLength) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = className;
  input.value = resume[field] || '';
  input.maxLength = maxLength;
  input.placeholder = label;
  input.autocomplete = 'off';
  input.setAttribute('aria-label', label);
  input.addEventListener('change', () => saveContact(resume.resume_id, field, input));
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') input.value = resumeData.find(r => r.resume_id === resume.resume_id)?.[field] || '';
    if (e.key === 'Enter' || e.key === 'Escape') input.blur();
  });
  return input;
}

function renderResumeList() {
  // A redraw would save and discard a value that is being typed; the next one catches up.
  if (document.activeElement?.matches('.resume-row input')) return;
  const list = document.getElementById('resumeList');
  // A redraw replaces every row, so focus goes to the same control on the same candidate, or to the list if that is gone.
  const active = document.activeElement;
  const from = active.closest('#resumeList .resume-card');
  const focused = from && `[data-id="${from.dataset.id}"] ` +
    (active.dataset.tag ? `[data-tag="${active.dataset.tag}"]` : '.' + [...active.classList].find(c => c !== 'btn-sm'));
  const refocus = () => focused && (list.querySelector(focused) ?? list).focus();
  list.innerHTML = '';
  const q = fold(candidateQuery.trim());
  // A query made only of phone characters also matches on digits, whatever the stored format.
  const qDigits = /^[\d\s().+-]+$/.test(q) ? q.replace(/\D/g, '') : '';
  const visible = resumeData.filter(r => {
    if (!hasAllTags(r, activeFilters)) return false;
    if (!q) return true;
    if (qDigits && (r.phone || '').replace(/\D/g, '').includes(qDigits)) return true;
    return [r.candidate_name, r.email, r.filename, r.phone].some(v => fold(v).includes(q));
  });
  document.getElementById('candidateCount').textContent =
    visible.length === resumeData.length ? resumeData.length || '' : `${visible.length} of ${resumeData.length}`;
  if (!visible.length) {
    list.innerHTML = '<p class="empty">' +
      (resumeData.length ? 'No candidates match.' : 'No candidates yet.') + '</p>';
    refocus();
    return;
  }
  for (const r of visible) {
    const {resume_id, filename, status, flags, tags, candidate_name, email, phone, created_at} = r;
    const editing = editingId === resume_id;
    const nameSpan = document.createElement('span');
    nameSpan.className = 'name';
    const secondary = document.createElement('span');
    secondary.className = 'cand-file';
    if (editing) {
      nameSpan.append(
        contactInput(r, 'candidate_name', 'cand-name', 'Candidate name', 200),
        contactInput(r, 'email', 'cand-email', 'Email', 254),
        contactInput(r, 'phone', 'cand-phone', 'Phone', 50),
      );
      secondary.textContent = [filename, formatUploaded(created_at)].filter(Boolean).join(' · ');
    } else {
      const primary = document.createElement('span');
      primary.className = 'cand-name';
      primary.textContent = candidate_name || filename;
      nameSpan.append(primary);
      secondary.textContent = [email, formatPhone(phone), filename, formatUploaded(created_at)].filter(Boolean).join(' · ');
    }
    nameSpan.append(secondary);
    if (flags && flags.length) {
      const warning = document.createElement('span');
      warning.className = 'cand-flag';
      warning.textContent = flags.map(f => FLAG_TEXT[f] || f).join(' ');
      nameSpan.append(warning);
    }
    const viewBtn = iconButton('view', 'View', () =>
      window.open(`/resumes/${resume_id}/file`, '_blank', 'noopener'));
    const dlBtn = iconButton('download', 'Download', () => downloadResume(resume_id, filename));
    const confirming = confirmingDeleteId === resume_id;
    const delBtn = iconButton(
      'delete',
      confirming ? 'Click again to delete' : 'Delete',
      btn => {
        if (confirmingDeleteId === resume_id) return deleteResume(resume_id, btn);
        confirmingDeleteId = resume_id;
        renderResumeList();
        list.querySelector(`[data-id="${resume_id}"] .btn-delete`).focus();
      },
    );
    if (confirming) {
      delBtn.classList.add('confirm');
      delBtn.textContent = 'Delete?';
      // The question stands until it is answered: there is no time limit, and moving focus away withdraws it.
      delBtn.addEventListener('blur', () => {
        confirmingDeleteId = null;
        delBtn.classList.remove('confirm');
        delBtn.innerHTML = svgIcon('delete');
        delBtn.title = 'Delete';
      }, { once: true });
      // A press leaves focus on the button, so the question still stands when the click lands. Safari takes focus off a pressed button.
      delBtn.addEventListener('mousedown', e => e.preventDefault());
    }
    const topRow = document.createElement('div');
    topRow.className = 'resume-row';
    topRow.append(nameSpan);
    if (status !== 'ready') {
      const statusBadge = document.createElement('span');
      statusBadge.className = `badge badge-${status}`;
      statusBadge.textContent = status === 'ingesting' ? 'processing' : status;
      topRow.appendChild(statusBadge);
    }
    if (status === 'failed') {
      topRow.append(iconButton('retry', 'Retry', btn => retryResume(resume_id, btn)));
    }
    topRow.append(viewBtn, dlBtn, delBtn);
    const tagRow = document.createElement('div');
    tagRow.className = 'tag-row' + (editing ? ' picker' : '');
    const editBtn = document.createElement('button');
    editBtn.className = 'tag-edit';
    editBtn.textContent = editing ? 'Done' : 'Edit';
    if (!editing) editBtn.title = 'Edit details and tags';
    editBtn.addEventListener('click', () => {
      editingId = editing ? null : resume_id;
      renderResumeList();
    });
    tagRow.appendChild(editBtn);
    for (const tag of ALL_TAGS) {
      const on = (tags || []).includes(tag.name);
      if (!on && !editing) continue;
      const chip = document.createElement(editing ? 'button' : 'span');
      chip.className = 'tag-chip' + (on ? '' : ' off');
      chip.style.cssText = `--tag-bg:${tag.bg};--tag-text:${tag.text}`;
      chip.textContent = tag.name;
      if (editing) {
        chip.dataset.tag = tag.name;
        chip.setAttribute('aria-pressed', on);
        chip.addEventListener('click', () => toggleTag(resume_id, chip));
      }
      tagRow.appendChild(chip);
    }
    const card = document.createElement('div');
    card.className = 'resume-card';
    card.dataset.id = resume_id;
    card.append(topRow, tagRow);
    list.appendChild(card);
  }
  refocus();
}

async function toggleTag(resumeId, chip) {
  const tagName = chip.dataset.tag;
  const idx = resumeData.findIndex(r => r.resume_id === resumeId);
  if (idx === -1) return;
  const prev = resumeData[idx].tags || [];
  const next = prev.includes(tagName) ? prev.filter(t => t !== tagName) : [...prev, tagName];
  resumeData[idx].tags = next;
  renderResumeList();
  renderScopeLabel();
  clearError();
  try {
    const res = await apiFetch(`/resumes/${resumeId}/tags`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({tags: next}),
    });
    if (!res) return;
    if (!res.ok) throw new Error(await errorText(res));
  } catch(e) {
    resumeData[idx].tags = prev;
    renderResumeList();
    renderScopeLabel();
    showError('Tag update failed: ' + e.message);
  }
}

// Not redrawn on success: the change fires as Done is clicked, and a redraw would swallow that click.
// A name is required, so an empty name box goes back to the saved name. An empty email or phone box clears that field.
async function saveContact(resumeId, field, input) {
  const resume = resumeData.find(r => r.resume_id === resumeId);
  if (!resume) return;
  const prev = resume[field] || null;
  const next = input.value.trim() || null;
  if (next === prev || (!next && field === 'candidate_name')) { input.value = prev || ''; return; }
  resume[field] = next;
  clearError();
  try {
    const res = await apiFetch(`/resumes/${resumeId}`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({[field]: next}),
    });
    if (!res) return;
    if (!res.ok) throw new Error(await errorText(res));
    if (field === 'candidate_name' && chatResumeId === resumeId) {
      chatResumeName = next;
      document.getElementById('resumeSearch').value = next;
      renderScopeLabel();
    }
  } catch(e) {
    resume[field] = prev;
    input.value = prev || '';
    renderResumeList();
    showError('Update failed: ' + e.message);
  }
}

async function retryResume(resumeId, btn) {
  btn.disabled = true;
  const statusEl = document.getElementById('listStatus');
  clearError();
  try {
    const res = await apiFetch(`/resumes/${resumeId}/retry`, {method: 'POST'});
    if (!res) return;
    if (!res.ok) throw new Error(await errorText(res));
    const idx = resumeData.findIndex(r => r.resume_id === resumeId);
    if (idx !== -1) resumeData[idx].status = 'ingesting';
    statusEl.textContent = 'Processing again…';
    renderResumeList();
    pollIngest(resumeId, statusEl);
  } catch(e) {
    btn.disabled = false;
    showError('Retry failed: ' + e.message);
  }
}

async function downloadResume(resumeId, filename) {
  clearError();
  try {
    const res = await apiFetch(`/resumes/${resumeId}/file?download=true`);
    if (!res) return;
    if (!res.ok) throw new Error(await errorText(res));
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  } catch(e) { showError('Download failed: ' + e.message); }
}

async function deleteResume(resumeId, btn) {
  btn.disabled = true;
  clearError();
  try {
    const res = await apiFetch(`/resumes/${resumeId}`, {method: 'DELETE'});
    if (!res) return;
    if (!res.ok) throw new Error(await errorText(res));
    if (chatResumeId === resumeId) clearChatCandidate();
    await refreshResumes();
    // The row and its buttons are gone, so focus goes to the list they were in.
    document.getElementById('resumeList').focus();
  } catch(e) {
    showError('Delete failed: ' + e.message);
    btn.disabled = false;
  }
}

async function uploadFile() {
  const input = document.getElementById('fileInput');
  if (!input.files.length) return;
  const btn = document.getElementById('uploadBtn');
  const status = document.getElementById('uploadStatus');
  btn.disabled = true;
  status.textContent = 'Uploading…';
  const formData = new FormData();
  formData.append('file', input.files[0]);
  if (uploadTags.size) formData.append('tags', JSON.stringify([...uploadTags]));
  clearError();
  try {
    const res = await apiFetch('/upload', {method: 'POST', body: formData});
    if (!res) return;
    if (!res.ok) throw new Error(await errorText(res));
    const data = await res.json();
    status.textContent = `Processing ${data.filename}…`;
    input.value = '';
    showFile();
    uploadTags.clear();
    openPickers.delete('uploadTagRow');
    renderUploadTags();
    await refreshResumes();
    pollIngest(data.resume_id, status);
  } catch(e) {
    status.textContent = '';
    showError('Upload failed: ' + e.message);
  } finally {
    btn.disabled = false;
  }
}

async function pollIngest(resumeId, statusEl) {
  for (let i = 0; i < 60; i++) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    try {
      const res = await apiFetch(`/resumes/${resumeId}`);
      if (!res) return;
      if (!res.ok) break;
      const data = await res.json();
      if (data.status === 'ready') {
        statusEl.textContent = `${data.filename} ready.`;
        await refreshResumes();
        return;
      }
      if (data.status === 'failed') {
        statusEl.textContent = '';
        showError(`Processing failed for ${data.filename}.`);
        await refreshResumes();
        return;
      }
    } catch { break; }
  }
  // Reached only when the checks end without a result.
  statusEl.textContent = '';
}

function renderScopeLabel() {
  let text = 'All candidates';
  if (chatResumeId) {
    text = chatResumeName;
  } else if (chatTags.size) {
    const count = resumeData.filter(r => r.status === 'ready' && hasAllTags(r, chatTags)).length;
    text = `${count} candidate${count !== 1 ? 's' : ''}`;
  }
  document.getElementById('scopeLabel').textContent = text;
  document.getElementById('scopeClear').hidden = !chatResumeId && !chatTags.size;
}

function clearChatCandidate() {
  chatResumeId = null;
  chatResumeName = null;
  document.getElementById('resumeSearch').value = '';
  setSuggestionsOpen(false);
  renderScopeLabel();
}

function clearChatTags() {
  chatTags.clear();
  renderChatTags();
  renderScopeLabel();
}

// Opens or closes the suggestion list, and tells assistive technology which.
function setSuggestionsOpen(open) {
  const input = document.getElementById('resumeSearch');
  document.getElementById('resumeSuggestions').style.display = open ? 'block' : 'none';
  input.setAttribute('aria-expanded', open);
  input.removeAttribute('aria-activedescendant');
}

function showResumeSuggestions(query) {
  const box = document.getElementById('resumeSuggestions');
  if (!query.trim()) { setSuggestionsOpen(false); return; }
  const q = fold(query.trim());
  const matches = resumeData.filter(r =>
    r.status === 'ready' &&
    [r.candidate_name, r.email, r.filename].some(v => fold(v).includes(q))
  );
  if (!matches.length) { setSuggestionsOpen(false); return; }
  box.innerHTML = '';
  for (const r of matches.slice(0, 8)) {
    const item = document.createElement('div');
    item.className = 'suggestion';
    item.id = `suggestion-${r.resume_id}`;
    item.setAttribute('role', 'option');
    const label = r.candidate_name || r.filename;
    item.textContent = label;
    item.addEventListener('click', () => {
      chatResumeId = r.resume_id;
      chatResumeName = label;
      chatTags.clear();
      renderChatTags();
      document.getElementById('resumeSearch').value = label;
      setSuggestionsOpen(false);
      renderScopeLabel();
    });
    box.appendChild(item);
  }
  setSuggestionsOpen(true);
}

async function sendMessage() {
  const input = document.getElementById('messageInput');
  const message = input.value.trim();
  if (!message) return;
  const btn = document.getElementById('sendBtn');
  if (btn.disabled) return;
  const out = document.getElementById('chatOutput');
  btn.disabled = true;
  const asked = document.createElement('p');
  asked.className = 'chat-q';
  asked.textContent = message;
  const pending = document.createElement('em');
  pending.className = 'chat-pending';
  pending.textContent = 'Thinking…';
  out.replaceChildren(asked, pending);
  try {
    const body = { message };
    if (chatResumeId) {
      body.resume_id = chatResumeId;
    } else if (chatTags.size) {
      body.tags = [...chatTags];
    }
    const res = await apiFetch('/chat', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    });
    if (!res) return;
    if (!res.ok) throw new Error(await errorText(res));
    const data = await res.json();
    const answer = document.createElement('div');
    answer.className = 'chat-a';
    answer.innerHTML = DOMPurify.sanitize(marked.parse(data.answer));
    out.replaceChildren(asked, answer);
    input.value = '';
  } catch(e) {
    const span = document.createElement('span');
    span.className = 'chat-error';
    span.textContent = 'Error: ' + e.message;
    out.replaceChildren(asked, span);
  } finally {
    btn.disabled = false;
  }
}

const fileInput = document.getElementById('fileInput');
const dropzone = document.getElementById('dropzone');
const FILE_PROMPT = document.getElementById('fileLabel').innerHTML;

function showFile() {
  const file = fileInput.files[0];
  const label = document.getElementById('fileLabel');
  if (file) label.textContent = file.name;
  else label.innerHTML = FILE_PROMPT;
  dropzone.classList.toggle('has-file', Boolean(file));
}

fileInput.addEventListener('change', showFile);
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('over'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('over'));
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('over');
  fileInput.files = e.dataTransfer.files;
  showFile();
});
document.getElementById('uploadBtn').addEventListener('click', uploadFile);
document.getElementById('sendBtn').addEventListener('click', sendMessage);
document.getElementById('messageInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') sendMessage();
});
document.getElementById('candidateSearch').addEventListener('input', e => {
  candidateQuery = e.target.value;
  renderResumeList();
});
document.getElementById('scopeClear').addEventListener('click', () => {
  if (chatResumeId) clearChatCandidate();
  else clearChatTags();
});
// The box holds the chosen candidate's name, so editing it drops the choice.
document.getElementById('resumeSearch').addEventListener('input', e => {
  if (chatResumeId) {
    chatResumeId = null;
    chatResumeName = null;
    renderScopeLabel();
  }
  showResumeSuggestions(e.target.value);
});
// A press on a suggestion leaves focus in the box, so the list is still open when the click lands.
document.getElementById('resumeSuggestions').addEventListener('mousedown', e => e.preventDefault());
// Clicking away without a pick empties the box, so it never shows a name that is not chosen.
// Switching windows keeps what was typed.
document.getElementById('resumeSearch').addEventListener('blur', e => {
  if (!chatResumeId && document.hasFocus()) e.target.value = '';
  setSuggestionsOpen(false);
});
document.getElementById('resumeSearch').addEventListener('focus', e => {
  if (e.target.value) showResumeSuggestions(e.target.value);
});
// Arrow keys move through the open list, Enter picks the highlighted name or the first, Escape closes the list.
document.getElementById('resumeSearch').addEventListener('keydown', e => {
  if (e.target.getAttribute('aria-expanded') !== 'true') return;
  const items = [...document.querySelectorAll('#resumeSuggestions .suggestion')];
  const at = items.findIndex(i => i.getAttribute('aria-selected') === 'true');
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const step = e.key === 'ArrowDown' ? 1 : -1;
    const next = items.at((at === -1 && step === -1 ? 0 : at) + step) ?? items[0];
    items[at]?.removeAttribute('aria-selected');
    next.setAttribute('aria-selected', 'true');
    e.target.setAttribute('aria-activedescendant', next.id);
    next.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    (items[at] ?? items[0]).click();
  } else if (e.key === 'Escape') {
    setSuggestionsOpen(false);
  }
});
// Escape dismisses the error toast, which can sit over the controls in the top bar.
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') clearError();
});

loadTags();
refreshResumes();
