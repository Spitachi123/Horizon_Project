// Global State
let currentRole = 'student'; // 'student' | 'teacher'
let isRegisterMode = false;   // false = Login | true = Sign Up

// UI References
const authView = document.getElementById('authView');
const tabStudent = document.getElementById('tab-student');
const tabTeacher = document.getElementById('tab-teacher');
const slider = document.getElementById('slider');
const roleIndicator = document.getElementById('roleIndicator');
const roleIcon = document.getElementById('roleIcon');
const roleText = document.getElementById('roleText');
const fullNameGroup = document.getElementById('fullNameGroup');
const extraFieldGroup = document.getElementById('extraFieldGroup');
const extraFieldLabel = document.getElementById('extraFieldLabel');
const extraFieldInput = document.getElementById('extraField');
const teacherSubjectGroup = document.getElementById('teacherSubjectGroup');
const teacherSubjectSelect = document.getElementById('teacherSubject');
const identifierLabel = document.getElementById('identifierLabel');
const identifierInput = document.getElementById('identifier');
const passwordInput = document.getElementById('password');
const forgotLink = document.getElementById('forgotLink');
const togglePasswordIcon = document.getElementById('togglePassword');
const formTitle = document.getElementById('formTitle');
const formSub = document.getElementById('formSub');
const brandTitle = document.getElementById('brandTitle');
const brandDesc = document.getElementById('brandDesc');
const submitBtnText = document.getElementById('submitBtnText');
const modePrompt = document.getElementById('modePrompt');
const modeToggleBtn = document.getElementById('modeToggleBtn');
const statusMessage = document.getElementById('statusMessage');
const submitBtn = document.getElementById('submitBtn');
const root = document.documentElement;

// Role Switch Logic
function switchRole(role) {
  currentRole = role;
  hideStatus();
  const t = (typeof LangEngine !== 'undefined') ? LangEngine.t : (k => k);

  if (role === 'student') {
    tabStudent.classList.add('active');
    tabTeacher.classList.remove('active');
    slider.style.transform = 'translateX(0%)';

    root.style.setProperty('--current-accent', 'var(--student-accent)');
    root.style.setProperty('--current-glow', 'var(--student-glow)');

    roleIndicator.className = 'role-indicator student';
    roleIcon.className = 'fa-solid fa-user-graduate';
    roleText.textContent = isRegisterMode ? t('newStudentReg') : t('studentAccessMode');
    identifierLabel.textContent = isRegisterMode ? t('studentEmailAddr') : t('studentIdOrEmail');
    identifierInput.placeholder = 'e.g. STU-2026-8942';
    extraFieldLabel.textContent = t('classGradeLabel');
    extraFieldInput.placeholder = 'e.g. Grade 10';
    if (isRegisterMode) { extraFieldGroup.classList.remove('hidden'); teacherSubjectGroup.classList.add('hidden'); }

  } else if (role === 'teacher') {
    tabTeacher.classList.add('active');
    tabStudent.classList.remove('active');
    slider.style.transform = 'translateX(100%)';

    root.style.setProperty('--current-accent', 'var(--teacher-accent)');
    root.style.setProperty('--current-glow', 'var(--teacher-glow)');

    roleIndicator.className = 'role-indicator teacher';
    roleIcon.className = 'fa-solid fa-chalkboard-user';
    roleText.textContent = isRegisterMode ? t('newFacultyAcct') : t('teacherAccessMode');
    identifierLabel.textContent = isRegisterMode ? t('facultyEmailAddr') : t('facultyIdOrEmail');
    identifierInput.placeholder = 'e.g. FAC-2026-1049';
    if (isRegisterMode) { teacherSubjectGroup.classList.remove('hidden'); extraFieldGroup.classList.add('hidden'); }
  }
}

// Toggle Mode Switch (Login <-> Create Account)
function toggleAuthMode(e) {
  if(e) e.preventDefault();
  isRegisterMode = !isRegisterMode;
  hideStatus();
  renderAuthModeLabels();
  switchRole(currentRole); // Refresh role labels
}

/** Sets every label that depends on isRegisterMode (but not on
 *  which role tab is active — see switchRole() for those). Split out
 *  from toggleAuthMode() so the 'langChanged' listener below can
 *  re-apply the current mode's labels in the new language without
 *  also flipping login <-> register. */
function renderAuthModeLabels() {
  const t = (typeof LangEngine !== 'undefined') ? LangEngine.t : (k => k);

  if (isRegisterMode) {
    formTitle.textContent = t('formTitleCreate');
    formSub.textContent = t('formSubCreate');
    brandTitle.textContent = t('brandTitleRegister');
    brandDesc.textContent = t('brandDescRegister');
    submitBtnText.textContent = t('submitRegister');
    modePrompt.textContent = t('alreadyHaveAccount');
    modeToggleBtn.textContent = t('login');
    fullNameGroup.classList.remove('hidden');
    forgotLink.classList.add('hidden');
  } else {
    formTitle.textContent = t('formTitleWelcome');
    formSub.textContent = t('formSubWelcome');
    brandTitle.textContent = t('brandTitleLogin');
    brandDesc.textContent = t('brandDescLogin');
    submitBtnText.textContent = t('submitLogin');
    modePrompt.textContent = t('dontHaveAccount');
    modeToggleBtn.textContent = t('createAccount');
    fullNameGroup.classList.add('hidden');
    extraFieldGroup.classList.add('hidden');
    teacherSubjectGroup.classList.add('hidden');
    forgotLink.classList.remove('hidden');
  }
}

// Password Visibility Toggle
function togglePassVisibility() {
  const isPassword = passwordInput.type === 'password';
  passwordInput.type = isPassword ? 'text' : 'password';
  togglePasswordIcon.className = isPassword
    ? 'fa-solid fa-eye-slash toggle-password'
    : 'fa-solid fa-eye toggle-password';
}

// Handle Login or Registration (real Firebase Auth)
async function handleAuthSubmit(event) {
  event.preventDefault();

  const fullName = document.getElementById('fullName').value.trim();
  const email = identifierInput.value.trim();
  const passValue = passwordInput.value.trim();
  const remember = document.getElementById('remember').checked;

  if (isRegisterMode && !fullName) {
    showStatus('Please enter your full name.', 'error');
    return;
  }

  if (!email || !passValue) {
    showStatus('Please enter all required credentials.', 'error');
    return;
  }

  if (passValue.length < 6) {
    showStatus('Password must be at least 6 characters long.', 'error');
    return;
  }

  // Give instant feedback the moment the click happens — before any
  // network round-trip — so the form never just sits there looking
  // unresponsive while Firebase does its thing.
  setSubmitLoading(true);

  try {
    if (isRegisterMode) {
      showStatus('Creating your account...', 'loading');
      const extra = currentRole === 'teacher'
        ? { subjectFocus: teacherSubjectSelect.value }
        : { grade: extraFieldInput.value.trim() };
      const { role } = await AppAuth.signUp(fullName, email, passValue, currentRole, extra);
      showStatus('Account created! Redirecting...', 'success');
      AppAuth.redirectToDashboard(role);
    } else {
      showStatus('Authenticating...', 'loading');
      const { role } = await AppAuth.signIn(email, passValue, remember);
      showStatus('Welcome back! Redirecting...', 'success');
      AppAuth.redirectToDashboard(role);
    }
  } catch (err) {
    setSubmitLoading(false);
    showStatus(AppAuth.friendlyError(err), 'error');
  }
}

/** Locks/unlocks the submit button and swaps its label + arrow for a
 *  spinner, so there's always a visible "this is working" state
 *  instead of the button just sitting there after a click. Hides the
 *  existing text/icon rather than overwriting them, so whatever label
 *  toggleAuthMode had set (login vs. sign-up) comes back correctly. */
function setSubmitLoading(isLoading) {
  if (!submitBtn) return;
  submitBtn.disabled = isLoading;
  let spinner = submitBtn.querySelector('.btn-spinner');

  if (isLoading) {
    if (!spinner) {
      spinner = document.createElement('span');
      spinner.className = 'btn-spinner';
      submitBtn.prepend(spinner);
    }
    Array.from(submitBtn.children).forEach(child => {
      if (child !== spinner && child !== submitBtnText) child.style.display = 'none';
    });
    if (submitBtnText.dataset.prevText === undefined) {
      submitBtnText.dataset.prevText = submitBtnText.textContent;
    }
    submitBtnText.textContent = isRegisterMode ? 'Creating account...' : 'Signing in...';
  } else {
    if (spinner) spinner.remove();
    Array.from(submitBtn.children).forEach(child => { child.style.display = ''; });
    if (submitBtnText.dataset.prevText !== undefined) {
      submitBtnText.textContent = submitBtnText.dataset.prevText;
      delete submitBtnText.dataset.prevText;
    }
  }
}

function handleForgot(e) {
  e.preventDefault();
  const email = identifierInput.value.trim();
  if (!email) {
    showStatus('Enter your email above first, then click Forgot.', 'error');
    return;
  }
  AppAuth.resetPassword(email)
    .then(() => showStatus('Password reset email sent — check your inbox.', 'success'))
    .catch(err => showStatus(AppAuth.friendlyError(err), 'error'));
}

function showStatus(msg, type) {
  statusMessage.innerHTML = type === 'loading'
    ? `<span class="status-spinner"></span><span>${msg}</span>`
    : `<span>${msg}</span>`;
  statusMessage.className = `status-message ${type}`;
}

function hideStatus() {
  statusMessage.style.display = 'none';
}

// LangEngine (loaded after this file) dispatches 'langChanged' once
// immediately on page load and again on every language switch. index.js
// runs first in script order, so this listener is safely attached
// before that first dispatch — this is what actually populates the
// auth form's labels in the right language from the very first paint,
// since otherwise they'd just show whatever plain-English text was
// hardcoded in index.html until the next click.
document.addEventListener('langChanged', () => {
  renderAuthModeLabels();
  switchRole(currentRole);
});