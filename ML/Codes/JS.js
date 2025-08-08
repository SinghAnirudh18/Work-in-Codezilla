const form = document.getElementById('healthForm');
const submitBtn = document.getElementById('submitBtn');
const successMessage = document.getElementById('successMessage');
const validationMessage = document.getElementById('validationMessage');
const progressFill = document.getElementById('progressFill');
const bmiDisplay = document.getElementById('bmiDisplay');

// Update range display
function updateRangeDisplay(fieldName, value) {
    document.getElementById(fieldName + '_display').textContent = value;
}

// Basic validation functions
function isNumeric(value) {
    return !isNaN(parseFloat(value)) && isFinite(value);
}

function isAlphabetic(value) {
    return /^[a-zA-Z\s]+$/.test(value);
}

function isAlphaNumeric(value) {
    return /^[a-zA-Z0-9\s\-\.,]+$/.test(value);
}

function validateField(field) {
    const value = field.value.trim();
    const fieldType = field.type;
    const fieldName = field.name;
    field.classList.remove('error');
    if (!value && !field.required) return true;
    if (field.required && !value) {
        field.classList.add('error');
        return false;
    }
    if (fieldType === 'number' && value) {
        if (!isNumeric(value)) {
            field.classList.add('error');
            return false;
        }
    }
    if (fieldType === 'text' && value) {
        if (fieldName === 'occupation' && !isAlphaNumeric(value)) {
            field.classList.add('error');
            return false;
        } else if (!isAlphabetic(value)) {
            field.classList.add('error');
            return false;
        }
    }
    if (fieldType === 'email' && value) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(value)) {
            field.classList.add('error');
            return false;
        }
    }
    return true;
}

function showError(field, message) {
    field.classList.add('error');
    const errorDiv = field.parentElement.querySelector('.error-message');
    if (errorDiv) {
        errorDiv.style.display = 'block';
        errorDiv.textContent = message;
    }
}

function clearError(field) {
    field.classList.remove('error');
    const errorDiv = field.parentElement.querySelector('.error-message');
    if (errorDiv) {
        errorDiv.style.display = 'none';
        errorDiv.textContent = '';
    }
}

// BMI Calculation
function updateBMI() {
    const heightField = document.getElementById('height');
    const weightField = document.getElementById('weight');
    const hVal = parseFloat(heightField.value);
    const wVal = parseFloat(weightField.value);
    if (isNumeric(hVal) && hVal > 0 && isNumeric(wVal) && wVal > 0) {
        const bmi = wVal / ((hVal / 100) ** 2);
        let interpretation =
            bmi < 18.5 ? 'Underweight' :
            bmi < 25 ? 'Normal' :
            bmi < 30 ? 'Overweight' :
            'Obese';
        bmiDisplay.style.display = 'block';
        bmiDisplay.textContent = `BMI: ${bmi.toFixed(1)} (${interpretation})`;
    } else {
        bmiDisplay.style.display = 'none';
        bmiDisplay.textContent = '';
    }
}

document.getElementById('height').addEventListener('input', updateBMI);
document.getElementById('weight').addEventListener('input', updateBMI);

// Progress calculation
function updateProgress() {
    const allFields = form.querySelectorAll('input, select, textarea');
    let filled = 0;
    let total = 0;
    allFields.forEach(field => {
        if (field.type === "hidden" || field.disabled) return;
        let val = field.value;
        if (field.type === "checkbox" || field.type === "radio") {
            if (field.checked) filled++;
            total++;
        } else if (val && val.trim().length > 0) {
            filled++;
            total++;
        }
    });
    const percent = Math.floor((filled / Math.max(total, 1)) * 100);
    progressFill.style.width = percent + '%';
}
form.addEventListener('input', updateProgress);

// Client-side validation
function validateForm() {
    let valid = true;
    const fieldsToCheck = [
        { id: 'age', label: 'Age', required: true },
        { id: 'gender', label: 'Gender', required: true },
        { id: 'education_level', label: 'Education Level', required: true },
        { id: 'height', label: 'Height', required: true },
        { id: 'weight', label: 'Weight', required: true }
    ];

    for (const f of fieldsToCheck) {
        const field = document.getElementById(f.id);
        clearError(field);
        if (f.required && !field.value) {
            showError(field, `${f.label} is required`);
            valid = false;
        } else if (field.type === 'number' && field.value && !isNumeric(field.value)) {
            showError(field, `${f.label} must be a valid number`);
            valid = false;
        }
    }

    const emailField = document.getElementById('email');
    if (emailField.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailField.value)) {
        showError(emailField, 'Invalid email format');
        valid = false;
    }

    return valid;
}

// Clear errors on input
form.querySelectorAll('input, select, textarea').forEach(field => {
    field.addEventListener('input', () => clearError(field));
});

// Form submission
form.addEventListener('submit', async function (e) {
    e.preventDefault();
    validationMessage.style.display = "none";
    if (!validateForm()) {
        validationMessage.style.display = 'block';
        validationMessage.textContent = 'Please correct fields marked in red and try again.';
        updateProgress();
        return;
    }

    submitBtn.classList.add('loading');
    const formData = Object.fromEntries(new FormData(form));
    try {
        const response = await fetch('/api/health-assessment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });
        const result = await response.json();
        submitBtn.classList.remove('loading');
        if (result.success) {
            successMessage.style.display = 'block';
            successMessage.innerHTML = `
                Health assessment submitted successfully!<br>
                Risk Level: ${result.data.risk_level}<br>
                BMI: ${result.data.bmi || 'N/A'}<br>
                Lifestyle Prediction: ${result.data.lifestyle_prediction}<br>
                Recommendations: ${result.data.recommendations.length > 0 ? result.data.recommendations.join(', ') : 'None'}
            `;
            form.style.display = 'none';
            progressFill.style.width = '100%';
        } else {
            validationMessage.style.display = 'block';
            validationMessage.textContent = result.message;
            if (result.errors) {
                result.errors.forEach(err => {
                    const field = document.getElementById(err.field);
                    if (field) showError(field, err.message);
                });
            }
        }
    } catch (error) {
        submitBtn.classList.remove('loading');
        validationMessage.style.display = 'block';
        validationMessage.textContent = 'Error submitting form. Please try again.';
    }
});

// Initial function calls
updateBMI();
updateProgress();
