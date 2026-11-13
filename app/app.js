async function apiFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  if (res.status === 401) { window.location.href = '/'; return null; }
  return res;
}

// ── Tag state ──────────────────────────────────────────────────────────────────
let ALL_TAGS = [];
let activeFilters = new Set();
let candidateQuery = '';
let uploadTags = new Set();
let resumeData = [];
let chatResumeId = null;
let chatResumeName = null;

async function loadTags() {
  try {
    const res = await fetch('/tags');
    ALL_TAGS = (await res.json()).tags;
  } catch(e) {
    ALL_TAGS = [
      {name:"Java",bg:"#fed7aa",text:"#7c2d12"},
      {name:"Python",bg:"#bfdbfe",text:"#1e3a8a"},
      {name:"JavaScript",bg:"#fef08a",text:"#854d0e"},
      {name:"SQL",bg:"#fbcfe8",text:"#831843"},
      {name:"Mobile",bg:"#e0e7ff",text:"#3730a3"},
      {name:"C#",bg:"#c7d2fe",text:"#3730a3"},
      {name:"R",bg:"#fce7f3",text:"#9d174d"},
      {name:"ML",bg:"#dbeafe",text:"#1e40af"},
      {name:"Kubernetes",bg:"#e0f2fe",text:"#0369a1"},
      {name:"Gen AI",bg:"#fae8ff",text:"#701a75"},
      {name:"LLMs",bg:"#ede9fe",text:"#5b21b6"},
      {name:"RAG",bg:"#a7f3d0",text:"#065f46"},
      {name:"AWS",bg:"#ffedd5",text:"#c2410c"},
      {name:"GCP",bg:"#d1fae5",text:"#166534"},
      {name:"Azure",bg:"#bae6fd",text:"#0369a1"},
      {name:"Oracle",bg:"#fca5a5",text:"#7f1d1d"},
      {name:"Data",bg:"#99f6e4",text:"#134e4a"},
      {name:"IaC",bg:"#f1f5f9",text:"#334155"},
      {name:"DevOps",bg:"#cbd5e1",text:"#1e293b"},
      {name:"Networks",bg:"#c7d2fe",text:"#312e81"},
      {name:"Security",bg:"#fecaca",text:"#7f1d1d"},
      {name:"Management",bg:"#fde68a",text:"#78350f"},
      {name:"Senior",bg:"#bbf7d0",text:"#14532d"},
      {name:"Junior",bg:"#d9f99d",text:"#365314"},
    ];
  }
  renderFilterBar();
  renderUploadTags();
  renderScopeLabel();
}

function renderUploadTags() {
  const row = document.getElementById('uploadTagRow');
  row.innerHTML = '';
  if (!ALL_TAGS.length) return;
  for (const tag of ALL_TAGS) {
    const chip = document.createElement('button');
    chip.className = 'tag-chip' + (uploadTags.has(tag.name) ? '' : ' off');
    chip.style.cssText = `background:${tag.bg};color:${tag.text}`;
    chip.textContent = tag.name;
    chip.addEventListener('click', () => {
      uploadTags.has(tag.name) ? uploadTags.delete(tag.name) : uploadTags.add(tag.name);
      chip.className = 'tag-chip' + (uploadTags.has(tag.name) ? '' : ' off');
    });
    row.appendChild(chip);
  }
}

function renderFilterBar() {
  const bar = document.getElementById('tagFilter');
  bar.innerHTML = '';
  if (!ALL_TAGS.length) return;
  const label = document.createElement('span');
  label.style.cssText = 'font-size:0.8rem;color:#6c757d;align-self:center;margin-right:2px';
  label.textContent = 'Filter:';
  bar.appendChild(label);
  for (const tag of ALL_TAGS) {
    const chip = document.createElement('button');
    chip.className = 'filter-chip ' + (activeFilters.has(tag.name) ? 'on' : 'off');
    chip.style.cssText = `background:${tag.bg};color:${tag.text}`;
    chip.textContent = tag.name;
    chip.addEventListener('click', () => {
      activeFilters.has(tag.name) ? activeFilters.delete(tag.name) : activeFilters.add(tag.name);
      renderFilterBar();
      renderResumeList();
      renderScopeLabel();
    });
    bar.appendChild(chip);
  }
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

function formatUploaded(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return isNaN(d) ? '' : d.toLocaleDateString(undefined, {year: 'numeric', month: 'short', day: 'numeric'});
}

function renderResumeList() {
  const list = document.getElementById('resumeList');
  list.innerHTML = '';
  const q = candidateQuery.trim().toLowerCase();
  const visible = resumeData.filter(r => {
    if (activeFilters.size && ![...activeFilters].every(t => (r.tags || []).includes(t))) return false;
    if (!q) return true;
    return [r.candidate_name, r.email, r.filename].some(v => (v || '').toLowerCase().includes(q));
  });
  if (!visible.length) {
    list.innerHTML = '<p class="empty">' +
      (resumeData.length ? 'No candidates match.' : 'No resumes uploaded yet.') + '</p>';
    return;
  }
  for (const r of visible) {
    const {resume_id, filename, status, flags, tags, candidate_name, email, created_at} = r;
    const nameSpan = document.createElement('span');
    nameSpan.className = 'name';
    const primary = document.createElement('span');
    primary.className = 'cand-name';
    primary.textContent = candidate_name || filename;
    const secondary = document.createElement('span');
    secondary.className = 'cand-file';
    secondary.textContent = [email, filename, formatUploaded(created_at)].filter(Boolean).join(' · ');
    nameSpan.append(primary, secondary);
    const statusBadge = document.createElement('span');
    statusBadge.className = `badge badge-${status}`;
    statusBadge.textContent = status;
    const viewBtn = document.createElement('button');
    viewBtn.className = 'btn-sm btn-view';
    viewBtn.textContent = 'View';
    viewBtn.addEventListener('click', () => window.open(`/resumes/${resume_id}/file`, '_blank', 'noopener'));
    const dlBtn = document.createElement('button');
    dlBtn.className = 'btn-sm btn-download';
    dlBtn.textContent = 'Download';
    dlBtn.addEventListener('click', () => downloadResume(resume_id, filename));
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-sm btn-delete';
    delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', () => deleteResume(resume_id, delBtn));
    const topRow = document.createElement('div');
    topRow.className = 'resume-row';
    topRow.append(nameSpan, statusBadge);
    if (flags && flags.length) {
      const warnBadge = document.createElement('span');
      warnBadge.className = 'badge badge-inject';
      warnBadge.title = 'Possible injection detected: ' + flags.join(', ');
      warnBadge.textContent = '⚠ injection risk';
      topRow.appendChild(warnBadge);
    }
    if (status === 'failed') {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'btn-sm btn-retry';
      retryBtn.textContent = 'Retry';
      retryBtn.title = 'Run the ingest again from the stored PDF';
      retryBtn.addEventListener('click', () => retryResume(resume_id, retryBtn));
      topRow.append(retryBtn);
    }
    topRow.append(viewBtn, dlBtn, delBtn);
    // Only the tags this candidate carries; click one to remove it.
    const tagRow = document.createElement('div');
    tagRow.className = 'tag-row';
    for (const tagName of tags || []) {
      const tag = ALL_TAGS.find(t => t.name === tagName);
      if (!tag) continue;
      const chip = document.createElement('button');
      chip.className = 'tag-chip';
      chip.style.cssText = `background:${tag.bg};color:${tag.text}`;
      chip.textContent = tag.name;
      chip.dataset.tag = tag.name;
      chip.title = `Remove ${tag.name}`;
      chip.addEventListener('click', () => toggleTag(resume_id, chip));
      tagRow.appendChild(chip);
    }
    const card = document.createElement('div');
    card.className = 'resume-card';
    card.append(topRow);
    if (tagRow.children.length) card.append(tagRow);
    list.appendChild(card);
  }
}

async function toggleTag(resumeId, chip) {
  const tagName = chip.dataset.tag;
  const idx = resumeData.findIndex(r => r.resume_id === resumeId);
  if (idx === -1) return;
  const prev = resumeData[idx].tags || [];
  const next = prev.includes(tagName) ? prev.filter(t => t !== tagName) : [...prev, tagName];
  // Optimistic update; the chip has to leave the row, so re-render it.
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
    if (!res.ok) throw new Error(await res.text());
  } catch(e) {
    // Rollback
    resumeData[idx].tags = prev;
    renderResumeList();
    renderScopeLabel();
    console.error('Tag update failed', e);
  }
}

async function retryResume(resumeId, btn) {
  btn.disabled = true;
  const statusEl = document.getElementById('deleteStatus');
  try {
    const res = await apiFetch(`/resumes/${resumeId}/retry`, {method: 'POST'});
    if (!res) return;
    if (!res.ok) throw new Error(await res.text());
    const idx = resumeData.findIndex(r => r.resume_id === resumeId);
    if (idx !== -1) resumeData[idx].status = 'ingesting';
    statusEl.className = 'status';
    statusEl.textContent = 'Re-running ingest…';
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
    if (!res.ok) throw new Error(await res.text());
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
  const status = document.getElementById('deleteStatus');
  btn.disabled = true;
  try {
    const res = await apiFetch(`/resumes/${resumeId}`, {method: 'DELETE'});
    if (!res) return;
    if (!res.ok) throw new Error(await res.text());
    status.className = 'status';
    status.textContent = 'Resume deleted.';
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
  const status = document.getElementById('uploadStatus');
  status.className = 'status';
  status.textContent = 'Uploading…';
  const formData = new FormData();
  formData.append('file', input.files[0]);
  if (uploadTags.size) formData.append('tags', JSON.stringify([...uploadTags]));
  try {
    const res = await apiFetch('/upload', {method: 'POST', body: formData});
    if (!res) return;
    if (!res.ok) {
      const bodyText = await res.text();
      let detail;
      try { detail = JSON.parse(bodyText)?.detail; } catch {}
      throw new Error(detail ?? bodyText);
    }
    const data = await res.json();
    status.textContent = `Ingesting ${data.filename}…`;
    uploadTags.clear();
    renderUploadTags();
    await refreshResumes();
    pollIngest(data.resume_id, status);
  } catch (e) {
    status.className = 'status error';
    status.textContent = e.message;
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
        statusEl.textContent = `${data.filename} ready.`;
        await refreshResumes();
        return;
      }
      if (data.status === 'failed') {
        statusEl.className = 'status error';
        statusEl.textContent = `Ingest failed for ${data.filename}.`;
        await refreshResumes();
        return;
      }
    } catch(e) { break; }
  }
}

function renderScopeLabel() {
  const label = document.getElementById('scopeLabel');
  if (!label) return;
  label.innerHTML = '';
  const clearBtn = () => {
    const btn = document.createElement('span');
    btn.className = 'scope-clear';
    btn.textContent = '✕ clear';
    btn.addEventListener('click', clearChatScope);
    return btn;
  };
  if (chatResumeId) {
    const strong = document.createElement('strong');
    strong.textContent = chatResumeName;
    label.append('Asking about: ', strong, ' ', clearBtn());
  } else if (activeFilters.size) {
    const matching = resumeData.filter(r =>
      r.status === 'ready' && [...activeFilters].every(t => (r.tags || []).includes(t))
    );
    const count = matching.length;
    const strong = document.createElement('strong');
    strong.textContent = `${count} resume${count !== 1 ? 's' : ''}`;
    label.append('Asking about: ', strong, ' matching filter ', clearBtn());
  } else {
    label.textContent = 'Asking about: all resumes';
  }
}

function clearChatScope() {
  chatResumeId = null;
  chatResumeName = null;
  document.getElementById('resumeSearch').value = '';
  document.getElementById('resumeSuggestions').style.display = 'none';
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
  const out = document.getElementById('chatOutput');
  out.innerHTML = '<em style="color:#6c757d">Thinking…</em>';
  try {
    const body = { message };
    if (chatResumeId) {
      body.resume_id = chatResumeId;
    } else if (activeFilters.size) {
      body.tags = [...activeFilters];
    }
    const res = await apiFetch('/chat', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    });
    if (!res) return;
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    out.innerHTML = DOMPurify.sanitize(marked.parse(data.answer));
  } catch (e) {
    const msg = document.createTextNode('Error: ' + e.message);
    const span = document.createElement('span');
    span.style.color = '#dc3545';
    span.appendChild(msg);
    out.replaceChildren(span);
  }
}

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
