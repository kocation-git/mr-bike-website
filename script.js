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

  // Helper: scroll-triggered fade-up using fromTo (safe — never leaves elements invisible)
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

  // ── NAV entrance ──────────────────────────────────────
  gsap.from('.nav__inner', {
    y: -50, opacity: 0, duration: 0.8, ease: 'power3.out',
  });

  // ── HERO entrance (staggered timeline) ────────────────
  const heroTl = gsap.timeline({ defaults: { ease: 'power3.out' } });
  heroTl
    .from('.hero__badge',    { y: 24, opacity: 0, duration: 0.55 }, 0.25)
    .from('.hero__headline', { y: 32, opacity: 0, duration: 0.65 }, 0.38)
    .from('.hero__sub',      { y: 22, opacity: 0, duration: 0.55 }, 0.52)
    .from('.hero__actions',  { y: 20, opacity: 0, duration: 0.50 }, 0.64)
    .from('.hero__trust',    { y: 16, opacity: 0, duration: 0.45 }, 0.74)
    .from('.hero__visual',   { x: 50, opacity: 0, duration: 0.80, ease: 'power2.out' }, 0.30);

  // ── STATS ─────────────────────────────────────────────
  fadeUp('.stats__item', '.stats', { stagger: 0.12 });

  // Animated counters
  document.querySelectorAll('[data-count]').forEach(el => {
    const target = parseInt(el.dataset.count, 10);
    const suffix = el.dataset.suffix || '';
    const obj    = { n: 0 };
    gsap.to(obj, {
      n: target,
      duration: 1.5,
      ease: 'power2.out',
      scrollTrigger: { trigger: el, start: 'top 90%', once: true },
      onUpdate() { el.textContent = Math.round(obj.n) + suffix; },
    });
  });

  // ── SERVICES ──────────────────────────────────────────
  fadeUp('.services .section-header', '.services', { y: 26, duration: 0.6 });
  fadeUp('.service-card', '.services__grid', { y: 38, stagger: 0.08 });

  // ── WHY MR. BIKE ──────────────────────────────────────
  fadeUp('.why .section-header', '.why', { y: 26, duration: 0.6 });
  fadeUp('.why-card', '.why__grid', { y: 32, stagger: 0.14 });

  // ── HOW IT WORKS ──────────────────────────────────────
  fadeUp('.how .section-header', '.how', { y: 26, duration: 0.6 });
  fadeUp('.how__step', '.how__grid', { stagger: 0.16 });
  fadeUp('.how__connector', '.how__grid', { duration: 0.3 });

  // ── FAQ ───────────────────────────────────────────────
  fadeUp('.faq .section-header', '.faq', { y: 22 });
  fadeUp('.faq__item', '.faq__list', { y: 20, stagger: 0.08, duration: 0.45 });

  // ── BOOKING ───────────────────────────────────────────
  fadeUp('.booking .section-header', '.booking', { y: 22 });
  fadeUp('.booking__form-wrap', '.booking__grid', { x: -32, y: 0, duration: 0.65 });
  fadeUp('.booking__info', '.booking__grid', { x: 32, y: 0, duration: 0.65 });
  fadeUp('.booking-info-card', '.booking__info', { y: 16, stagger: 0.10, duration: 0.45 });

  // Recalculate trigger positions after layout settles
  ScrollTrigger.refresh();
}
