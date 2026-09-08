const form = document.querySelector('#project-form');
const empty = document.querySelector('#empty-state');
const jobView = document.querySelector('#job-view');
const movieFile = document.querySelector('#movie-file');
let poller;

movieFile.addEventListener('change', () => {
  const file = movieFile.files[0];
  document.querySelector('#file-label').innerHTML = file ? `${file.name} <b>Change</b>` : 'Choose video file <b>Browse</b>';
  document.querySelector('#file-note').textContent = file ? `${formatBytes(file.size)} · ready to ingest locally` : 'MP4, MOV or MKV · source stays local';
});

document.querySelectorAll('.host-card input').forEach(input => input.addEventListener('change', () => {
  document.querySelectorAll('.host-card').forEach(card => card.classList.toggle('selected', card.contains(input)));
}));

form.addEventListener('submit', async event => {
  event.preventDefault();
  clearInterval(poller);
  const button = document.querySelector('#submit');
  button.disabled = true; button.textContent = 'Starting pipeline…';
  const file = movieFile.files[0];
  if (!file) { button.disabled = false; return; }
  try {
    button.textContent = 'Uploading source…';
    const uploadId = crypto.randomUUID().replaceAll('-', '');
    const upload = await fetch(`/api/uploads/${uploadId}`, {method:'PUT', headers:{'Content-Type': file.type || 'application/octet-stream','Content-Length': file.size}, body:file});
    const uploadData = await upload.json();
    if (!upload.ok) throw new Error(uploadData.error || 'Unable to ingest source file.');
    button.textContent = 'Starting pipeline…';
    const body = Object.fromEntries(new FormData(form));
    body.source = {id: uploadId, name: file.name, size: file.size};
    delete body.movie;
    const response = await fetch('/api/jobs', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    const job = await response.json();
    if (!response.ok) throw new Error(job.error || 'Unable to create project.');
    empty.hidden = true; jobView.hidden = false;
    render(job);
    poller = setInterval(async () => {
      const latest = await fetch(`/api/jobs/${job.id}`).then(r => r.json());
      render(latest);
      if (latest.status !== 'running') { clearInterval(poller); button.disabled = false; button.innerHTML = 'Create production brief <span>→</span>'; }
    }, 800);
  } catch (error) { alert(error.message); button.disabled = false; button.innerHTML = 'Create production brief <span>→</span>'; }
});

function formatBytes(bytes) { return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }

function render(job) {
  document.querySelector('#job-id').textContent = `#${job.id}`;
  document.querySelector('#result-title').textContent = job.filmTitle;
  document.querySelector('#result-question').textContent = job.angle || `Finding the central argument in ${job.filmTitle}.`;
  const isDone = job.status === 'complete';
  const pill = document.querySelector('#status-pill'); pill.textContent = isDone ? 'BRIEF READY' : 'RUNNING'; pill.classList.toggle('done', isDone);
  document.querySelector('#progress-label').textContent = isDone ? 'Production brief complete' : job.steps[job.activeStep].title;
  document.querySelector('#progress-number').textContent = `${job.progress}%`;
  document.querySelector('#progress-fill').style.width = `${job.progress}%`;
  document.querySelector('#steps').innerHTML = job.steps.map((step, index) => `<li class="${step.status}"><span class="step-icon">${step.status === 'complete' ? '✓' : step.status === 'running' ? '•' : ''}</span><div><span class="step-name">${String(index + 1).padStart(2,'0')} — ${step.title}</span></div><span class="step-artifact">${step.artifact || step.description}</span></li>`).join('');
  const card = document.querySelector('#deliverable');
  card.hidden = !job.result;
  if (job.result) { document.querySelector('#deliverable-headline').textContent = job.result.headline; document.querySelector('#deliverable-runtime').textContent = job.result.runtime; document.querySelector('#deliverable-next').textContent = job.result.nextAction; }
}
