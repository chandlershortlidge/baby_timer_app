document.addEventListener('DOMContentLoaded', function() {
    console.log("DOM fully loaded and parsed. Attaching event listeners.");

    // --- State Management ---
    let appState = {
        day: null,
        naps: [],
        currentNap: null,
        nextNap: null,
    };
    let currentlyEditingNapIndex = null;
    let napTimerInterval = null;
    let napEndTime = 0;

    // --- Element Getters (Define all element variables here) ---
    const bedtimeBtn = document.getElementById('bedtime-btn');
    const statusCard = document.getElementById('status-card');
    const statusIconContainer = document.getElementById('status-icon-container');
    const statusMessage = document.getElementById('status-message');
    const nextNapContainer = document.getElementById('next-nap-container');
    const nextEventLabel = document.getElementById('next-event-label');
    const nextEventTime = document.getElementById('next-event-time');
    const awakeIcon = document.getElementById('awake-icon');
    const asleepIcon = document.getElementById('asleep-icon');
    const napControlBtn = document.getElementById('nap-control-btn');
    const napTimerContainer = document.getElementById('nap-timer-container');
    const napTimerDisplay = document.getElementById('nap-timer-display');
    const scheduleHeader = document.getElementById('schedule-header');
    const scheduleList = document.getElementById('schedule-list');
    const scheduleSummary = document.getElementById('schedule-summary'); // Added for safety
    const scheduleToggleIcon = document.getElementById('schedule-toggle-icon');
    const editModal = document.getElementById('edit-nap-modal');
    const editModalTitle = document.getElementById('edit-modal-title');
    const durationInput = document.getElementById('edit-nap-duration-input');
    const saveBtn = document.getElementById('save-edit-btn');
    const cancelBtn = document.getElementById('cancel-edit-btn');

    // --- Centralized Event Listeners ---
    if (bedtimeBtn) {
        let isBedtimeActive = false;
        bedtimeBtn.addEventListener('click', () => {
             isBedtimeActive = !isBedtimeActive;
            if (isBedtimeActive) {
                bedtimeBtn.textContent = 'End Bedtime';
                bedtimeBtn.classList.remove('bg-indigo-600', 'hover:bg-indigo-700');
                bedtimeBtn.classList.add('bg-amber-500', 'hover:bg-amber-600');
                console.log('Bedtime started (night sleep)');
            } else {
                bedtimeBtn.textContent = 'Start Bedtime';
                bedtimeBtn.classList.remove('bg-amber-500', 'hover:bg-amber-600');
                bedtimeBtn.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
                console.log('Bedtime ended (morning wake up)');
                fetch('/api/day/bedtime', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type: 'wake', timestamp: new Date().toISOString() })
                })
                .then(res => res.json())
                .then(data => {
                    console.log('Wake time logged:', data);
                    fetchTodaySchedule();
                })
                .catch(console.error);
            }
        });
    }

    if (napControlBtn) {
        napControlBtn.addEventListener('click', () => {
            appState.currentNap ? stopNap() : startNap();
        });
    }

    if (scheduleHeader) {
        scheduleHeader.addEventListener('click', () => {
            scheduleList.classList.toggle('hidden');
            if (scheduleToggleIcon) scheduleToggleIcon.classList.toggle('rotate-180');
        });
    }

    if (scheduleList) {
        scheduleList.addEventListener('click', (event) => {
            console.log("Click detected inside the schedule list. Target:", event.target); // <-- ADD THIS LINE
            if (event.target.classList.contains('edit-nap-btn')) {
                console.log("The EDIT button was clicked."); // <-- ADD THIS LINE
                const napIndex = parseInt(event.target.dataset.napIndex, 10);
                const napToEdit = appState.naps.find(n => n.nap_index === napIndex);
                if (napToEdit) {
                    openEditModal(napToEdit);
                }
            }
        });
    }

    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            const newDurationMin = parseInt(durationInput.value, 10);
            if (isNaN(newDurationMin) || newDurationMin <= 0) {
                alert("Please enter a valid duration in minutes.");
                return;
            }
            fetch('/api/naps/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ index: currentlyEditingNapIndex, duration_min: newDurationMin })
            })
            .then(res => res.json())
            .then(data => {
                if (data.status === 'success') {
                    closeEditModal();
                    fetchTodaySchedule();
                } else {
                    alert(`Error: ${data.message}`);
                }
            })
            .catch(console.error);
        });
    }

    if (cancelBtn) {
        cancelBtn.addEventListener('click', closeEditModal);
    }

    // --- Core Functions ---

    async function fetchTodaySchedule() {
        try {
            const response = await fetch('/api/day/today');
            const data = await response.json();

            if (data.status === 'not_found') {
                console.log("No schedule found for today. Ready to start a new day.");
                appState.day = null;
                appState.naps = [];
                renderSchedule();
                return;
            }

            console.log("Received schedule data:", data);
            appState.day = data.day;
            appState.naps = data.naps;
            appState.currentNap = appState.naps.find(nap => nap.status === 'in_progress');
            appState.nextNap = appState.naps.find(nap => nap.status === 'upcoming');
            renderSchedule();
        } catch (error) {
            console.error("Failed to fetch schedule:", error);
        }
    }

    function renderSchedule() {
        if (!scheduleList || !scheduleSummary || !statusMessage || !nextNapContainer) return;

        scheduleList.innerHTML = '';
        if (!appState.day) {
            statusMessage.textContent = "Ready to start the day!";
            scheduleSummary.textContent = "Wake up time not logged yet.";
            nextNapContainer.style.display = 'none';
            return;
        }

        nextNapContainer.style.display = 'block';
        let lastEventEndTime = new Date(appState.day.first_wake_at);
        let nextUpcomingNapTime = null;
        const WAKE_WINDOWS_MIN = [120, 150, 150, 180];

        appState.naps.forEach((nap, index) => {
            const li = document.createElement('li');
            li.className = "flex items-center justify-between p-4 bg-gray-50 rounded-xl";
            const durationSec = nap.adjusted_duration_sec || nap.planned_duration_sec;
            const durationMin = Math.round(durationSec / 60);
            const wakeWindowMs = (WAKE_WINDOWS_MIN[index] || WAKE_WINDOWS_MIN[WAKE_WINDOWS_MIN.length - 1]) * 60 * 1000;
            const projectedStartAt = new Date(lastEventEndTime.getTime() + wakeWindowMs);
            const displayTime = nap.actual_start_at ? new Date(nap.actual_start_at) : projectedStartAt;
            if (nap.status === 'upcoming' && !nextUpcomingNapTime) {
                nextUpcomingNapTime = displayTime;
            }
            li.innerHTML = `
                <div class="flex items-center space-x-4">
                    <div class="w-2 h-2 rounded-full ${nap.status === 'finished' ? 'bg-gray-400' : nap.status === 'in_progress' ? 'bg-blue-500' : 'bg-green-400'}"></div>
                    <div>
                        <p class="font-semibold text-gray-800">${formatTime(displayTime)} <span class="text-sm font-normal text-gray-500">(${durationMin} min)</span></p>
                        <p class="text-xs font-medium ${nap.status === 'finished' ? 'text-gray-600' : 'text-green-600'}">${nap.status.replace('_', ' ')}</p>
                    </div>
                </div>
                <button data-nap-index="${nap.nap_index}" class="edit-nap-btn text-sm font-semibold text-blue-600 hover:text-blue-800">Edit</button>
            `;
            scheduleList.appendChild(li);
            const napEndAt = nap.actual_end_at ? new Date(nap.actual_end_at) : new Date(displayTime.getTime() + durationSec * 1000);
            lastEventEndTime = napEndAt;
        });

        const remainingNaps = appState.naps.filter(n => n.status === 'upcoming').length;
        scheduleSummary.textContent = `${remainingNaps} naps remaining • Next: ${formatTime(nextUpcomingNapTime)}`;

        if (napTimerInterval) {
            clearInterval(napTimerInterval);
            napTimerInterval = null;
        }
        
        if (appState.currentNap) {
            setBabyStatus(true, new Date(new Date(appState.currentNap.actual_start_at).getTime() + (appState.currentNap.adjusted_duration_sec || appState.currentNap.planned_duration_sec) * 1000));
            napControlBtn.textContent = 'Stop Nap';
            napControlBtn.disabled = false;
            napControlBtn.className = 'w-full bg-red-500 text-white font-bold py-4 px-6 rounded-2xl shadow-lg hover:bg-red-600 transition-colors';
            const napDurationSec = appState.currentNap.adjusted_duration_sec || appState.currentNap.planned_duration_sec;
            const startTime = new Date(appState.currentNap.actual_start_at).getTime();
            napEndTime = startTime + (napDurationSec * 1000);
            updateTimerDisplay();
            napTimerInterval = setInterval(updateTimerDisplay, 1000);
            napTimerContainer.style.display = 'block';
        } else {
            setBabyStatus(false, nextUpcomingNapTime);
            napControlBtn.textContent = appState.nextNap ? 'Start Nap' : 'All Naps Finished';
            napControlBtn.className = 'w-full bg-green-500 text-white font-bold py-4 px-6 rounded-2xl shadow-lg hover:bg-green-600 transition-colors';
            napTimerContainer.style.display = 'none';
            if (!appState.nextNap) {
                napControlBtn.disabled = true;
                napControlBtn.classList.add('opacity-50', 'cursor-not-allowed');
            } else {
                napControlBtn.disabled = false;
                napControlBtn.classList.remove('opacity-50', 'cursor-not-allowed');
            }
        }
    }

    function setBabyStatus(isAsleep, eventTime) {
        if (!statusMessage || !statusCard || !statusIconContainer || !nextEventLabel || !nextEventTime || !awakeIcon || !asleepIcon) return;
        if (isAsleep) {
            statusMessage.textContent = 'Baby is asleep!';
            statusCard.className = 'bg-indigo-100/50 rounded-3xl p-6 text-center shadow-lg';
            statusIconContainer.className = 'w-16 h-16 mx-auto text-indigo-500';
            statusMessage.className = 'text-xl font-bold mt-4 text-indigo-800';
            nextEventLabel.textContent = 'Next wake time is';
            nextEventTime.textContent = formatTime(eventTime);
            nextEventLabel.className = 'text-lg text-indigo-700 mt-2';
            nextEventTime.className = 'text-4xl font-extrabold text-indigo-800';
            awakeIcon.classList.add('hidden');
            asleepIcon.classList.remove('hidden');
        } else {
            statusMessage.textContent = 'Baby is awake!';
            statusCard.className = 'bg-yellow-100/50 rounded-3xl p-6 text-center shadow-lg';
            statusIconContainer.className = 'w-16 h-16 mx-auto text-yellow-500';
            statusMessage.className = 'text-xl font-bold mt-4 text-yellow-800';
            nextEventLabel.textContent = 'Next nap at';
            nextEventTime.textContent = formatTime(eventTime);
            nextEventLabel.className = 'text-lg text-yellow-700 mt-2';
            nextEventTime.className = 'text-4xl font-extrabold text-yellow-800';
            awakeIcon.classList.remove('hidden');
            asleepIcon.classList.add('hidden');
        }
    }

    function startNap() {
        if (!appState.nextNap) return alert("No upcoming nap to start!");
        const napIndex = appState.nextNap.nap_index;
        fetch('/api/naps/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ index: napIndex, timestamp: new Date().toISOString() }),
        })
        .then(res => res.json())
        .then(data => {
            console.log('API /api/naps/start response:', data);
            if (data.status === 'success') fetchTodaySchedule();
        })
        .catch(console.error);
    }

    function stopNap() {
        if (!appState.currentNap) return fetchTodaySchedule();
        const napIndex = appState.currentNap.nap_index;
        fetch('/api/naps/stop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ index: napIndex, timestamp: new Date().toISOString() }),
        })
        .then(res => res.json())
        .then(data => {
            console.log('API /api/naps/stop response:', data);
            if (data.status === 'success') fetchTodaySchedule();
        })
        .catch(console.error);
    }

    function updateTimerDisplay() {
        if (!napTimerDisplay) return;
        const timeLeft = napEndTime - Date.now();
        if (timeLeft <= 0) {
            napTimerDisplay.textContent = '00:00';
            clearInterval(napTimerInterval);
            alert("Nap time is over!");
            fetchTodaySchedule();
            return;
        }
        const minutes = Math.floor((timeLeft / 1000 / 60) % 60);
        const seconds = Math.floor((timeLeft / 1000) % 60);
        napTimerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    
    function openEditModal(nap) {
        console.log("openEditModal function was called for nap:", nap); // <-- ADD THIS LINE

        // Let's inspect the elements right before we use them
        console.log("editModal:", editModal); // <-- ADD THIS LINE
        console.log("editModalTitle:", editModalTitle); // <-- ADD THIS LINE
        console.log("durationInput:", durationInput); // <-- ADD THIS LINE
        if (!editModal || !editModalTitle || !durationInput) {
            console.error("One or more modal elements were not found! Check your HTML IDs."); // <-- ADD THIS LINE
            return;
        }
        currentlyEditingNapIndex = nap.nap_index;
        editModalTitle.textContent = `Edit Nap ${nap.nap_index} Duration`;
        const currentDuration = nap.adjusted_duration_sec || nap.planned_duration_sec;
        durationInput.value = Math.round(currentDuration / 60);
        editModal.classList.remove('hidden');
    }

    function closeEditModal() {
        if (!editModal) return;
        currentlyEditingNapIndex = null;
        editModal.classList.add('hidden');
    }

    function formatTime(date) {
        if (!date || isNaN(new Date(date))) return 'N/A';
        return new Date(date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    }

    // --- Initial Load ---
    fetchTodaySchedule();
});