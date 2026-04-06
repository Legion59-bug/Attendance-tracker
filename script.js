const CLERK_PUBLISHABLE_KEY = 'pk_test_d2VsY29tZS1taWRnZS0xMS5jbGVyay5hY2NvdW50cy5kZXYk';
const SUPABASE_URL = 'https://oxnctbdoybtdlpijxsgn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im94bmN0YmRveWJ0ZGxwaWp4c2duIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzMjQ5NTAsImV4cCI6MjA5MDkwMDk1MH0.3eDOu6augGyaybMA2MJCjgdmb859XP1D01Ddjao-xfA';

// Initialize Supabase using standard keys. 
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let subjects = [];
let routines = [];
let clerkUser = null;
let targetPercentage = parseInt(localStorage.getItem('bunksafe_target')) || 75;

// DOM Elements
const authContainer = document.getElementById('auth-container');
const appContent = document.getElementById('app-content');
const userButtonDiv = document.getElementById('user-button');
const targetInput = document.getElementById('global-target');
const form = document.getElementById('add-subject-form');
const grid = document.getElementById('subjects-grid');
const template = document.getElementById('subject-card-template');

// New Routine Elements
const routineForm = document.getElementById('add-routine-form');
const routineList = document.getElementById('routine-list');
const todayRoutineList = document.getElementById('today-routine-list');

// Insights Elements
const statTotalSubs = document.getElementById('stat-total-subs');
const statTodayClasses = document.getElementById('stat-today-classes');
const statDangerSubs = document.getElementById('stat-danger-subs');
const homeGreeting = document.getElementById('home-greeting');

// Navigation Elements
const navItems = document.querySelectorAll('.nav-item');
const viewSections = document.querySelectorAll('.view-section');

// Set target UI from localstorage
if (targetInput) {
    targetInput.value = targetPercentage;
    targetInput.addEventListener('input', (e) => {
        let val = parseInt(e.target.value);
        if (!val || val < 1 || val > 100) return;
        targetPercentage = val;
        localStorage.setItem('bunksafe_target', targetPercentage);
        renderDashboard();
    });
}

// Initialize Clerk
async function initApp() {
    try {
        if (!window.Clerk) {
            throw new Error("Clerk library completely failed to load.");
        }
        
        const clerk = window.Clerk;
        await clerk.load({ publishableKey: CLERK_PUBLISHABLE_KEY });

        if (clerk.user) {
            clerkUser = clerk.user;
            appContent.style.display = 'block';
            authContainer.style.display = 'none';
            clerk.mountUserButton(userButtonDiv);
            
            // Mount User Profile in the Account Tab
            const portal = document.getElementById('account-portal');
            if (portal) {
                clerk.mountUserProfile(portal);
            }

            await loadData();
        } else {
            appContent.style.display = 'none';
            authContainer.style.display = 'flex';
            clerk.mountSignIn(authContainer, {
                afterSignInUrl: window.location.href,
                afterSignUpUrl: window.location.href 
            });
        }
    } catch (e) {
        console.error("Clerk init error: ", e);
        authContainer.style.display = 'flex';
        authContainer.innerHTML = `<p style="color: red; background: rgba(255,0,0,0.1); padding: 1rem; border-radius: 8px;">
            <strong>Authentication Error</strong><br>
            Could not load Clerk Authentication. <br><br>
            Error details: ${e.message}
        </p>`;
    }
}

// Load data from Supabase
async function loadData() {
    if (!clerkUser) return;
    
    grid.innerHTML = '<p style="text-align:center;">Loading subjects...</p>';
    
    // Load Subjects
    const { data: subData, error: subError } = await supabaseClient
        .from('subjects')
        .select('*')
        .eq('user_id', clerkUser.id)
        .order('created_at', { ascending: true });

    if (subError) {
        console.error('Supabase error loading subjects:', subError);
        if (subError.code === '42501' || subError.message.includes('Row level security')) {
            grid.innerHTML = `<p style="text-align:center; color: var(--danger-color); padding: 2rem;">
                <strong>Database Access Error!</strong><br>Disable RLS on "subjects" and "routines" tables.
            </p>`;
        }
        return;
    }
    subjects = subData || [];

    // Load Routines
    const { data: routData, error: routError } = await supabaseClient
        .from('routines')
        .select('*')
        .eq('user_id', clerkUser.id)
        .order('start_time', { ascending: true });

    if (!routError) {
        routines = routData || [];
    }

    renderDashboard();
    renderRoutines();
}

function assessAttendance(A, M) {
    const total = A + M;
    let currentPercentage = total > 0 ? (A / total) * 100 : 0;
    let stateClass = '', title = '', message = '';
    const targetDecimal = targetPercentage / 100;

    if (total === 0) {
        stateClass = 'state-warning';
        title = "Start of Semester!";
        message = "Attend the next class to stay on track.";
    } else if (currentPercentage >= targetPercentage) {
        let bunk = 0;
        while ((A / (total + bunk)) >= targetDecimal) bunk++;
        bunk--;
        if (bunk > 0) {
            stateClass = 'state-safe';
            title = "Safe to Bunk 😎";
            message = `You can skip ${bunk} class${bunk !== 1 ? 'es' : ''}.`;
        } else {
            stateClass = 'state-warning';
            title = "On the Edge ⚠️";
            message = `You're at ~${targetPercentage}%. Don't miss next class!`;
        }
    } else {
        let need = 0;
        while (((A + need) / (total + need)) < targetDecimal) need++;
        stateClass = 'state-danger';
        title = "Danger Zone 🚨";
        message = `Attend next ${need} class${need !== 1 ? 'es' : ''}.`;
    }

    return { percentage: currentPercentage, stateClass, title, message };
}

// Add new subject
if(form) {
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!clerkUser) return;

        const nameInput = document.getElementById('subject-name');
        const attInput = document.getElementById('initial-attended');
        const missInput = document.getElementById('initial-missed');

        const name = nameInput.value.trim();
        const attended = parseInt(attInput.value) || 0;
        const missed = parseInt(missInput.value) || 0;

        if (name === '') return;
        
        const submitBtn = form.querySelector('button[type="submit"]');
        const originalText = submitBtn.textContent;
        submitBtn.textContent = 'Adding...';
        submitBtn.disabled = true;

        const newSubject = { user_id: clerkUser.id, name, attended, missed };

        const { data, error } = await supabaseClient.from('subjects').insert([newSubject]).select();

        submitBtn.textContent = originalText;
        submitBtn.disabled = false;

        if (error) {
            alert('Failed to save subject. Error: ' + error.message);
            return;
        }

        if (data && data.length > 0) subjects.push(data[0]);

        nameInput.value = ''; attInput.value = ''; missInput.value = '';
        renderDashboard();
    });
}

// Add new routine
if (routineForm) {
    routineForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        if (!clerkUser) {
            alert("Security check failed: You are not properly logged in! Please refresh the page.");
            return;
        }

        const day = document.getElementById('routine-day').value;
        const className = document.getElementById('routine-class').value.trim();
        const startTime = document.getElementById('routine-start-time').value.trim();
        const endTime = document.getElementById('routine-end-time').value.trim();

        if (!className || !startTime || !endTime) {
            alert("Please make sure you have filled in the Class Name, Start Time, and End Time!");
            return;
        }

        const submitBtn = routineForm.querySelector('button[type="submit"]');
        const originalText = submitBtn.textContent;
        submitBtn.textContent = 'Saving...';
        submitBtn.disabled = true;

        const newRoutine = {
            user_id: clerkUser.id,
            day_of_week: day,
            class_name: className,
            start_time: startTime,
            end_time: endTime 
        };

        const { data, error } = await supabaseClient.from('routines').insert([newRoutine]).select();
        
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;

        if (error) {
            alert('Supabase Database Error: ' + error.message + '\n\nDid you forget to create the "routines" table or turn off RLS?');
            return;
        }

        if (data && data.length > 0) routines.push(data[0]);

        document.getElementById('routine-class').value = '';
        document.getElementById('routine-start-time').value = '';
        document.getElementById('routine-end-time').value = '';
        renderRoutines();
    });
}

// Handle actions
async function handleAction(id, type) {
    const subject = subjects.find(s => s.id === id);
    if (!subject) return;

    if (type === 'delete') {
        if (!confirm('Delete this subject?')) return;
        const { error } = await supabaseClient.from('subjects').delete().eq('id', id);
        if (error) return alert("Failed to delete.");
        subjects = subjects.filter(s => s.id !== id);
        renderDashboard();
        return;
    }

    let newAttended = subject.attended;
    let newMissed = subject.missed;

    if (type === 'attend') newAttended += 1;
    else if (type === 'bunk') newMissed += 1;

    const { error } = await supabaseClient.from('subjects').update({ attended: newAttended, missed: newMissed }).eq('id', id);

    if (error) return alert("Failed to update: " + error.message);

    subject.attended = newAttended;
    subject.missed = newMissed;
    renderDashboard();
}

// Handle Window scope routine delete & edit
window.deleteRoutine = async function(id) {
    if (!confirm('Delete this routine class?')) return;
    const { error } = await supabaseClient.from('routines').delete().eq('id', id);
    if (!error) {
        routines = routines.filter(r => r.id !== id);
        renderRoutines();
    }
}

window.editRoutineTime = async function(id, oldStart, oldEnd) {
    const newStart = prompt("Enter new Start Time:", oldStart);
    if (!newStart) return;
    const newEnd = prompt("Enter new End Time:", oldEnd);
    if (!newEnd) return;

    if (newStart === oldStart && newEnd === oldEnd) return;

    const { error } = await supabaseClient.from('routines').update({ start_time: newStart, end_time: newEnd }).eq('id', id);
    if (error) {
        alert("Failed to update routine time.");
        return;
    }
    
    const routine = routines.find(r => r.id === id);
    if (routine) {
        routine.start_time = newStart;
        routine.end_time = newEnd;
        renderRoutines();
    }
}

// Render Dashboard & Global Meter
function renderDashboard() {
    if(!grid) return;
    grid.innerHTML = '';
    
    let dangerCount = 0;

    if (subjects.length === 0) {
        grid.innerHTML = '<p style="text-align:center;">No subjects added yet.</p>';
    } else {
        subjects.forEach((subject) => {
            const clone = template.content.cloneNode(true);
            const card = clone.querySelector('.subject-card');

            clone.querySelector('.subject-title').textContent = subject.name;
            clone.querySelector('.att-count').textContent = subject.attended;
            clone.querySelector('.miss-count').textContent = subject.missed;

            const { percentage, stateClass, title, message } = assessAttendance(subject.attended, subject.missed);

            if (stateClass === 'state-danger') dangerCount++;

            card.classList.add(stateClass);
            clone.querySelector('.verdict-title').textContent = title;
            clone.querySelector('.verdict-message').textContent = message;
            clone.querySelector('.percentage-text').textContent = `${percentage.toFixed(2)}%`;

            clone.querySelector('.attend-btn').addEventListener('click', () => handleAction(subject.id, 'attend'));
            clone.querySelector('.bunk-btn').addEventListener('click', () => handleAction(subject.id, 'bunk'));
            clone.querySelector('.delete-btn').addEventListener('click', () => handleAction(subject.id, 'delete'));

            grid.appendChild(clone);
        });
    }

    renderHomeInsights(dangerCount);
}

function renderHomeInsights(dangerCount) {
    if (homeGreeting && clerkUser) {
        const name = clerkUser.firstName || 'Student';
        homeGreeting.textContent = `Welcome back, ${name}! 👋`;
    }

    if (statTotalSubs) statTotalSubs.textContent = subjects.length;
    if (statDangerSubs) statDangerSubs.textContent = dangerCount;
}

function renderRoutines() {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    
    // Render Full List in Routine Tab
    if (routineList) {
        routineList.innerHTML = '';
        if (routines.length === 0) {
            routineList.innerHTML = '<p style="text-align:center; color: var(--text-secondary);">No routines added yet.</p>';
        } else {
            days.forEach(day => {
                const dayRoutines = routines.filter(r => r.day_of_week === day);
                if (dayRoutines.length > 0) {
                    const group = document.createElement('div');
                    group.innerHTML = `<h4 style="margin: 1.5rem 0 0.5rem 0; color: var(--primary);">${day}</h4>`;
                    dayRoutines.forEach(r => {
                        const div = document.createElement('div');
                        div.style = "display:flex; justify-content:space-between; align-items:center; padding: 0.75rem; background: rgba(255,255,255,0.05); margin-bottom: 0.5rem; border-radius: 8px;";
                        div.innerHTML = `
                            <div><strong>${r.class_name}</strong> <span style="color:var(--text-secondary); font-size:0.85rem; margin-left:10px;">${r.start_time} - ${r.end_time}</span></div>
                            <div>
                                <button onclick="editRoutineTime('${r.id}', '${r.start_time}', '${r.end_time}')" title="Edit Time" style="background:none; border:none; cursor:pointer; margin-right:15px; font-size:1.1rem;">✏️</button>
                                <button onclick="deleteRoutine('${r.id}')" title="Delete" style="background:none; border:none; cursor:pointer; font-size:1.1rem;">❌</button>
                            </div>
                        `;
                        group.appendChild(div);
                    });
                    routineList.appendChild(group);
                }
            });
        }
    }

    // Render Today's in Home Tab
    if (todayRoutineList) {
        const todayStr = days[(new Date().getDay() + 6) % 7]; // Map JS Date (0=Sun) to our array (0=Mon)
        const todayRoutines = routines.filter(r => r.day_of_week === todayStr);
        
        if (todayRoutines.length === 0) {
            todayRoutineList.innerHTML = `<p style="text-align:center; color: var(--text-secondary);">No classes scheduled for today (${todayStr}). Free day!</p>`;
        } else {
            todayRoutineList.innerHTML = '';
            todayRoutines.forEach(r => {
                const div = document.createElement('div');
                div.style = "display:flex; justify-content:space-between; align-items:center; padding: 0.75rem; background: rgba(255,255,255,0.05); margin-bottom: 0.5rem; border-radius: 8px;";
                div.innerHTML = `
                    <div><strong>${r.class_name}</strong></div>
                    <div style="color:var(--text-secondary); font-size:0.85rem;">${r.start_time} - ${r.end_time}</div>
                `;
                todayRoutineList.appendChild(div);
            });
        }
        if (statTodayClasses) statTodayClasses.textContent = todayRoutines.length;
    }
}

// Navigation Logic
navItems.forEach(btn => {
    btn.addEventListener('click', () => {
        // Update Buttons
        navItems.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Target Section
        const targetId = btn.getAttribute('data-tab');

        // Hide all, show target
        viewSections.forEach(sec => {
            sec.style.display = 'none';
            sec.classList.remove('active');
        });

        const targetSec = document.getElementById(targetId);
        if (targetSec) {
            targetSec.style.display = targetId === 'tab-account' ? 'flex' : 'block';
            targetSec.classList.add('active');
        }
    });
});

// Start application
window.addEventListener('load', () => {
    initApp();
});