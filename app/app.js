async function apiFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  if (res.status === 401) { window.location.href = '/'; return null; }
  return res;
}

// FastAPI puts an error's message in "detail". The proxy's own replies have no body.
async function errorText(res) {
  try {
    const { detail } = await res.json();
    if (typeof detail === 'string') return detail;
  } catch {}
  return res.status === 413 ? 'File too large.' : `Something went wrong (${res.status}).`;
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

const DELETE_CONFIRM_MS = 4000;
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

const openPickers = new Set();

// A labeled row of tag chips that adds and removes names in `selected`.
// Closed, it shows only the picked tags; Edit opens the full set.
function renderTagPicker(rowId, labelText, selected, onChange) {
  const row = document.getElementById(rowId);
  row.innerHTML = '';
  if (!ALL_TAGS.length) return;
  const open = openPickers.has(rowId);
  const redraw = () => renderTagPicker(rowId, labelText, selected, onChange);
  const label = document.createElement('span');
  label.className = 'chip-label';
  label.textContent = labelText;
  row.appendChild(label);
  for (const tag of ALL_TAGS) {
    if (!open && !selected.has(tag.name)) continue;
    const chip = document.createElement('button');
    chip.className = 'tag-chip' + (selected.has(tag.name) ? '' : ' off');
    chip.style.cssText = `--tag-bg:${tag.bg};--tag-text:${tag.text}`;
    chip.textContent = tag.name;
    chip.addEventListener('click', () => {
      selected.has(tag.name) ? selected.delete(tag.name) : selected.add(tag.name);
      redraw();
      if (onChange) onChange();
    });
    row.appendChild(chip);
  }
  const toggle = document.createElement('button');
  toggle.className = 'tag-edit';
  toggle.textContent = open ? 'Done' : 'Edit';
  toggle.addEventListener('click', () => {
    open ? openPickers.delete(rowId) : openPickers.add(rowId);
    redraw();
  });
  row.appendChild(toggle);
}

function renderUploadTags() {
  renderTagPicker('uploadTagRow', 'Tags', uploadTags);
}

function renderFilterBar() {
  renderTagPicker('tagFilter', 'Filter', activeFilters, renderResumeList);
}

// A question goes to one candidate or to tags, never both: picking a tag drops the candidate.
function renderChatTags() {
  renderTagPicker('chatTagRow', 'Tags', chatTags, () => {
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
  inject: "<path d='M12 4l9 16H3z'/><path d='M12 10v4M12 17h.01'/>",
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

function renderResumeList() {
  // A redraw would save and discard a name that is being typed; the next one catches up.
  if (document.activeElement?.matches('input.cand-name')) return;
  const list = document.getElementById('resumeList');
  list.innerHTML = '';
  const q = candidateQuery.trim().toLowerCase();
  // A query made only of phone characters also matches on digits, whatever the stored format.
  const qDigits = /^[\d\s().+-]+$/.test(q) ? q.replace(/\D/g, '') : '';
  const visible = resumeData.filter(r => {
    if (!hasAllTags(r, activeFilters)) return false;
    if (!q) return true;
    if (qDigits && (r.phone || '').replace(/\D/g, '').includes(qDigits)) return true;
    return [r.candidate_name, r.email, r.filename, r.phone].some(v => (v || '').toLowerCase().includes(q));
  });
  document.getElementById('candidateCount').textContent =
    visible.length === resumeData.length ? resumeData.length || '' : `${visible.length} of ${resumeData.length}`;
  if (!visible.length) {
    list.innerHTML = '<p class="empty">' +
      (resumeData.length ? 'No candidates match.' : 'No candidates yet.') + '</p>';
    return;
  }
  for (const r of visible) {
    const {resume_id, filename, status, flags, tags, candidate_name, email, phone, created_at} = r;
    const editing = editingId === resume_id;
    const nameSpan = document.createElement('span');
    nameSpan.className = 'name';
    const primary = document.createElement(editing ? 'input' : 'span');
    primary.className = 'cand-name';
    if (editing) {
      primary.type = 'text';
      primary.value = candidate_name || '';
      primary.maxLength = 200;
      primary.placeholder = 'Candidate name';
      primary.addEventListener('change', () => renameCandidate(resume_id, primary));
      primary.addEventListener('keydown', e => {
        if (e.key === 'Escape') primary.value = resumeData.find(x => x.resume_id === resume_id)?.candidate_name || '';
        if (e.key === 'Enter' || e.key === 'Escape') primary.blur();
      });
    } else {
      primary.textContent = candidate_name || filename;
    }
    const secondary = document.createElement('span');
    secondary.className = 'cand-file';
    secondary.textContent = [email, formatPhone(phone), filename, formatUploaded(created_at)].filter(Boolean).join(' · ');
    nameSpan.append(primary, secondary);
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
        setTimeout(() => {
          if (confirmingDeleteId !== resume_id) return;
          confirmingDeleteId = null;
          renderResumeList();
        }, DELETE_CONFIRM_MS);
      },
    );
    if (confirming) {
      delBtn.classList.add('confirm');
      delBtn.textContent = 'Delete?';
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
    if (flags && flags.length) {
      const warnBadge = document.createElement('span');
      warnBadge.className = 'badge badge-inject';
      warnBadge.title = flags.map(f => FLAG_TEXT[f] || f).join('\n');
      warnBadge.innerHTML = svgIcon('inject');
      topRow.appendChild(warnBadge);
    }
    if (status === 'failed') {
      topRow.append(iconButton('retry', 'Retry', btn => retryResume(resume_id, btn)));
    }
    topRow.append(viewBtn, dlBtn, delBtn);
    const tagRow = document.createElement('div');
    tagRow.className = 'tag-row' + (editing ? ' picker' : '');
    for (const tag of ALL_TAGS) {
      const on = (tags || []).includes(tag.name);
      if (!on && !editing) continue;
      const chip = document.createElement(editing ? 'button' : 'span');
      chip.className = 'tag-chip' + (on ? '' : ' off');
      chip.style.cssText = `--tag-bg:${tag.bg};--tag-text:${tag.text}`;
      chip.textContent = tag.name;
      if (editing) {
        chip.dataset.tag = tag.name;
        chip.title = `${on ? 'Remove' : 'Add'} ${tag.name}`;
        chip.addEventListener('click', () => toggleTag(resume_id, chip));
      }
      tagRow.appendChild(chip);
    }
    const editBtn = document.createElement('button');
    editBtn.className = 'tag-edit';
    editBtn.textContent = editing ? 'Done' : 'Edit';
    if (!editing) editBtn.title = 'Edit name and tags';
    editBtn.addEventListener('click', () => {
      editingId = editing ? null : resume_id;
      renderResumeList();
    });
    tagRow.appendChild(editBtn);
    const card = document.createElement('div');
    card.className = 'resume-card';
    card.append(topRow, tagRow);
    list.appendChild(card);
  }
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
    console.error('Tag update failed', e);
  }
}

// Not redrawn on success: the change fires as Done is clicked, and a redraw would swallow that click.
async function renameCandidate(resumeId, input) {
  const resume = resumeData.find(r => r.resume_id === resumeId);
  if (!resume) return;
  const prev = resume.candidate_name;
  const next = input.value.trim();
  if (!next || next === prev) { input.value = prev || ''; return; }
  const status = document.getElementById('listStatus');
  resume.candidate_name = next;
  try {
    const res = await apiFetch(`/resumes/${resumeId}`, {
      method: 'PATCH',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({candidate_name: next}),
    });
    if (!res) return;
    if (!res.ok) throw new Error(await errorText(res));
    status.textContent = '';
    if (chatResumeId === resumeId) {
      chatResumeName = next;
      document.getElementById('resumeSearch').value = next;
      renderScopeLabel();
    }
  } catch(e) {
    resume.candidate_name = prev;
    renderResumeList();
    status.className = 'status error';
    status.textContent = 'Rename failed: ' + e.message;
  }
}

async function retryResume(resumeId, btn) {
  btn.disabled = true;
  const statusEl = document.getElementById('listStatus');
  try {
    const res = await apiFetch(`/resumes/${resumeId}/retry`, {method: 'POST'});
    if (!res) return;
    if (!res.ok) throw new Error(await errorText(res));
    const idx = resumeData.findIndex(r => r.resume_id === resumeId);
    if (idx !== -1) resumeData[idx].status = 'ingesting';
    statusEl.className = 'status';
    statusEl.textContent = 'Processing again…';
    renderResumeList();
    pollIngest(resumeId, statusEl);
  } catch(e) {
    btn.disabled = false;
    statusEl.className = 'status error';
    statusEl.textContent = 'Retry failed: ' + e.message;
  }
}

async function downloadResume(resumeId, filename) {
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
  } catch(e) { console.error('Download failed', e); }
}

async function deleteResume(resumeId, btn) {
  const status = document.getElementById('listStatus');
  btn.disabled = true;
  try {
    const res = await apiFetch(`/resumes/${resumeId}`, {method: 'DELETE'});
    if (!res) return;
    if (!res.ok) throw new Error(await errorText(res));
    status.textContent = '';
    await refreshResumes();
  } catch(e) {
    status.className = 'status error';
    status.textContent = 'Delete failed: ' + e.message;
    btn.disabled = false;
  }
}

async function uploadFile() {
  const input = document.getElementById('fileInput');
  if (!input.files.length) return;
  const btn = document.getElementById('uploadBtn');
  const status = document.getElementById('uploadStatus');
  btn.disabled = true;
  status.className = 'status';
  status.textContent = 'Uploading…';
  const formData = new FormData();
  formData.append('file', input.files[0]);
  if (uploadTags.size) formData.append('tags', JSON.stringify([...uploadTags]));
  try {
    const res = await apiFetch('/upload', {method: 'POST', body: formData});
    if (!res) return;
    if (!res.ok) throw new Error(await errorText(res));
    const data = await res.json();
    status.textContent = `Processing ${data.filename}…`;
    input.value = '';
    showFile();
    uploadTags.clear();
    renderUploadTags();
    await refreshResumes();
    pollIngest(data.resume_id, status);
  } catch(e) {
    status.className = 'status error';
    status.textContent = e.message;
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
      const data = await res.json();
      if (data.status === 'ready') {
        statusEl.className = 'status';
        statusEl.textContent = `${data.filename} ready.`;
        await refreshResumes();
        return;
      }
      if (data.status === 'failed') {
        statusEl.className = 'status error';
        statusEl.textContent = `Processing failed for ${data.filename}.`;
        await refreshResumes();
        return;
      }
    } catch { break; }
  }
}

function renderScopeLabel() {
  const label = document.getElementById('scopeLabel');
  label.innerHTML = '';
  const clearBtn = onClick => {
    const btn = document.createElement('span');
    btn.className = 'scope-clear';
    btn.textContent = '✕ clear';
    btn.addEventListener('click', onClick);
    return btn;
  };
  if (chatResumeId) {
    const strong = document.createElement('strong');
    strong.textContent = chatResumeName;
    label.append('Asking about: ', strong, ' ', clearBtn(clearChatCandidate));
  } else if (chatTags.size) {
    const count = resumeData.filter(r => r.status === 'ready' && hasAllTags(r, chatTags)).length;
    const strong = document.createElement('strong');
    strong.textContent = `${count} candidate${count !== 1 ? 's' : ''}`;
    label.append('Asking about: ', strong, ' ', clearBtn(clearChatTags));
  } else {
    label.textContent = 'Asking about: all candidates';
  }
}

function clearChatCandidate() {
  chatResumeId = null;
  chatResumeName = null;
  document.getElementById('resumeSearch').value = '';
  document.getElementById('resumeSuggestions').style.display = 'none';
  renderScopeLabel();
}

function clearChatTags() {
  chatTags.clear();
  renderChatTags();
  renderScopeLabel();
}

function showResumeSuggestions(query) {
  const box = document.getElementById('resumeSuggestions');
  if (!query.trim()) { box.style.display = 'none'; return; }
  const q = query.toLowerCase();
  const matches = resumeData.filter(r =>
    r.status === 'ready' &&
    [r.candidate_name, r.email, r.filename].some(v => (v || '').toLowerCase().includes(q))
  );
  if (!matches.length) { box.style.display = 'none'; return; }
  box.innerHTML = '';
  for (const r of matches.slice(0, 8)) {
    const item = document.createElement('div');
    item.className = 'suggestion';
    const label = r.candidate_name || r.filename;
    item.textContent = label;
    item.addEventListener('click', () => {
      chatResumeId = r.resume_id;
      chatResumeName = label;
      chatTags.clear();
      renderChatTags();
      document.getElementById('resumeSearch').value = label;
      box.style.display = 'none';
      renderScopeLabel();
    });
    box.appendChild(item);
  }
  box.style.display = 'block';
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
document.getElementById('resumeSearch').addEventListener('input', e => {
  showResumeSuggestions(e.target.value);
});
document.getElementById('resumeSearch').addEventListener('blur', () => {
  setTimeout(() => { document.getElementById('resumeSuggestions').style.display = 'none'; }, 150);
});
document.getElementById('resumeSearch').addEventListener('focus', e => {
  if (e.target.value) showResumeSuggestions(e.target.value);
});

loadTags();
refreshResumes();
