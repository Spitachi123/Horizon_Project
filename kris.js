(function () {

    /* ---------- User Session Handling ----------
       This used to read a localStorage key that nothing in the
       Firebase-based app ever set, so it always fell back to a
       "Guest Student". It now waits for the real signed-in
       Firebase user (set up by app-auth.js on this same page)
       and only builds/renders the dashboard once that resolves,
       so milestones are correctly scoped to the real student. */
    var currentUser = {
        uid: 'guest',
        name: 'Guest Student',
        email: 'guest@divedu.app',
        role: 'student'
    };

    var STORAGE_KEY, WEEK_KEY;
    var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var assignments = [];
    var weeklyPoints = [0, 0, 0, 0, 0, 0, 0];

    // DOM Elements
    var dashboardTab = document.getElementById('dashboardTab');
    var toggleFormBtn = document.getElementById('toggleFormBtn');
    var entryForm = document.getElementById('entryForm');
    var form = document.getElementById('assignmentForm');
    var formError = document.getElementById('formError');
    var assignmentList = document.getElementById('assignmentList');
    var emptyState = document.getElementById('emptyState');
    var weeklyBarsEl = document.getElementById('weeklyBars');

    var dueInput = document.getElementById('aDue');
    if (dueInput) dueInput.min = todayStr();

    /* ---------- Render Authenticated Student Profile ---------- */
    function renderUserProfile() {
        var nameEl = document.getElementById('studentName');
        var emailEl = document.getElementById('studentEmail');
        var roleEl = document.getElementById('studentRole');

        if (nameEl) nameEl.textContent = currentUser.name || 'Student';
        if (emailEl) emailEl.textContent = currentUser.email || '';
        if (roleEl) roleEl.textContent = (currentUser.role || 'STUDENT').toUpperCase();
    }

    /* ---------- Local Storage Helpers ---------- */

    function loadAssignments() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) { return []; }
    }

    function saveAssignments() {
        try { 
            localStorage.setItem(STORAGE_KEY, JSON.stringify(assignments)); 
        } catch (e) {}
    }

    function loadWeekly() {
        try {
            var raw = localStorage.getItem(WEEK_KEY);
            return raw ? JSON.parse(raw) : [0, 0, 0, 0, 0, 0, 0];
        } catch (e) { return [0, 0, 0, 0, 0, 0, 0]; }
    }

    function saveWeekly() {
        try { 
            localStorage.setItem(WEEK_KEY, JSON.stringify(weeklyPoints)); 
        } catch (e) {}
    }

    /* ---------- Date & Time Helpers ---------- */

    function todayStr() {
        var d = new Date();
        return d.toISOString().slice(0, 10);
    }

    function daysBetween(dueStr) {
        var due = new Date(dueStr + 'T00:00:00');
        var today = new Date();
        today.setHours(0, 0, 0, 0);
        return Math.round((due - today) / 86400000);
    }

    function fmtDate(dateObj) {
        return dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    /* ---------- UI Toggles ---------- */

    function toggleForm() {
        if (entryForm) entryForm.classList.toggle('open');
    }

    if (dashboardTab) dashboardTab.addEventListener('click', toggleForm);
    if (toggleFormBtn) toggleFormBtn.addEventListener('click', toggleForm);

    /* ---------- Create Assignment ---------- */

    if (form) {
        form.addEventListener('submit', function (e) {
            e.preventDefault();

            var nameInput = document.getElementById('aName');
            var dueVal = document.getElementById('aDue').value;
            var hoursVal = parseFloat(document.getElementById('aHours').value);
            var name = nameInput ? nameInput.value.trim() : '';

            var daysLeft = daysBetween(dueVal);

            if (!name || !dueVal || isNaN(hoursVal) || daysLeft < 0) {
                if (formError) formError.style.display = 'block';
                return;
            }
            if (formError) formError.style.display = 'none';

            var totalDays = Math.max(daysLeft, 1);
            var hoursPerDay = hoursVal / totalDays;
            var totalPoints = Math.round(hoursVal * 15);
            var pointsPerDay = Math.round(totalPoints / totalDays);

            var milestones = [];
            for (var i = 0; i < totalDays; i++) {
                var d = new Date();
                d.setDate(d.getDate() + i);
                milestones.push({
                    label: 'Day ' + (i + 1),
                    dateLabel: fmtDate(d),
                    hours: hoursPerDay.toFixed(1),
                    points: pointsPerDay,
                    done: false
                });
            }

            assignments.push({
                id: 'a' + Date.now(),
                userId: currentUser.uid, // Explicitly tag assignment to active user
                name: name,
                due: dueVal,
                estHours: hoursVal,
                totalPoints: totalPoints,
                milestones: milestones
            });

            saveAssignments();
            if (nameInput) nameInput.value = '';
            document.getElementById('aDue').value = '';
            document.getElementById('aHours').value = '';
            if (entryForm) entryForm.classList.remove('open');

            render();
        });
    }

    /* ---------- Milestone & Assignment Handlers ---------- */

    function toggleMilestone(assignmentId, index) {
        var a = assignments.filter(function (x) { return x.id === assignmentId; })[0];
        if (!a) return;
        var m = a.milestones[index];
        m.done = !m.done;

        var todayIdx = new Date().getDay();
        weeklyPoints[todayIdx] += m.done ? m.points : -m.points;
        if (weeklyPoints[todayIdx] < 0) weeklyPoints[todayIdx] = 0;
        
        saveWeekly();
        saveAssignments();
        render();
    }

    function deleteAssignment(id) {
        assignments = assignments.filter(function (a) { return a.id !== id; });
        saveAssignments();
        render();
    }

    // Attach to global scope for Inline HTML event attributes (`onclick`, `onchange`)
    window.__toggleMilestone = toggleMilestone;
    window.__deleteAssignment = deleteAssignment;

    /* ---------- Master Render Pipeline ---------- */

    function render() {
        renderUserProfile();
        renderStats();
        renderAssignments();
        renderWeeklyChart();
    }

    function renderStats() {
        var totalPoints = 0;
        var pending = 0;
        var active = 0;
        var todayIdx = new Date().getDay();

        assignments.forEach(function (a) {
            var allDone = true;
            a.milestones.forEach(function (m) {
                if (m.done) totalPoints += m.points;
                else { pending++; allDone = false; }
            });
            if (!allDone) active++;
        });

        var ptEl = document.getElementById('totalPoints');
        var actEl = document.getElementById('statActive');
        var pendEl = document.getElementById('statPending');
        var todEl = document.getElementById('statToday');

        if (ptEl) animateNumber(ptEl, totalPoints);
        if (actEl) animateNumber(actEl, active);
        if (pendEl) animateNumber(pendEl, pending);
        if (todEl) todEl.textContent = weeklyPoints[todayIdx] + ' pts';
    }

    function animateNumber(el, to) {
        var from = parseInt(el.textContent) || 0;
        var start = null;
        var duration = 600;
        function step(ts) {
            if (!start) start = ts;
            var p = Math.min((ts - start) / duration, 1);
            el.textContent = Math.round(from + (to - from) * p);
            if (p < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    }

    function renderAssignments() {
        if (!assignmentList) return;
        assignmentList.innerHTML = '';

        if (assignments.length === 0) {
            if (emptyState) assignmentList.appendChild(emptyState);
            return;
        }

        assignments.forEach(function (a, aIdx) {
            var doneCount = a.milestones.filter(function (m) { return m.done; }).length;
            var pct = Math.round((doneCount / a.milestones.length) * 100);
            var daysLeft = daysBetween(a.due);
            var complete = doneCount === a.milestones.length;

            var pillClass = complete ? 'complete' : (daysLeft < 0 ? 'overdue' : 'due');
            var pillText = complete ? 'Completed' : (daysLeft < 0 ? 'Overdue' : (daysLeft === 0 ? 'Due today' : daysLeft + ' days left'));

            var card = document.createElement('div');
            card.className = 'assignment-card';
            card.style.animationDelay = (aIdx * 0.08) + 's';

            var milestonesHtml = a.milestones.map(function (m, mIdx) {
                return '<div class="milestone-row' + (m.done ? ' done' : '') + '">' +
                    '<input type="checkbox" ' + (m.done ? 'checked' : '') + ' onchange="window.__toggleMilestone(\'' + a.id + '\', ' + mIdx + ')">' +
                    '<div class="m-info"><b>' + m.label + ' &middot; ' + m.dateLabel + '</b><span>' + m.hours + ' hrs planned</span></div>' +
                    '<div class="m-points">+' + m.points + ' pts</div>' +
                    '</div>';
            }).join('');

            card.innerHTML =
                '<div class="assignment-top">' +
                    '<div>' +
                        '<h4>' + escapeHtml(a.name) + '</h4>' +
                        '<div class="assignment-meta">' +
                            '<span>' + a.estHours + ' hrs estimated</span>' +
                            '<span>' + a.totalPoints + ' pts total</span>' +
                        '</div>' +
                    '</div>' +
                    '<div style="display:flex; align-items:center; gap:10px;">' +
                        '<div class="pill ' + pillClass + '">' + pillText + '</div>' +
                        '<button class="delete-btn" onclick="window.__deleteAssignment(\'' + a.id + '\')">Remove</button>' +
                    '</div>' +
                '</div>' +
                '<div class="progress-track"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
                '<div class="milestone-list">' + milestonesHtml + '</div>';

            assignmentList.appendChild(card);
        });
    }

    function renderWeeklyChart() {
        if (!weeklyBarsEl) return;
        weeklyBarsEl.innerHTML = '';
        var maxVal = Math.max.apply(null, weeklyPoints.concat([20]));
        var todayIdx = new Date().getDay();

        DAY_NAMES.forEach(function (day, i) {
            var val = weeklyPoints[i];
            var heightPx = Math.max((val / maxVal) * 130, 4);

            var col = document.createElement('div');
            col.className = 'bar-col';
            col.innerHTML =
                '<span class="bar-val">' + val + '</span>' +
                '<div class="bar" style="height:0px" data-h="' + heightPx + '"></div>' +
                '<span class="day-label" style="' + (i === todayIdx ? 'color:#1554c9; font-weight:700;' : '') + '">' + day + '</span>';
            weeklyBarsEl.appendChild(col);
        });

        requestAnimationFrame(function () {
            document.querySelectorAll('.bar').forEach(function (bar) {
                bar.style.height = bar.dataset.h + 'px';
            });
        });
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /* ---------- Boot once the real user is known ---------- */
    function bootWithUser(user) {
        currentUser = {
            uid: user.uid,
            name: user.displayName || user.email || 'Student',
            email: user.email || '',
            role: 'student'
        };
        STORAGE_KEY = 'divedu_assignments_' + currentUser.uid;
        WEEK_KEY = 'divedu_weekly_points_' + currentUser.uid;
        assignments = loadAssignments();
        weeklyPoints = loadWeekly();
        render();
    }

    if (window.firebase && firebase.apps && firebase.apps.length && window.auth) {
        // Fires immediately with the cached user if one is already
        // signed in, so there's no flash of "Guest Student".
        auth.onAuthStateChanged(function (user) {
            if (user) bootWithUser(user);
        });
    } else {
        // Fallback if this file is ever opened without Firebase wired
        // up (e.g. a static preview) — keeps the UI from being blank.
        render();
    }

})();