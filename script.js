// ==================== RECAPTCHA ====================
const RECAPTCHA_SITE_KEY = '6LdWypksAAAAAF85hcep1YR2KHGGccsddgb4mWLE';

// ==================== MOBILE NAV TOGGLE ====================
const navToggle = document.getElementById('navToggle');
const navLinks  = document.getElementById('navLinks');

if (navToggle && navLinks) {
  navToggle.addEventListener('click', () => {
    const isOpen = navLinks.classList.toggle('is-open');
    navToggle.setAttribute('aria-expanded', isOpen);
  });

  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      navLinks.classList.remove('is-open');
      navToggle.setAttribute('aria-expanded', 'false');
    });
  });

  document.addEventListener('click', (e) => {
    if (!navToggle.contains(e.target) && !navLinks.contains(e.target)) {
      navLinks.classList.remove('is-open');
      navToggle.setAttribute('aria-expanded', 'false');
    }
  });
}

// ==================== AVAILABILITY CALENDAR ====================
const dateInput = document.getElementById('date');
const timeSlotSelect = document.getElementById('timeSlot');
const calDays = document.getElementById('calDays');
const calMonth = document.getElementById('calMonth');
const calPrev = document.getElementById('calPrev');
const calNext = document.getElementById('calNext');
const selectedDateDisplay = document.getElementById('selectedDateDisplay');

let calYear = new Date().getFullYear();
let calMonthNum = new Date().getMonth() + 1;
let calData = {};
let selectedCalDate = null;

const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

async function loadCalendarMonth(year, month) {
  try {
    const res = await fetch(`/api/availability/month?year=${year}&month=${month}`);
    const data = await res.json();
    if (data.success) calData = data.calendar;
  } catch { calData = {}; }
  renderCalendar(year, month);
}

function renderCalendar(year, month) {
  if (!calDays || !calMonth) return;
  calMonth.textContent = `${monthNames[month - 1]} ${year}`;

  const firstDay = new Date(year, month - 1, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month, 0).getDate();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Adjust firstDay to Monday-start (0=Mon)
  const startOffset = (firstDay === 0 ? 6 : firstDay - 1);

  let html = '';
  // Empty cells before first day
  for (let i = 0; i < startOffset; i++) {
    html += '<div class="avail-calendar__cell avail-calendar__cell--empty"></div>';
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dateObj = new Date(year, month - 1, d);
    const isPast = dateObj < tomorrow;
    const info = calData[dateStr] || { status: 'open' };
    const isSelected = dateStr === selectedCalDate;

    let cls = 'avail-calendar__cell';
    if (isPast) cls += ' avail-calendar__cell--past';
    else cls += ` avail-calendar__cell--${info.status}`;
    if (isSelected) cls += ' avail-calendar__cell--selected';

    html += `<div class="${cls}" data-date="${dateStr}" ${isPast ? '' : 'role="button" tabindex="0"'}>${d}</div>`;
  }

  calDays.innerHTML = html;

  // Click handlers
  calDays.querySelectorAll('[data-date]').forEach(cell => {
    if (cell.classList.contains('avail-calendar__cell--past') || cell.classList.contains('avail-calendar__cell--full')) return;
    cell.addEventListener('click', () => selectCalDate(cell.dataset.date));
  });
}

function selectCalDate(dateStr) {
  selectedCalDate = dateStr;
  if (dateInput) dateInput.value = dateStr;
  if (selectedDateDisplay) {
    const d = new Date(dateStr + 'T12:00:00');
    selectedDateDisplay.textContent = `Selected: ${d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`;
    selectedDateDisplay.style.display = 'block';
  }
  renderCalendar(calYear, calMonthNum);
  loadTimeSlots(dateStr);
}

if (calPrev) {
  calPrev.addEventListener('click', () => {
    calMonthNum--;
    if (calMonthNum < 1) { calMonthNum = 12; calYear--; }
    loadCalendarMonth(calYear, calMonthNum);
  });
}
if (calNext) {
  calNext.addEventListener('click', () => {
    calMonthNum++;
    if (calMonthNum > 12) { calMonthNum = 1; calYear++; }
    loadCalendarMonth(calYear, calMonthNum);
  });
}

// Initial calendar load
if (calDays) loadCalendarMonth(calYear, calMonthNum);

// ==================== TIME SLOT LOADING (duration-aware) ====================
function getTotalDuration() {
  if (!serviceDropdown) return 120;
  let total = 0;
  serviceDropdown.querySelectorAll('input:checked').forEach(cb => {
    if (cb.value === '__custom__') return;
    const svc = servicesData.find(s => s.name === cb.value);
    if (svc) total += (svc.duration_minutes || 120);
  });
  return total || 120;
}

async function loadTimeSlots(date) {
  if (!timeSlotSelect) return;
  if (!date) {
    timeSlotSelect.innerHTML = '<option value="" selected>Select a date from calendar…</option>';
    timeSlotSelect.disabled = true;
    return;
  }

  const duration = getTotalDuration();
  timeSlotSelect.innerHTML = '<option value="">Loading…</option>';
  timeSlotSelect.disabled = true;

  try {
    const res = await fetch(`/api/availability?date=${date}&duration=${duration}`);
    const data = await res.json();
    if (data.success && data.available.length > 0) {
      const options = data.available.map(s => {
        if (typeof s === 'string') return `<option value="${s}">${s}</option>`;
        return `<option value="${s.value}">${s.label} (${s.slots} slots)</option>`;
      });
      timeSlotSelect.innerHTML = '<option value="">No preference</option>' + options.join('');
      timeSlotSelect.disabled = false;
    } else {
      timeSlotSelect.innerHTML = '<option value="">No slots available</option>';
      timeSlotSelect.disabled = true;
    }
  } catch {
    timeSlotSelect.innerHTML = '<option value="">Could not load slots — please try again</option>';
    timeSlotSelect.disabled = true;
  }
}


// ==================== LOAD SERVICES FROM API ====================
let servicesData = [];
const servicePicker = document.getElementById('servicePicker');
const serviceSelected = document.getElementById('serviceSelected');
const serviceDropdown = document.getElementById('serviceDropdown');
const servicePlaceholder = document.getElementById('servicePlaceholder');
const serviceHidden = document.getElementById('service');
const customServiceWrap = document.getElementById('customServiceWrap');
const customServiceInput = document.getElementById('customService');
const calcServices = document.getElementById('calcServices');
const calcTotal = document.getElementById('calcTotal');

async function loadServices() {
  try {
    const res = await fetch('/api/services');
    const data = await res.json();
    if (data.success) servicesData = data.services;
  } catch {
    servicesData = [
      { name: 'Flat Tire Repair', emoji: '🛞', price: 199, duration: '~30 min', duration_minutes: 30 },
      { name: 'Brake Adjustment', emoji: '🛑', price: 149, duration: '~20 min', duration_minutes: 20 },
      { name: 'Gear & Derailleur Tuning', emoji: '⚙️', price: 249, duration: '~35 min', duration_minutes: 35 },
      { name: 'Chain Service', emoji: '⛓️', price: 179, duration: '~25 min', duration_minutes: 25 },
      { name: 'Full Bike Tune-Up', emoji: '🔧', price: 599, duration: '~90 min', duration_minutes: 90 },
      { name: 'Wheel Truing', emoji: '☸️', price: 199, duration: '~40 min', duration_minutes: 40 },
      { name: 'Bike Assembly', emoji: '🔩', price: 399, duration: '~60 min', duration_minutes: 60 },
      { name: 'General Inspection', emoji: '🔍', price: 149, duration: '~30 min', duration_minutes: 30 },
    ];
  }
  renderServicePicker();
  renderCalculator();
}

// ==================== SERVICE PICKER (multi-select for form) ====================
function renderServicePicker() {
  if (!serviceDropdown) return;
  let html = servicesData.map(s =>
    `<label class="service-picker__item"><input type="checkbox" value="${s.name}" data-price="${s.price}" data-duration="${s.duration_minutes || 120}" /><span>${s.emoji} ${s.name}</span><small>${s.price} DKK</small></label>`
  ).join('');
  html += `<label class="service-picker__item"><input type="checkbox" value="__custom__" data-price="0" data-duration="60" /><span>❓ Other / Custom</span><small>—</small></label>`;
  serviceDropdown.innerHTML = html;
}

function updateServicePicker() {
  if (!serviceDropdown) return;
  const checked = serviceDropdown.querySelectorAll('input:checked');
  const names = [];
  let hasCustom = false;

  checked.forEach(cb => {
    if (cb.value === '__custom__') {
      hasCustom = true;
    } else {
      names.push(cb.value);
    }
  });

  if (customServiceWrap) customServiceWrap.style.display = hasCustom ? 'block' : 'none';

  const customText = hasCustom && customServiceInput ? customServiceInput.value.trim() : '';
  const allServices = [...names];
  if (customText) allServices.push(customText);
  else if (hasCustom) allServices.push('Custom service (see details)');

  if (serviceHidden) serviceHidden.value = allServices.join(', ');

  const tags = serviceSelected.querySelectorAll('.service-picker__tag');
  tags.forEach(t => t.remove());

  const displayNames = hasCustom ? [...names, customText || 'Custom service'] : names;

  if (displayNames.length > 0) {
    if (servicePlaceholder) servicePlaceholder.style.display = 'none';
    displayNames.forEach(name => {
      const tag = document.createElement('span');
      tag.className = 'service-picker__tag';
      const dataVal = name === (customText || 'Custom service') ? '__custom__' : name;
      tag.innerHTML = `${name} <span class="service-picker__tag-remove" data-service="${dataVal}">&times;</span>`;
      serviceSelected.appendChild(tag);
    });
  } else {
    if (servicePlaceholder) servicePlaceholder.style.display = 'inline';
  }

  // Estimate in dropdown
  let est = serviceDropdown.querySelector('.service-picker__estimate');
  const total = Array.from(checked).reduce((sum, cb) => sum + (parseInt(cb.dataset.price, 10) || 0), 0);
  if (total > 0) {
    if (!est) {
      est = document.createElement('div');
      est.className = 'service-picker__estimate';
      serviceDropdown.appendChild(est);
    }
    est.textContent = `Estimated total: ${total.toLocaleString()} DKK (incl. 25% VAT)`;
  } else if (est) {
    est.remove();
  }

  // Reload time slots if date is selected (duration may have changed)
  if (selectedCalDate) loadTimeSlots(selectedCalDate);
}

if (servicePicker) {
  serviceSelected.addEventListener('click', (e) => {
    if (e.target.classList.contains('service-picker__tag-remove')) {
      const val = e.target.dataset.service;
      const cb = serviceDropdown.querySelector(`input[value="${val}"]`);
      if (cb) cb.checked = false;
      updateServicePicker();
      return;
    }
    servicePicker.classList.toggle('open');
  });

  serviceDropdown.addEventListener('change', () => updateServicePicker());

  document.addEventListener('click', (e) => {
    if (!servicePicker.contains(e.target)) servicePicker.classList.remove('open');
  });
}

if (customServiceInput) {
  customServiceInput.addEventListener('input', () => updateServicePicker());
}

// ==================== ADDRESS AUTOCOMPLETE + ZONE DETECTION ====================
const addressInput = document.getElementById('address');
const zoneDisplay = document.getElementById('zoneDisplay');
const zoneLabelEl = document.getElementById('zoneLabel');
const suggestionsList = document.getElementById('addressSuggestions');
let currentZone = '';
let currentZoneSurcharge = 0;
let addressDebounce = null;
let activeIdx = -1;

function closeSuggestions() {
  if (suggestionsList) { suggestionsList.classList.remove('open'); suggestionsList.innerHTML = ''; }
  activeIdx = -1;
}

async function lookupZone(addr, lat, lng) {
  try {
    let url = `/api/zone/lookup?address=${encodeURIComponent(addr)}`;
    if (lat && lng) url += `&lat=${lat}&lng=${lng}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.success) {
      currentZone = data.zone;
      currentZoneSurcharge = data.surcharge;
      if (zoneLabelEl) zoneLabelEl.textContent = data.label;
      if (zoneDisplay) zoneDisplay.style.display = 'flex';
    }
  } catch {
    if (zoneDisplay) zoneDisplay.style.display = 'none';
  }
}

function selectSuggestion(displayName, lat, lng) {
  addressInput.value = displayName;
  closeSuggestions();
  lookupZone(displayName, lat, lng);
}

if (addressInput && suggestionsList) {
  addressInput.addEventListener('input', () => {
    clearTimeout(addressDebounce);
    const q = addressInput.value.trim();

    if (q.length < 3) {
      closeSuggestions();
      if (zoneDisplay) zoneDisplay.style.display = 'none';
      currentZone = '';
      currentZoneSurcharge = 0;
      return;
    }

    addressDebounce = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=dk&viewbox=12.4,55.75,12.75,55.60&bounded=1&limit=5&addressdetails=1`,
          { headers: { 'Accept-Language': 'en' } }
        );
        const results = await res.json();
        if (!results.length) { closeSuggestions(); return; }

        activeIdx = -1;
        suggestionsList.innerHTML = results.map((r, i) => {
          const parts = r.display_name.split(', ');
          const main = parts.slice(0, 2).join(', ');
          const secondary = parts.slice(2, 4).join(', ');
          return `<li class="address-autocomplete__item" data-idx="${i}" data-name="${r.display_name.replace(/"/g, '&quot;')}" data-lat="${r.lat}" data-lng="${r.lon}">
            <span class="address-autocomplete__icon">&#128205;</span>
            <div class="address-autocomplete__text">
              <strong>${main}</strong>
              <span>${secondary}</span>
            </div>
          </li>`;
        }).join('');

        suggestionsList.classList.add('open');

        suggestionsList.querySelectorAll('.address-autocomplete__item').forEach(item => {
          item.addEventListener('mousedown', (e) => {
            e.preventDefault();
            selectSuggestion(item.dataset.name, item.dataset.lat, item.dataset.lng);
          });
        });
      } catch {
        closeSuggestions();
      }
    }, 350);
  });

  // Keyboard navigation
  addressInput.addEventListener('keydown', (e) => {
    const items = suggestionsList.querySelectorAll('.address-autocomplete__item');
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, items.length - 1);
      items.forEach((el, i) => el.classList.toggle('active', i === activeIdx));
      items[activeIdx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
      items.forEach((el, i) => el.classList.toggle('active', i === activeIdx));
      items[activeIdx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      selectSuggestion(items[activeIdx].dataset.name, items[activeIdx].dataset.lat, items[activeIdx].dataset.lng);
    } else if (e.key === 'Escape') {
      closeSuggestions();
    }
  });

  addressInput.addEventListener('blur', () => setTimeout(closeSuggestions, 200));
}


// ==================== LIVE AVAILABILITY COUNTER ====================
async function loadAvailabilityCounter() {
  const counterEl = document.getElementById('availabilityCounter');
  const slotsCountEl = document.getElementById('slotsCount');
  if (!counterEl || !slotsCountEl) return;

  try {
    const res = await fetch('/api/availability/week-count');
    const data = await res.json();
    if (data.success && data.remaining <= 15) {
      slotsCountEl.textContent = data.remaining;
      counterEl.style.display = 'flex';
      if (data.remaining <= 5) counterEl.classList.add('availability-counter--urgent');
    }
  } catch { /* silent */ }
}

loadAvailabilityCounter();

// ==================== PRICING CALCULATOR ====================
function renderCalculator() {
  if (!calcServices) return;
  const popular = 'Full Bike Tune-Up';
  calcServices.innerHTML = servicesData.map(s =>
    `<label class="calc__option${s.name === popular ? ' calc__option--popular' : ''}">
      <input type="checkbox" value="${s.price}" data-name="${s.name}" />
      <span class="calc__check"></span>
      <span class="calc__label">${s.emoji} ${s.name}</span>
      <span class="calc__price">${s.price} DKK</span>
    </label>`
  ).join('');
}

if (calcServices && calcTotal) {
  calcServices.addEventListener('change', () => {
    const checked = calcServices.querySelectorAll('input:checked');
    let total = 0;
    checked.forEach(cb => { total += parseInt(cb.value, 10); });
    calcTotal.textContent = total.toLocaleString() + ' DKK (incl. VAT)';
    calcTotal.classList.add('bump');
    setTimeout(() => calcTotal.classList.remove('bump'), 150);
  });

  const calcCta = document.querySelector('.calc__cta');
  if (calcCta && serviceDropdown) {
    calcCta.addEventListener('click', (e) => {
      e.preventDefault();
      serviceDropdown.querySelectorAll('input').forEach(cb => { cb.checked = false; });

      calcServices.querySelectorAll('input:checked').forEach(calcCb => {
        const calcName = calcCb.dataset.name;
        const formCb = serviceDropdown.querySelector(`input[value="${calcName}"]`);
        if (formCb) formCb.checked = true;
      });

      updateServicePicker();

      const bookingSection = document.getElementById('booking');
      if (bookingSection) {
        const navHeight = document.getElementById('nav')?.offsetHeight || 96;
        const top = bookingSection.getBoundingClientRect().top + window.scrollY - navHeight - 8;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    });
  }
}

loadServices();

// ==================== PHOTO UPLOAD PREVIEW ====================
const photoInput = document.getElementById('photo');
const photoPlaceholder = document.getElementById('photoPlaceholder');
const photoPreview = document.getElementById('photoPreview');
const photoThumb = document.getElementById('photoThumb');
const photoRemove = document.getElementById('photoRemove');
const photoUpload = document.getElementById('photoUpload');

if (photoInput) {
  photoInput.addEventListener('change', () => {
    const file = photoInput.files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        alert('Photo must be under 5MB.');
        photoInput.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        photoThumb.src = e.target.result;
        photoPlaceholder.style.display = 'none';
        photoPreview.style.display = 'inline-block';
        photoUpload.classList.add('has-file');
      };
      reader.readAsDataURL(file);
    }
  });

  if (photoRemove) {
    photoRemove.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      photoInput.value = '';
      photoPlaceholder.style.display = 'flex';
      photoPreview.style.display = 'none';
      photoUpload.classList.remove('has-file');
    });
  }
}

// ==================== PROMO CODE ====================
let appliedPromo = null;
const promoInput = document.getElementById('promoCode');
const promoBtn = document.getElementById('promoApplyBtn');
const promoMsg = document.getElementById('promoMsg');

async function applyPromo() {
  const code = promoInput.value.trim();
  if (!code) { showPromoMsg('Enter a promo code first.', false); return; }

  let subtotal = 0;
  if (serviceDropdown) {
    serviceDropdown.querySelectorAll('input:checked').forEach(cb => {
      subtotal += parseInt(cb.dataset.price, 10) || 0;
    });
  }

  const emailField = document.getElementById('email');
  const phoneField = document.getElementById('phone');
  const emailVal = emailField ? emailField.value.trim() : '';
  const phoneVal = phoneField ? phoneField.value.trim() : '';

  try {
    const res = await fetch(`/api/promo/validate?code=${encodeURIComponent(code)}&subtotal=${subtotal}&email=${encodeURIComponent(emailVal)}&phone=${encodeURIComponent(phoneVal)}`);
    const data = await res.json();
    if (data.success) {
      appliedPromo = data;
      showPromoMsg(`${data.label} applied! You save ${data.discount.toLocaleString()} DKK`, true);
      promoInput.readOnly = true;
      promoBtn.textContent = 'Remove';
    } else {
      appliedPromo = null;
      showPromoMsg(data.message, false);
    }
  } catch {
    showPromoMsg('Could not validate code. Try again.', false);
  }
}

function removePromo() {
  appliedPromo = null;
  if (promoInput) { promoInput.readOnly = false; promoInput.value = ''; }
  if (promoMsg) { promoMsg.textContent = ''; promoMsg.className = 'promo-msg'; }
  if (promoBtn) promoBtn.textContent = 'Apply';
}

if (promoBtn) {
  promoBtn.addEventListener('click', () => {
    if (appliedPromo) removePromo();
    else applyPromo();
  });
}

function showPromoMsg(text, ok) {
  if (!promoMsg) return;
  promoMsg.textContent = text;
  promoMsg.className = 'promo-msg ' + (ok ? 'promo-msg--ok' : 'promo-msg--err');
}

// ==================== FORM SUBMISSION ====================
const form = document.getElementById('bookingForm');

if (form) {
  const submitBtn = form.querySelector('button[type="submit"]');
  const originalBtnText = submitBtn ? submitBtn.textContent : 'Book My Repair →';

  let formMessage = document.getElementById('formMessage');
  if (!formMessage) {
    formMessage = document.createElement('p');
    formMessage.id = 'formMessage';
    formMessage.style.display = 'none';
    form.appendChild(formMessage);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name    = (document.getElementById('fullName')?.value || '').trim();
    const email   = (document.getElementById('email')?.value || '').trim();
    const phone   = (document.getElementById('phone')?.value || '').trim();
    const service = (document.getElementById('service')?.value || '');
    const date    = (document.getElementById('date')?.value || '');
    const address = (document.getElementById('address')?.value || '').trim();
    const timeSlot = (document.getElementById('timeSlot')?.value || '');
    const details = (document.getElementById('details')?.value || '').trim();
    const website = (document.getElementById('website')?.value || '');

    if (!name || name.length < 2) {
      document.getElementById('fullName')?.focus();
      showFormMessage(formMessage, '✗ Please enter your full name.', 'error');
      return;
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      document.getElementById('email')?.focus();
      showFormMessage(formMessage, '✗ Please enter a valid email address.', 'error');
      return;
    }
    if (!service) {
      if (servicePicker) servicePicker.classList.add('open');
      showFormMessage(formMessage, '✗ Please select at least one service.', 'error');
      return;
    }
    if (!date) {
      showFormMessage(formMessage, '✗ Please select a preferred date from the calendar.', 'error');
      return;
    }
    if (!address || address.length < 5) {
      document.getElementById('address')?.focus();
      showFormMessage(formMessage, '✗ Please enter your full address.', 'error');
      return;
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.classList.add('btn--loading');
    }
    formMessage.style.display = 'none';

    try {
      const formData = new FormData();
      formData.append('name', name);
      formData.append('email', email);
      formData.append('phone', phone);
      formData.append('service', service);
      formData.append('date', date);
      formData.append('timeSlot', timeSlot);
      formData.append('address', address);
      formData.append('details', details);
      formData.append('website', website);
      formData.append('durationMinutes', getTotalDuration());

      // Zone info
      if (currentZone) {
        formData.append('zone', currentZone);
        formData.append('zoneSurcharge', currentZoneSurcharge);
      }


      // Calculate price
      if (serviceDropdown) {
        const checkedBoxes = serviceDropdown.querySelectorAll('input:checked');
        let subtotal = 0;
        checkedBoxes.forEach(cb => { subtotal += parseInt(cb.dataset.price, 10) || 0; });
        subtotal += currentZoneSurcharge;
        formData.append('subtotal', subtotal);

        let discount = 0;
        if (appliedPromo && appliedPromo.discount > 0) {
          discount = appliedPromo.discount;
        }
        formData.append('discount', discount);

        const finalPrice = Math.max(0, subtotal - discount);
        if (finalPrice > 0) formData.append('price', finalPrice);
      }

      // Include promo code if applied
      if (appliedPromo && appliedPromo.code) {
        formData.append('promoCode', appliedPromo.code);
      }

      // Attach photo if selected
      const photoFile = document.getElementById('photo')?.files[0];
      if (photoFile) formData.append('photo', photoFile);

      // Get reCAPTCHA token if available
      if (typeof grecaptcha !== 'undefined' && typeof RECAPTCHA_SITE_KEY !== 'undefined') {
        try {
          const token = await grecaptcha.execute(RECAPTCHA_SITE_KEY, { action: 'booking' });
          formData.append('captchaToken', token);
        } catch (e) { /* Continue without captcha */ }
      }

      const response = await fetch('/api/booking', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (result.success) {
        if (result.requiresVerification) {
          showFormMessage(formMessage, 'Check your email! We sent a verification link to confirm your booking. Your time slot is held for 1 hour.', 'success');
          if (bookingForm) bookingForm.reset();
        } else {
          window.location.href = `/booking-confirmed?id=${result.bookingId}`;
        }
      } else {
        showFormMessage(formMessage, '✗ ' + (result.message || 'Something went wrong. Please try again.'), 'error');
      }
    } catch (err) {
      showFormMessage(formMessage, '✗ Connection error. Please call us directly at +45 91 61 00 13.', 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.classList.remove('btn--loading');
        submitBtn.textContent = originalBtnText;
      }
      formMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
}

function showFormMessage(el, text, type) {
  el.textContent = text;
  el.style.display = 'block';
  el.style.padding = '14px 18px';
  el.style.borderRadius = '10px';
  el.style.fontWeight = '500';
  el.style.fontSize = '15px';
  el.style.marginTop = '4px';

  if (type === 'success') {
    el.style.background = '#F0FDF4';
    el.style.color = '#166534';
    el.style.border = '1px solid #BBF7D0';
  } else {
    el.style.background = '#FFF5F5';
    el.style.color = '#9B1C1C';
    el.style.border = '1px solid #FED7D7';
  }
}

// ==================== SMOOTH ANCHOR SCROLL ====================
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    const target = document.querySelector(this.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    const navHeight = document.getElementById('nav')?.offsetHeight || 96;
    const top = target.getBoundingClientRect().top + window.scrollY - navHeight - 8;
    window.scrollTo({ top, behavior: 'smooth' });
  });
});

// ==================== GSAP ANIMATIONS ====================
if (typeof gsap !== 'undefined') {
  gsap.registerPlugin(ScrollTrigger);

  function fadeUp(targets, triggerEl, opts = {}) {
    const defaults = { y: 28, duration: 0.55, stagger: 0, ease: 'power2.out', start: 'top 90%' };
    const o = Object.assign({}, defaults, opts);
    gsap.fromTo(targets,
      { opacity: 0, y: o.y, x: o.x || 0 },
      { opacity: 1, y: 0, x: 0, duration: o.duration, stagger: o.stagger, ease: o.ease,
        scrollTrigger: { trigger: triggerEl, start: o.start, toggleActions: 'play none none none' }
      }
    );
  }

  gsap.from('.nav__inner', { y: -50, opacity: 0, duration: 0.8, ease: 'power3.out' });

  const heroTl = gsap.timeline({ defaults: { ease: 'power3.out' } });
  heroTl
    .from('.hero__badge',    { y: 24, opacity: 0, duration: 0.55 }, 0.25)
    .from('.hero__headline', { y: 32, opacity: 0, duration: 0.65 }, 0.38)
    .from('.hero__sub',      { y: 22, opacity: 0, duration: 0.55 }, 0.52)
    .from('.hero__actions',  { y: 20, opacity: 0, duration: 0.50 }, 0.64)
    .from('.hero__trust',    { y: 16, opacity: 0, duration: 0.45 }, 0.74)
    .from('.hero__visual',   { x: 50, opacity: 0, duration: 0.80, ease: 'power2.out' }, 0.30);

  fadeUp('.stats__item', '.stats', { stagger: 0.12 });

  document.querySelectorAll('[data-count]').forEach(el => {
    const target = parseInt(el.dataset.count, 10);
    const suffix = el.dataset.suffix || '';
    const obj    = { n: 0 };
    gsap.to(obj, {
      n: target, duration: 1.5, ease: 'power2.out',
      scrollTrigger: { trigger: el, start: 'top 90%', once: true },
      onUpdate() { el.textContent = Math.round(obj.n) + suffix; },
    });
  });

  fadeUp('.services .section-header', '.services', { y: 26, duration: 0.6 });
  fadeUp('.service-card', '.services__grid', { y: 38, stagger: 0.08 });
  fadeUp('.calculator .section-header', '.calculator', { y: 26, duration: 0.6 });
  fadeUp('.calc__card', '.calculator', { y: 32, duration: 0.65 });
  fadeUp('.why .section-header', '.why', { y: 26, duration: 0.6 });
  fadeUp('.why-card', '.why__grid', { y: 32, stagger: 0.14 });
  fadeUp('.how .section-header', '.how', { y: 26, duration: 0.6 });
  fadeUp('.how__step', '.how__grid', { stagger: 0.16 });
  fadeUp('.how__connector', '.how__grid', { duration: 0.3 });
  fadeUp('.about__photo-wrap', '.about', { x: -32, y: 0, duration: 0.65 });
  fadeUp('.about__content', '.about', { x: 32, y: 0, duration: 0.65 });
  fadeUp('.testimonials .section-header', '.testimonials', { y: 22 });
  fadeUp('.testimonial-card', '.testimonials__grid', { y: 30, stagger: 0.10 });
  fadeUp('.gallery .section-header', '.gallery', { y: 22 });
  fadeUp('.gallery__item', '.gallery__grid', { y: 30, stagger: 0.12 });
  fadeUp('.area .section-header', '.area', { y: 22 });
  fadeUp('.area__map', '.area__grid', { x: -28, y: 0, duration: 0.6 });
  fadeUp('.area__neighborhoods', '.area__grid', { x: 28, y: 0, duration: 0.6 });
  fadeUp('.faq .section-header', '.faq', { y: 22 });
  fadeUp('.faq__item', '.faq__list', { y: 20, stagger: 0.08, duration: 0.45 });
  fadeUp('.booking .section-header', '.booking', { y: 22 });
  fadeUp('.booking__form-wrap', '.booking__grid', { x: -32, y: 0, duration: 0.65 });
  fadeUp('.booking__info', '.booking__grid', { x: 32, y: 0, duration: 0.65 });
  fadeUp('.booking-info-card', '.booking__info', { y: 16, stagger: 0.10, duration: 0.45 });

  ScrollTrigger.refresh();
}

// ==================== BACK TO TOP ====================
const backToTop = document.getElementById('backToTop');
if (backToTop) {
  window.addEventListener('scroll', () => {
    backToTop.classList.toggle('visible', window.scrollY > 600);
  });
  backToTop.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// ==================== COOKIE CONSENT ====================
const cookieBanner = document.getElementById('cookieBanner');
if (cookieBanner && !localStorage.getItem('mrbike_cookies')) {
  cookieBanner.classList.add('show');
}
document.getElementById('cookieAccept')?.addEventListener('click', () => {
  localStorage.setItem('mrbike_cookies', 'accepted');
  cookieBanner.classList.remove('show');
});
document.getElementById('cookieDecline')?.addEventListener('click', () => {
  localStorage.setItem('mrbike_cookies', 'declined');
  cookieBanner.classList.remove('show');
});

// ==================== ZONE MAP (LEAFLET) ====================
(function initZoneMap() {
  const mapEl = document.getElementById('zoneMap');
  if (!mapEl || typeof L === 'undefined') return;

  const CPH = [55.6499, 12.6106]; // Service hub

  const map = L.map('zoneMap', {
    center: CPH,
    zoom: 11,
    scrollWheelZoom: false,
    attributionControl: true,
  });

  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  // Zone definitions: radius in meters matching server thresholds
  const zones = [
    { radius: 12000, color: '#E8186D', fill: '#E8186D', label: 'Outer Ring', surcharge: '+100 DKK' },
    { radius: 8000,  color: '#f59e0b', fill: '#f59e0b', label: 'Inner Ring', surcharge: '+50 DKK' },
    { radius: 5000,  color: '#10b981', fill: '#10b981', label: 'Central',    surcharge: 'FREE' },
  ];

  zones.forEach(z => {
    const circle = L.circle(CPH, {
      radius: z.radius,
      color: z.color,
      weight: 2,
      fillColor: z.fill,
      fillOpacity: 0.12,
      dashArray: z.radius === 12000 ? '8 4' : null,
    }).addTo(map);

    circle.bindTooltip(`<strong>${z.label}</strong><br>${z.surcharge}`, {
      permanent: false,
      direction: 'center',
      className: 'zone-tooltip',
    });
  });

  // Center marker — no address shown for privacy
  L.marker(CPH).addTo(map)
    .bindPopup('<strong>Mr. Bike</strong><br>Mobile Bike Repair')
    .openPopup();

  // Fix Leaflet rendering when map is in a hidden/reveal section
  setTimeout(() => map.invalidateSize(), 500);

  // Also fix on scroll reveal
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) map.invalidateSize(); });
  }, { threshold: 0.1 });
  observer.observe(mapEl);
})();
