/* MARA Survey frontend production script */
(() => {
  'use strict';

  const API_URL = 'https://script.google.com/macros/s/AKfycbxtvrmKLdNf7JR7pMLt4lDYquUzTJrlSk1c8kYHZc587j6EDogw1f5mHZd7iXN9nRfXAQ/exec';
  const ALLOWED_ORIGIN = window.location.origin;
  const SUBMIT_COOLDOWN_MS = 30000;
  const STORAGE_KEY = 'mara_survey_last_submit_at';

  const submitBtn = document.getElementById('submitBtn');
  const mainForm = document.getElementById('mainForm');
  const successScreen = document.getElementById('successScreen');
  const pageMain = document.querySelector('main');
  const emailInput = document.getElementById('email');
  let submissionComplete = false;
  let isSubmitting = false;
  let emailAlreadyExists = false;
  let emailCheckTimer = null;
  let originalUpdateProgress = null;

  if (!submitBtn || !mainForm) return;

  injectStatusArea();
  injectSuccessBanner();
  injectHoneypotField();
  improveAccessibility();
  bindSubmit();
  takeoverProgressTracking();
  clearRestoredFormStateOnLoad();
  bindEmailLiveCheck();

  function bindSubmit() {
    submitBtn.removeAttribute('onclick');
    submitBtn.type = 'button';
    submitBtn.addEventListener('click', onSubmit);
    window.handleSubmit = onSubmit;
  }

  async function onSubmit(event) {
    if (event) event.preventDefault();
    if (submissionComplete || isSubmitting) return;

    clearMessage();

    const validation = validateRequiredFields();
    if (!validation.valid) {
      showMessage(validation.message || 'Please complete required fields before submitting.', 'error');
      validation.firstInvalid?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      validation.firstInvalid?.querySelector('input, select, textarea')?.focus();
      return;
    }

    if (isRateLimited()) {
      showMessage('You already submitted recently. Please wait about 30 seconds before trying again.', 'error');
      return;
    }

    const payload = buildPayload();

    if (!API_URL || API_URL.includes('PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE')) {
      showMessage('Submission endpoint is not configured yet. Add your Apps Script web app URL in app.js.', 'error');
      return;
    }

    setSubmitting(true);
    isSubmitting = true;
    showMessage('Submitting your response...', 'info');

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'text/plain;charset=utf-8'
  },
      
        body: JSON.stringify(payload)
      });

      const raw = await res.text();
      let data;
      try {
        data = JSON.parse(raw);
      } catch (_) {
        throw new Error('Invalid server response');
      }

      if (!res.ok || !data.success) {
        throw new Error(data?.message || 'Submission failed. Please try again.');
      }

      localStorage.setItem(STORAGE_KEY, String(Date.now()));
      showMessage(data.message || 'Survey submitted successfully.', 'success');
      showSuccessBanner(data.message || 'Survey submitted successfully.');
      completeSubmission();
    } catch (error) {
      const msg = /network/i.test(String(error?.message))
        ? 'Network error. Please check your connection and retry.'
        : error.message || 'Could not submit right now. Please try again.';
      showMessage(msg, 'error');
    } finally {
      isSubmitting = false;
      setSubmitting(false);
    }
  }

  function buildPayload() {
    const baseData = typeof window.collectData === 'function' ? window.collectData() : serializeFormFallback();
    const hp = document.getElementById('website')?.value?.trim() || '';

    return {
      ...baseData,
      metadata: {
        pageUrl: window.location.href,
        origin: ALLOWED_ORIGIN,
        language: navigator.language || '',
        platform: navigator.platform || '',
        userAgent: navigator.userAgent || '',
        submittedAtClient: new Date().toISOString()
      },
      antiSpam: {
        honeypot: hp
      }
    };
  }

  function serializeFormFallback() {
    const result = {};
    const fields = mainForm.querySelectorAll('input, select, textarea');
    fields.forEach((el) => {
      if (!el.name && !el.id) return;
      const key = el.name || el.id;
      if (el.type === 'checkbox') {
        if (!result[key]) result[key] = [];
        if (el.checked) result[key].push(el.value || true);
        return;
      }
      if (el.type === 'radio') {
        if (el.checked) result[key] = el.value;
        return;
      }
      result[key] = (el.value || '').trim();
    });
    return result;
  }

  function validateRequiredFields() {
    let valid = true;
    let firstInvalid = null;

    const checks = [
      ['f-name', (document.getElementById('name')?.value || '').trim().length > 1],
      ['f-email', (document.getElementById('email')?.value || '').trim().length > 3],
      ['f-assoc', (document.getElementById('assoc')?.value || '').trim() !== ''],
      ['f-tenure', !!document.querySelector('input[name="tenure"]:checked')],
      ['f-rating', !!document.querySelector('input[name="ratingSystem"]:checked')]
    ];

    checks.forEach(([id, ok]) => {
      const field = document.getElementById(id);
      if (!field) return;
      field.classList.toggle('invalid', !ok);
      if (!ok && !firstInvalid) firstInvalid = field;
      if (!ok) valid = false;
    });

    const consent = document.getElementById('consentCheck');
    const consentBox = consent?.closest('.consent-box');
    const consentOk = !!consent?.checked;
    if (consentBox) consentBox.style.borderColor = consentOk ? 'var(--border)' : 'var(--error)';

    if (!consentOk) {
      valid = false;
      firstInvalid = firstInvalid || consentBox;
    }

    const email = (document.getElementById('email')?.value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      valid = false;
      const field = document.getElementById('f-email');
      field?.classList.add('invalid');
      firstInvalid = firstInvalid || field;
      return { valid, firstInvalid, message: 'Please enter a valid email address.' };
    }
    if (emailAlreadyExists) {
      valid = false;
      const field = document.getElementById('f-email');
      field?.classList.add('invalid');
      firstInvalid = firstInvalid || field;
      return { valid, firstInvalid, message: 'This email has already submitted a response.' };
    }

    const phone = (document.getElementById('phone')?.value || '').trim();
    if (phone && !/^\+?[0-9\s\-()]{7,20}$/.test(phone)) {
      valid = false;
      const field = document.getElementById('f-phone');
      field?.classList.add('invalid');
      firstInvalid = firstInvalid || field;
      return { valid, firstInvalid, message: 'Please enter a valid phone number.' };
    }

    return { valid, firstInvalid };
  }

  function isRateLimited() {
    const last = Number(localStorage.getItem(STORAGE_KEY) || 0);
    return last > 0 && Date.now() - last < SUBMIT_COOLDOWN_MS;
  }

  function setSubmitting(isSubmitting) {
    submitBtn.disabled = isSubmitting;
    submitBtn.setAttribute('aria-disabled', String(isSubmitting));
    submitBtn.style.opacity = isSubmitting ? '0.75' : '1';
    submitBtn.style.cursor = isSubmitting ? 'not-allowed' : 'pointer';
    if (isSubmitting) {
      submitBtn.dataset.originalText = submitBtn.textContent;
      submitBtn.textContent = 'Submitting...';
    } else if (submitBtn.dataset.originalText) {
      submitBtn.textContent = submitBtn.dataset.originalText;
    }
  }

  function completeSubmission() {
    submissionComplete = true;
    if (mainForm) {
      mainForm.querySelectorAll('.section-card, .notice, .submit-area').forEach((el) => {
        if (el && el.id !== 'successScreen') el.style.display = 'none';
      });
    }
    if (successScreen) {
      successScreen.style.display = 'block';
      successScreen.scrollIntoView({ behavior: 'smooth' });
    }

    setProgressComplete();
    detachOriginalProgressListeners();
    clearFormState();
  }

  function setProgressComplete() {
    const progressFill = document.getElementById('progressFill');
    const progressPct = document.getElementById('progressPct');
    if (progressFill) progressFill.style.width = '100%';
    if (progressPct) progressPct.textContent = '100% complete';
  }

  function injectSuccessBanner() {
    if (!pageMain || document.getElementById('submitSuccessBanner')) return;
    const banner = document.createElement('div');
    banner.id = 'submitSuccessBanner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    banner.style.display = 'none';
    banner.style.margin = '0 0 16px 0';
    banner.style.padding = '14px 16px';
    banner.style.border = '1px solid #1E3A7B';
    banner.style.background = '#EEF2FA';
    banner.style.color = '#1E3A7B';
    banner.style.borderLeft = '6px solid #F5C842';
    banner.style.borderRadius = '6px';
    banner.style.fontWeight = '700';
    banner.textContent = 'Survey submitted successfully.';
    pageMain.insertBefore(banner, pageMain.firstChild);
  }

  function showSuccessBanner(message) {
    const banner = document.getElementById('submitSuccessBanner');
    if (!banner) return;
    banner.textContent = message;
    banner.style.display = 'block';
  }

  // Existing inline script keeps recalculating progress on input/scroll.
  // Once submit succeeds, force it to remain complete.
  function takeoverProgressTracking() {
    const baseUpdateProgress = window.updateProgress;
    if (typeof baseUpdateProgress === 'function') {
      originalUpdateProgress = baseUpdateProgress;
      document.removeEventListener('input', baseUpdateProgress);
      document.removeEventListener('change', baseUpdateProgress);
      window.removeEventListener('scroll', baseUpdateProgress);
    }

    window.updateProgress = function wrappedUpdateProgress() {
      if (submissionComplete) {
        setProgressComplete();
        return;
      }
      updateProgressByField();
    };

    document.addEventListener('input', window.updateProgress);
    document.addEventListener('change', window.updateProgress);
    window.addEventListener('scroll', window.updateProgress);
    window.updateProgress();
  }

  function updateProgressByField() {
    const fields = Array.from(document.querySelectorAll('.field'));
    let answered = 0;

    fields.forEach((field) => {
      const radios = field.querySelectorAll('input[type="radio"]');
      const checks = field.querySelectorAll('input[type="checkbox"]');
      const textInputs = field.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"], textarea');
      const selects = field.querySelectorAll('select');
      const ranges = field.querySelectorAll('input[type="range"]');
      const activeScaleButtons = field.querySelectorAll('.scale-btn.active');

      const hasRadioAnswer = radios.length > 0 && Array.from(radios).some((r) => r.checked);
      const hasCheckAnswer = checks.length > 0 && Array.from(checks).some((c) => c.checked);
      const hasTextAnswer = textInputs.length > 0 && Array.from(textInputs).some((t) => (t.value || '').trim() !== '');
      const hasSelectAnswer = selects.length > 0 && Array.from(selects).some((s) => (s.value || '').trim() !== '');
      const hasRangeAnswer = ranges.length > 0 && Array.from(ranges).some((rg) => (rg.value || '').trim() !== '');
      const hasScaleAnswer = activeScaleButtons.length > 0;

      if (hasRadioAnswer || hasCheckAnswer || hasTextAnswer || hasSelectAnswer || hasRangeAnswer || hasScaleAnswer) {
        answered += 1;
      }
    });

    const total = Math.max(fields.length, 1);
    const pct = Math.min(Math.round((answered / total) * 100), 99);
    const progressFill = document.getElementById('progressFill');
    const progressPct = document.getElementById('progressPct');
    if (progressFill) progressFill.style.width = pct + '%';
    if (progressPct) progressPct.textContent = pct + '% complete';
  }

  function detachOriginalProgressListeners() {
    if (!originalUpdateProgress) return;
    document.removeEventListener('input', originalUpdateProgress);
    document.removeEventListener('change', originalUpdateProgress);
    window.removeEventListener('scroll', originalUpdateProgress);
  }

  function injectHoneypotField() {
    if (document.getElementById('website')) return;
    const wrapper = document.createElement('div');
    wrapper.style.position = 'absolute';
    wrapper.style.left = '-9999px';
    wrapper.setAttribute('aria-hidden', 'true');
    wrapper.innerHTML = '<label for="website">Website</label><input type="text" id="website" name="website" tabindex="-1" autocomplete="off">';
    mainForm.appendChild(wrapper);
  }

  function injectStatusArea() {
    if (document.getElementById('formStatus')) return;
    const status = document.createElement('div');
    status.id = 'formStatus';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.style.marginTop = '12px';
    status.style.fontSize = '13px';
    status.style.padding = '10px 12px';
    status.style.borderRadius = '6px';
    status.style.display = 'none';
    document.getElementById('submitArea')?.appendChild(status);
  }

  function showMessage(message, type) {
    const status = document.getElementById('formStatus');
    if (!status) return;
    status.textContent = message;
    status.style.display = 'block';
    status.style.border = '1px solid var(--border)';
    status.style.background = 'var(--paper)';
    status.style.color = 'var(--ink)';

    if (type === 'error') {
      status.style.borderColor = 'var(--error)';
      status.style.background = '#fff5f4';
      status.style.color = 'var(--error)';
    }

    if (type === 'success') {
      status.style.borderColor = 'var(--navy-mid)';
      status.style.background = '#eef6ff';
      status.style.color = 'var(--navy)';
    }
  }

  function clearMessage() {
    const status = document.getElementById('formStatus');
    if (!status) return;
    status.textContent = '';
    status.style.display = 'none';
  }

  function bindEmailLiveCheck() {
    if (!emailInput) return;
    emailInput.addEventListener('input', () => {
      emailAlreadyExists = false;
      renderEmailLiveStatus('', '');
      if (emailCheckTimer) clearTimeout(emailCheckTimer);
      emailCheckTimer = setTimeout(checkEmailExistsLive, 350);
    });
    emailInput.addEventListener('blur', checkEmailExistsLive);
  }

  async function checkEmailExistsLive() {
    if (!emailInput) return;
    const email = (emailInput.value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      emailAlreadyExists = false;
      renderEmailLiveStatus('', '');
      return;
    }
    if (!API_URL || API_URL.includes('PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE')) return;

    try {
      renderEmailLiveStatus('Checking email...', 'info');
      const url = `${API_URL}?action=emailExists&email=${encodeURIComponent(email)}`;
      const res = await fetch(url, { method: 'GET' });
      const raw = await res.text();
      const data = JSON.parse(raw);
      emailAlreadyExists = !!data.exists;
      if (emailAlreadyExists) {
        renderEmailLiveStatus('This email has already been used.', 'error');
      } else {
        renderEmailLiveStatus('Email is available.', 'success');
      }
    } catch (_) {
      // Silent fallback. Final duplicate check still happens on submit server-side.
      emailAlreadyExists = false;
      renderEmailLiveStatus('', '');
    }
  }

  function renderEmailLiveStatus(text, type) {
    const el = document.getElementById('emailLiveStatus');
    if (!el) return;
    if (!text) {
      el.style.display = 'none';
      el.textContent = '';
      return;
    }
    el.style.display = 'block';
    el.textContent = text;
    if (type === 'error') {
      el.style.color = 'var(--error)';
    } else if (type === 'success') {
      el.style.color = 'var(--navy)';
    } else {
      el.style.color = 'var(--muted)';
    }
  }

  function clearFormState() {
    // Clear native form controls
    document.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"], textarea').forEach((el) => {
      el.value = '';
    });
    document.querySelectorAll('select').forEach((el) => {
      el.selectedIndex = 0;
    });
    document.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach((el) => {
      el.checked = false;
    });

    // Clear custom visual states
    document.querySelectorAll('.radio-opt.selected, .check-opt.selected').forEach((el) => el.classList.remove('selected'));
    document.querySelectorAll('.scale-btn.active').forEach((el) => el.classList.remove('active'));

    // Reset slider display if present
    const affordability = document.getElementById('affordability');
    if (affordability) {
      affordability.value = affordability.min || '1';
      if (typeof window.updateSlider === 'function') window.updateSlider();
    }
  }

  function clearRestoredFormStateOnLoad() {
    // Disable autocomplete restore behavior where possible.
    document.querySelectorAll('input, textarea, select').forEach((el) => {
      if (!el.hasAttribute('autocomplete')) el.setAttribute('autocomplete', 'off');
    });

    // BFCache/page restore can keep previous checked state; clear on fresh load/restore.
    window.addEventListener('pageshow', function () {
      if (!submissionComplete) clearFormState();
      if (typeof window.updateProgress === 'function') window.updateProgress();
    });
  }

  function improveAccessibility() {
    submitBtn.setAttribute('aria-label', 'Submit survey response');

    const requiredLabels = [
      document.querySelector('label[for="name"]') || document.querySelector('#f-name .field-label'),
      document.querySelector('label[for="email"]') || document.querySelector('#f-email .field-label')
    ];

    requiredLabels.forEach((label) => {
      if (!label) return;
      if (!label.textContent.includes('*')) {
        label.insertAdjacentHTML('beforeend', ' <span class="req" aria-hidden="true">*</span>');
      }
    });

    document.querySelectorAll('input, select, textarea, button').forEach((el) => {
      if (!el.getAttribute('aria-label') && !el.labels?.length && el.placeholder) {
        el.setAttribute('aria-label', el.placeholder);
      }
    });
  }
})();



