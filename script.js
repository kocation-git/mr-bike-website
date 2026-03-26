// ==================== MOBILE NAV TOGGLE ====================
const navToggle = document.getElementById('navToggle');
const navLinks  = document.getElementById('navLinks');

if (navToggle && navLinks) {
  navToggle.addEventListener('click', () => {
    const isOpen = navLinks.classList.toggle('is-open');
    navToggle.setAttribute('aria-expanded', isOpen);
  });

  // Close menu when a nav link is clicked
  navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      navLinks.classList.remove('is-open');
      navToggle.setAttribute('aria-expanded', 'false');
    });
  });

  // Close menu when clicking outside
  document.addEventListener('click', (e) => {
    if (!navToggle.contains(e.target) && !navLinks.contains(e.target)) {
      navLinks.classList.remove('is-open');
      navToggle.setAttribute('aria-expanded', 'false');
    }
  });
}

// ==================== SET MIN DATE (tomorrow) ====================
const dateInput = document.getElementById('date');
if (dateInput) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  dateInput.min = tomorrow.toISOString().split('T')[0];
}

// ==================== FORM SUBMISSION ====================
const form = document.getElementById('bookingForm');

if (form) {
  const submitBtn = form.querySelector('button[type="submit"]');
  const originalBtnText = submitBtn ? submitBtn.textContent : 'Book My Repair →';

  // Remove any existing success/error message element and create a fresh one
  let formMessage = document.getElementById('formMessage');
  if (!formMessage) {
    formMessage = document.createElement('p');
    formMessage.id = 'formMessage';
    formMessage.style.display = 'none';
    form.appendChild(formMessage);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const data = {
      name:    (document.getElementById('fullName')?.value || '').trim(),
      email:   (document.getElementById('email')?.value || '').trim(),
      phone:   (document.getElementById('phone')?.value || '').trim(),
      service: (document.getElementById('service')?.value || ''),
      date:    (document.getElementById('date')?.value || ''),
      address: (document.getElementById('address')?.value || '').trim(),
      details: (document.getElementById('details')?.value || '').trim(),
    };

    // Basic client-side validation
    if (!data.name || data.name.length < 2) {
      document.getElementById('fullName')?.focus();
      showFormMessage(formMessage, '✗ Please enter your full name.', 'error');
      return;
    }
    if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      document.getElementById('email')?.focus();
      showFormMessage(formMessage, '✗ Please enter a valid email address.', 'error');
      return;
    }
    if (!data.service) {
      document.getElementById('service')?.focus();
      showFormMessage(formMessage, '✗ Please select a service.', 'error');
      return;
    }
    if (!data.date) {
      document.getElementById('date')?.focus();
      showFormMessage(formMessage, '✗ Please select a preferred date.', 'error');
      return;
    }
    if (!data.address || data.address.length < 5) {
      document.getElementById('address')?.focus();
      showFormMessage(formMessage, '✗ Please enter your full address.', 'error');
      return;
    }

    // Loading state
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';
    }
    formMessage.style.display = 'none';

    try {
      const response = await fetch('/api/booking', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(data),
      });

      const result = await response.json();

      if (result.success) {
        showFormMessage(formMessage, '✓ Booking received! Check your email for confirmation. We\'ll be in touch soon.', 'success');
        form.reset();
        if (dateInput) {
          const tom = new Date();
          tom.setDate(tom.getDate() + 1);
          dateInput.min = tom.toISOString().split('T')[0];
        }
      } else {
        showFormMessage(formMessage, '✗ ' + (result.message || 'Something went wrong. Please try again.'), 'error');
      }
    } catch (err) {
      showFormMessage(formMessage, '✗ Connection error. Please call us directly at +45 91 61 00 13.', 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
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
// Offset scrolling to account for sticky nav height
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    const target = document.querySelector(this.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    const navHeight = document.getElementById('nav')?.offsetHeight || 72;
    const top = target.getBoundingClientRect().top + window.scrollY - navHeight - 8;
    window.scrollTo({ top, behavior: 'smooth' });
  });
});
