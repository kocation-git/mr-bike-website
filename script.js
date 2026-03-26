// ==================== NAV SCROLL ====================
const nav = document.getElementById('nav');
window.addEventListener('scroll', () => {
    nav.style.boxShadow = window.scrollY > 20 ? '0 2px 20px rgba(0,0,0,0.3)' : 'none';
});

// ==================== SET MIN DATE ====================
const dateInput = document.getElementById('date');
const today = new Date();
today.setDate(today.getDate() + 1); // minimum = tomorrow
dateInput.min = today.toISOString().split('T')[0];

// ==================== FORM SUBMISSION ====================
const form = document.getElementById('bookingForm');
const formMessage = document.getElementById('formMessage');
const submitBtn = document.getElementById('submitBtn');
const btnText = document.getElementById('btnText');

function showError(fieldId, msg) {
    const el = document.getElementById(fieldId + 'Error');
    if (el) el.textContent = msg;
}

function clearErrors() {
    ['name', 'email', 'date', 'service', 'address'].forEach(f => showError(f, ''));
}

function validate(data) {
    let valid = true;
    clearErrors();

    if (!data.name || data.name.trim().length < 2) {
        showError('name', 'Please enter your full name.');
        valid = false;
    }
    if (!data.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
        showError('email', 'Please enter a valid email address.');
        valid = false;
    }
    if (!data.service) {
        showError('service', 'Please select a service.');
        valid = false;
    }
    if (!data.date) {
        showError('date', 'Please select a preferred date.');
        valid = false;
    }
    if (!data.address || data.address.trim().length < 5) {
        showError('address', 'Please enter your full address.');
        valid = false;
    }

    return valid;
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const data = {
        name: document.getElementById('name').value.trim(),
        email: document.getElementById('email').value.trim(),
        phone: document.getElementById('phone').value.trim(),
        service: document.getElementById('service').value,
        date: document.getElementById('date').value,
        address: document.getElementById('address').value.trim(),
        details: document.getElementById('details').value.trim(),
    };

    if (!validate(data)) return;

    // Loading state
    submitBtn.disabled = true;
    btnText.textContent = 'Sending...';
    formMessage.className = 'form-message';
    formMessage.style.display = 'none';

    try {
        const response = await fetch('/api/booking', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });

        const result = await response.json();

        if (result.success) {
            formMessage.textContent = '✓ Booking received! Check your email for confirmation. We\'ll be in touch soon.';
            formMessage.className = 'form-message success';
            form.reset();
            dateInput.min = today.toISOString().split('T')[0];
        } else {
            formMessage.textContent = '✗ ' + (result.message || 'Something went wrong. Please try again.');
            formMessage.className = 'form-message error';
        }
    } catch (err) {
        formMessage.textContent = '✗ Connection error. Please try again or contact us on WhatsApp.';
        formMessage.className = 'form-message error';
    } finally {
        submitBtn.disabled = false;
        btnText.textContent = 'Book My Repair';
        formMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
});

// ==================== REAL-TIME VALIDATION ====================
document.getElementById('name').addEventListener('blur', function () {
    if (this.value && this.value.trim().length < 2) showError('name', 'Please enter your full name.');
    else showError('name', '');
});

document.getElementById('email').addEventListener('blur', function () {
    if (this.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.value)) showError('email', 'Please enter a valid email address.');
    else showError('email', '');
});
