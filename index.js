// Global State
let currentRole = 'student'; // 'student' | 'teacher'
let isRegisterMode = false;   // false = Login | true = Sign Up

// UI References
const authView = document.getElementById('authView');
const dashboardView = document.getElementById('dashboardView');
const tabStudent = document.getElementById('tab-student');
const tabTeacher = document.getElementById('tab-teacher');
const slider = document.getElementById('slider');
const roleIndicator = document.getElementById('roleIndicator');
const roleIcon = document.getElementById('roleIcon');
const roleText = document.getElementById('roleText');
const fullNameGroup = document.getElementById('fullNameGroup');
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
const dashContent = document.getElementById('dashContent');
const dashUserName = document.getElementById('dashUserName');
const dashRoleTag = document.getElementById('dashRoleTag');
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

// Handle Login or Registration
function handleAuthSubmit(event) {
  event.preventDefault();

  const fullName = document.getElementById('fullName').value.trim();
  const idValue = identifierInput.value.trim();
  const passValue = passwordInput.value.trim();

  if (isRegisterMode && !fullName) {
    showStatus('Please enter your full name.', 'error');
    return;
  }

  if (!idValue || !passValue) {
    showStatus('Please enter all required credentials.', 'error');
    return;
  }

  if (passValue.length < 6) {
    showStatus('Password must be at least 6 characters long.', 'error');
    return;
  }

  const actionText = isRegisterMode ? 'Creating your account...' : 'Authenticating...';
  showStatus(actionText, 'success');

  // Simulate authentication & dynamic redirection
  setTimeout(() => {
    const userDisplayName = isRegisterMode ? fullName : idValue;
    redirectToDashboard(userDisplayName, currentRole);
  }, 1000);
}

// REDIRECT LOGIC: Launches unique workspace according to role
function redirectToDashboard(userName, role) {
  authView.classList.add('hidden');
  dashboardView.classList.remove('hidden');

  dashUserName.textContent = userName;
  dashRoleTag.textContent = role.toUpperCase();
  dashRoleTag.style.color = role === 'student' ? 'var(--student-accent)' : 'var(--teacher-accent)';

  if (role === 'student') {
    dashContent.innerHTML = `
      <div class="dash-welcome">
        <h1>Welcome, ${userName}! 🎓</h1>
        <p>Your Smart Classroom dashboard is live and synced.</p>
      </div>
      <div class="grid-cards">
        <div class="card">
          <i class="fa-solid fa-laptop-code"></i>
          <h4>Live Class Sessions</h4>
          <p>Join active virtual labs in Grade 9 Mathematics and Science modules.</p>
        </div>
        <div class="card">
          <i class="fa-solid fa-chart-line"></i>
          <h4>Performance Tracker</h4>
          <p>Review real-time quiz results, attendance records, and skill badges.</p>
        </div>
        <div class="card">
          <i class="fa-solid fa-folder-open"></i>
          <h4>Study Resources</h4>
          <p>Download interactive worksheets, slide decks, and digital notes.</p>
        </div>
      </div>
    `;
  } else {
    dashContent.innerHTML = `
      <div class="dash-welcome">
        <h1>Welcome, Educator ${userName}! 👨‍🏫</h1>
        <p>Faculty portal initialized with administrative controls.</p>
      </div>
      <div class="grid-cards">
        <div class="card">
          <i class="fa-solid fa-chalkboard"></i>
          <h4>Classroom Broadcast</h4>
          <p>Start a live interactive session, launch whiteboard tools, and host polls.</p>
        </div>
        <div class="card">
          <i class="fa-solid fa-users-gear"></i>
          <h4>Student Roster & Attendance</h4>
          <p>Manage student enrolments, track participation, and assign grades.</p>
        </div>
        <div class="card">
          <i class="fa-solid fa-square-plus"></i>
          <h4>Module Creator</h4>
          <p>Draft new assignments, upload quizzes, and publish lesson schedules.</p>
        </div>
      </div>
    `;
  }
}

// Logout & Return to Portal
function logout() {
  dashboardView.classList.add('hidden');
  authView.classList.remove('hidden');
  identifierInput.value = '';
  passwordInput.value = '';
  document.getElementById('fullName').value = '';
  hideStatus();
}

function handleForgot(e) {
  e.preventDefault();
  const idValue = identifierInput.value.trim();
  alert(idValue ? `Reset instructions sent to: ${idValue}` : 'Please enter your ID/Email first.');
}

function showStatus(msg, type) {
  statusMessage.textContent = msg;
  statusMessage.className = `status-message ${type}`;
}

function hideStatus() {
  statusMessage.style.display = 'none';
}