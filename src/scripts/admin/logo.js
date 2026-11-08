// Admin screen: the logo every page shows.
import { $$, $, api, toast, save } from './api.js';
import { bindOnce } from './form-help.js';

/* ---------- logo ---------- */
export async function showLogo() {
  bindOnce('logo', () => {
    const file = $('#logoFile'), drop = $('#logoDrop');
    const pick = (f) => {
      if (!f) return;
      if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(f.type)) { toast('Choose a PNG, JPG, WebP or SVG file.', 'error'); return; }
      if (f.size > 10 * 1024 * 1024) { toast('That file is over 10 MB.', 'error'); return; }
      const dt = new DataTransfer(); dt.items.add(f); file.files = dt.files;
      $('#logoPreview').src = URL.createObjectURL(f);
      $('#logoPreviewBox').hidden = false;
      $('#logoDropTitle').textContent = f.name;
    };
    file.addEventListener('change', () => pick(file.files[0]));
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('is-over'); }));
    drop.addEventListener('drop', (e) => pick(e.dataTransfer.files[0]));

    $('#logoForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const logoForm = e.currentTarget, f = file.files[0];
      if (!f) return toast('Choose a logo file first.', 'error');
      const fd = new FormData(); fd.append('logo', f);
      await save(logoForm.querySelector('button[type=submit]'), async () => {
        await api('/api/upload/logo', { method: 'POST', form: fd });
        logoForm.reset();
        $('#logoPreviewBox').hidden = true; $('#logoDropTitle').textContent = 'Choose or drop a file';
        await loadLogo();
      }, 'Logo saved. The website shows it now.');
    });
    $('#logoReset').addEventListener('click', (e) => save(e.currentTarget, async () => {
      await api('/api/branding', { method: 'POST', body: { logo: null } });
      await loadLogo();
    }, 'The original logo is back on the website.'));
  });
  loadLogo();
}
async function loadLogo() {
  try {
    const b = await api('/api/branding');
    const custom = b?.logo;
    $('#logoCurrent').src = custom ? `${custom}?t=${Date.now()}` : '/logo.png';
    $('#logoSource').textContent = custom ? 'An uploaded logo is in use.' : 'The original logo that ships with the website is in use.';
    $('#logoReset').hidden = !custom;
    $$('img[data-brand-logo]').forEach((img) => { img.src = custom || '/logo.png'; });
  } catch (e) { toast(e.message, 'error'); }
}
