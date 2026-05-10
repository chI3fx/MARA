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

  if (!submitBtn || !mainForm) return;

  injectStatusArea();
  injectHoneypotField();
  improveAccessibility();
  bindSubmit();

  function bindSubmit() {
    submitBtn.removeAttribute('onclick');
    submitBtn.type = 'button';
    submitBtn.addEventListener('click', onSubmit);
    window.handleSubmit = onSubmit;
  }

  async function onSubmit(event) {
    if (event) event.preventDefault();

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
      completeSubmission();
    } catch (error) {
      const msg = /network/i.test(String(error?.message))
        ? 'Network error. Please check your connection and retry.'
        : error.message || 'Could not submit right now. Please try again.';
      showMessage(msg, 'error');
    } finally {
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
      ['f-phone', (document.getElementById('phone')?.value || '').trim().length > 6],
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
    if (successScreen) {
      mainForm.style.display = 'none';
      successScreen.style.display = 'block';
      successScreen.scrollIntoView({ behavior: 'smooth' });
    }

    const progressFill = document.getElementById('progressFill');
    const progressPct = document.getElementById('progressPct');
    if (progressFill) progressFill.style.width = '100%';
    if (progressPct) progressPct.textContent = '100% complete';
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

  function improveAccessibility() {
    submitBtn.setAttribute('aria-label', 'Submit survey response');

    const requiredLabels = [
      document.querySelector('label[for="name"]') || document.querySelector('#f-name .field-label'),
      document.querySelector('label[for="phone"]') || document.querySelector('#f-phone .field-label')
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



