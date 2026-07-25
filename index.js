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
const root = document.documentElement;

// Role Switch Logic
function switchRole(role) {
  currentRole = role;
  hideStatus();

  if (role === 'student') {
    tabStudent.classList.add('active');
    tabTeacher.classList.remove('active');
    slider.style.transform = 'translateX(0%)';

    root.style.setProperty('--current-accent', 'var(--student-accent)');
    root.style.setProperty('--current-glow', 'var(--student-glow)');

    roleIndicator.className = 'role-indicator student';
    roleIcon.className = 'fa-solid fa-user-graduate';
    roleText.textContent = isRegisterMode ? 'New Student Registration' : 'Student Access Mode';
    identifierLabel.textContent = isRegisterMode ? 'Student Email Address' : 'Student ID or Email';
    identifierInput.placeholder = 'e.g. STU-2026-8942';
    extraFieldLabel.textContent = 'Class / Grade';
    extraFieldInput.placeholder = 'e.g. Grade 10';

  } else if (role === 'teacher') {
    tabTeacher.classList.add('active');
    tabStudent.classList.remove('active');
    slider.style.transform = 'translateX(100%)';

    root.style.setProperty('--current-accent', 'var(--teacher-accent)');
    root.style.setProperty('--current-glow', 'var(--teacher-glow)');

    roleIndicator.className = 'role-indicator teacher';
    roleIcon.className = 'fa-solid fa-chalkboard-user';
    roleText.textContent = isRegisterMode ? 'New Faculty Account' : 'Educator Portal Mode';
    identifierLabel.textContent = isRegisterMode ? 'Faculty Email Address' : 'Faculty ID or Work Email';
    identifierInput.placeholder = 'e.g. FAC-2026-1049';
    extraFieldLabel.textContent = 'Subject Specialization';
    extraFieldInput.placeholder = 'e.g. Physics & Maths';
  }
}

// Toggle Mode Switch (Login <-> Create Account)
function toggleAuthMode(e) {
  if(e) e.preventDefault();
  isRegisterMode = !isRegisterMode;
  hideStatus();

  if (isRegisterMode) {
    formTitle.textContent = 'Create Portal Account';
    formSub.textContent = 'Set up your smart classroom access';
    brandTitle.textContent = 'Join NexusEdu Today';
    brandDesc.textContent = 'Create your account to unlock personalized learning modules, analytics, and instant collaboration.';
    submitBtnText.textContent = 'Register & Create Account';
    modePrompt.textContent = 'Already have an account?';
    modeToggleBtn.textContent = 'Sign In';
    fullNameGroup.classList.remove('hidden');
    extraFieldGroup.classList.remove('hidden');
    forgotLink.classList.add('hidden');
  } else {
    formTitle.textContent = 'Welcome Back';
    formSub.textContent = 'Select your portal access mode to continue';
    brandTitle.textContent = 'Next-Gen Interactive Learning';
    brandDesc.textContent = 'Access live virtual labs, real-time analytics, and collaborative smart classroom modules.';
    submitBtnText.textContent = 'Enter Classroom';
    modePrompt.textContent = "Don't have an account?";
    modeToggleBtn.textContent = 'Create Account';
    fullNameGroup.classList.add('hidden');
    extraFieldGroup.classList.add('hidden');
    forgotLink.classList.remove('hidden');
  }

  switchRole(currentRole); // Refresh role labels
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

  const submitBtn = document.getElementById('submitBtn');
  submitBtn.disabled = true;

  try {
    if (isRegisterMode) {
      showStatus('Creating your account...', 'success');
      const extraValue = extraFieldInput.value.trim();
      const extra = currentRole === 'teacher' ? { subjectFocus: extraValue } : { grade: extraValue };
      const { role } = await AppAuth.signUp(fullName, email, passValue, currentRole, extra);
      showStatus('Account created! Redirecting...', 'success');
      AppAuth.redirectToDashboard(role);
    } else {
      showStatus('Authenticating...', 'success');
      const { role } = await AppAuth.signIn(email, passValue, remember);
      showStatus('Welcome back! Redirecting...', 'success');
      AppAuth.redirectToDashboard(role);
    }
  } catch (err) {
    submitBtn.disabled = false;
    showStatus(AppAuth.friendlyError(err), 'error');
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
  statusMessage.textContent = msg;
  statusMessage.className = `status-message ${type}`;
}

function hideStatus() {
  statusMessage.style.display = 'none';
}