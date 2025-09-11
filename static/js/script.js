console.log("script.js file is loaded by the browser.");

document.addEventListener('DOMContentLoaded', function() {
    console.log("DOM fully loaded and parsed. Attaching event listeners.");

    // --- State Management ---
    let appState = {
        day: null,
        naps: [],
        currentNap: null,
        nextNap: null,
    };

    /**
     * Fetches the schedule for today from the backend.
     */
    async function fetchTodaySchedule() {
        try {
            const response = await fetch('/api/day/today');
            const data = await response.json();

            // The backend returns a 200 OK with a "not_found" status if no schedule exists
            if (data.status === 'not_found') {
                console.log("No schedule found for today. Ready to start a new day.");
                // Reset state and render the empty UI
                appState.day = null;
                appState.naps = [];
                renderSchedule(); // <-- This will clear the UI and show the "empty" state
                return;
            }

            console.log("Received schedule data:", data);
            
            // Store the data in our state object
            appState.day = data.day;
            appState.naps = data.naps;

            // Find the current or next nap
            appState.currentNap = appState.naps.find(nap => nap.status === 'in_progress');
            appState.nextNap = appState.naps.find(nap => nap.status === 'upcoming');

            // Now, update the UI with the new data
            renderSchedule();

        } catch (error) {
            console.error("Failed to fetch schedule:", error);
        }
    }

    // --- Status Card Elements ---
    const statusCard = document.getElementById('status-card');
    const statusIconContainer = document.getElementById('status-icon-container');
    const statusMessage = document.getElementById('status-message');
    const nextNapContainer = document.getElementById('next-nap-container');
    const nextEventLabel = document.getElementById('next-event-label');
    const nextEventTime = document.getElementById('next-event-time');
    const awakeIcon = document.getElementById('awake-icon');
    const asleepIcon = document.getElementById('asleep-icon');

    /**
     * Renders the entire schedule UI based on the current appState.
     */
    function renderSchedule() {
        const scheduleList = document.getElementById('schedule-list');
        const scheduleSummary = document.getElementById('schedule-summary');

        // Always clear the list first
        scheduleList.innerHTML = '';

        if (!appState.day) {
            // This block now runs when the page loads and no schedule exists
            statusMessage.textContent = "Ready to start the day!";
            scheduleSummary.textContent = "Wake up time not logged yet.";
            nextNapContainer.style.display = 'none'; // Hide the time display
            return; // Stop the function here
        }

        // This part will run only when there IS a schedule
        nextNapContainer.style.display = 'block'; // Show the time display again

        // Populate the schedule list
        appState.naps.forEach(nap => {
            const li = document.createElement('li');
            li.className = "flex items-center justify-between p-4 bg-gray-50 rounded-xl";

            // Determine nap duration to display (adjusted or planned)
            const durationSec = nap.adjusted_duration_sec || nap.planned_duration_sec;
            const durationMin = Math.round(durationSec / 60);

            // Simple time formatting (a more robust library could be used later)
            const napTime = `Nap ${nap.nap_index}`; // Placeholder for now

            li.innerHTML = `
                <div class="flex items-center space-x-4">
                    <div class="w-2 h-2 rounded-full ${nap.status === 'finished' ? 'bg-gray-400' : nap.status === 'in_progress' ? 'bg-blue-500' : 'bg-green-400'}"></div>
                    <div>
                        <p class="font-semibold text-gray-800">${napTime} <span class="text-sm font-normal text-gray-500">(${durationMin} min)</span></p>
                        <p class="text-xs font-medium ${nap.status === 'finished' ? 'text-gray-600' : 'text-green-600'}">${nap.status.replace('_', ' ')}</p>
                    </div>
                </div>
                <button class="edit-nap-btn text-sm font-semibold text-blue-600 hover:text-blue-800">Edit</button>
            `;
            scheduleList.appendChild(li);
        });

        // Update the summary text
        const remainingNaps = appState.naps.filter(n => n.status === 'upcoming').length;
        scheduleSummary.textContent = `${remainingNaps} naps remaining • Next: Nap ${appState.nextNap?.nap_index || 'N/A'}`;

        // Update the main status card
        if (appState.currentNap) {
            setBabyStatus(true); // Asleep
            napControlBtn.textContent = 'Stop Nap';
            napControlBtn.classList.remove('bg-green-500', 'hover:bg-green-600');
            napControlBtn.classList.add('bg-red-500', 'hover:bg-red-600');
            // TODO: Further update nextEventTime with wake-up time
        } else {
            setBabyStatus(false); // Awake
            napControlBtn.textContent = 'Start Nap';
            napControlBtn.classList.remove('bg-red-500', 'hover:bg-red-600');
            napControlBtn.classList.add('bg-green-500', 'hover:bg-green-600');
            // TODO: Further update nextEventTime with next nap time
        }
    }

    // --- Nap Controls Logic ---
    const napControlBtn = document.getElementById('nap-control-btn');
    const napTimerContainer = document.getElementById('nap-timer-container');
    const napTimerDisplay = document.getElementById('nap-timer-display');

    // let isNapActive = false; // This is now derived from appState.currentNap
    let napTimerInterval = null;
    let napEndTime = 0;
    const NAP_DURATION_MS = 45 * 60 * 1000; // 45 minutes for now




    /**
     * Updates the baby status card UI.
     * @param {boolean} isAsleep - True if the baby is asleep, false otherwise.
     */
    function setBabyStatus(isAsleep) {
        if (isAsleep) {
            // --- Set to ASLEEP state ---
            statusMessage.textContent = 'Baby is asleep!';
            statusCard.classList.replace('bg-yellow-100/50', 'bg-indigo-100/50');
            statusIconContainer.classList.replace('text-yellow-500', 'text-indigo-500');
            statusMessage.classList.replace('text-yellow-800', 'text-indigo-800');
            
            // Update next event text and colors
            nextEventLabel.textContent = 'Next wake time is';
            nextEventTime.textContent = '10:15 AM'; // Placeholder for wake-up time
            nextEventLabel.classList.replace('text-yellow-700', 'text-indigo-700');
            nextEventTime.classList.replace('text-yellow-800', 'text-indigo-800');

            // Toggle icons
            awakeIcon.classList.add('hidden');
            asleepIcon.classList.remove('hidden');

        } else {
            // --- Set to AWAKE state ---
            statusMessage.textContent = 'Baby is awake!';
            statusCard.classList.replace('bg-indigo-100/50', 'bg-yellow-100/50');
            statusIconContainer.classList.replace('text-indigo-500', 'text-yellow-500');
            statusMessage.classList.replace('text-indigo-800', 'text-yellow-800');

            // Update next event text and colors
            nextEventLabel.textContent = 'Next nap at';
            nextEventTime.textContent = '9:30 AM'; // Placeholder for nap time
            nextEventLabel.classList.replace('text-indigo-700', 'text-yellow-700');
            nextEventTime.classList.replace('text-indigo-800', 'text-yellow-800');

            // Toggle icons
            awakeIcon.classList.remove('hidden');
            asleepIcon.classList.add('hidden');
        }
    }


    // --- Bedtime Button Logic ---
    const bedtimeBtn = document.getElementById('bedtime-btn');
    let isBedtimeActive = false; // Track bedtime state

    if (bedtimeBtn) {
        bedtimeBtn.addEventListener('click', () => {
            isBedtimeActive = !isBedtimeActive; // Toggle the state

            if (isBedtimeActive) {
                // --- Change to "End Bedtime" state ---
                bedtimeBtn.textContent = 'End Bedtime';
                bedtimeBtn.classList.remove('bg-indigo-600', 'hover:bg-indigo-700');
                bedtimeBtn.classList.add('bg-amber-500', 'hover:bg-amber-600');
                setBabyStatus(true); // Update status to asleep
                console.log('Bedtime started (night sleep)');
                // In the future, this will call: POST /api/day/bedtime { type: "sleep" }
            } else {
                // --- Change back to "Start Bedtime" state ---
                bedtimeBtn.textContent = 'Start Bedtime'; // Or maybe "New Day Started"
                bedtimeBtn.classList.remove('bg-amber-500', 'hover:bg-amber-600');
                bedtimeBtn.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
                setBabyStatus(false); // Update status to awake
                console.log('Bedtime ended (morning wake up)');

                // This is the crucial call to set firstWakeAt
                fetch('/api/day/bedtime', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type: 'wake', timestamp: new Date().toISOString() })
                })
                .then(res => res.json())
                .then(data => {
                    console.log('Wake time logged:', data);
                    fetchTodaySchedule(); // <-- ADD THIS LINE
                })
                .catch(console.error);
            }
        });
    }

    function resetTimerDisplay() {
        const minutes = Math.floor((NAP_DURATION_MS % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((NAP_DURATION_MS % (1000 * 60)) / 1000);
        napTimerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    function updateTimerDisplay() {
        const now = Date.now();
        const timeLeft = napEndTime - now;

        if (timeLeft <= 0) {
            napTimerDisplay.textContent = '00:00';
            stopNap(false); // Stop without logging a user event
            alert("Nap time is over!");
            return;
        }

        const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);

        napTimerDisplay.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    // Replace your existing startNap function with this
    function startNap() {
        if (!appState.nextNap) {
            alert("No upcoming nap to start!");
            return;
        }

        const napIndex = appState.nextNap.nap_index;
        
        fetch('/api/naps/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ index: napIndex, timestamp: new Date().toISOString() }),
        })
        .then(res => res.json())
        .then(data => {
            console.log('API /api/naps/start response:', data);
            if (data.status === 'success') {
                fetchTodaySchedule(); // <-- Refresh the UI
            }
        })
        .catch(console.error);
    }

    // Replace your existing stopNap function with this
    function stopNap() {
        if (!appState.currentNap) {
            // This case might happen if a timer ends automatically
            // For now, we'll just refresh. A more robust solution could be added later.
            fetchTodaySchedule();
            return;
        }
        
        const napIndex = appState.currentNap.nap_index;

        fetch('/api/naps/stop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ index: napIndex, timestamp: new Date().toISOString() }),
        })
        .then(res => res.json())
        .then(data => {
            console.log('API /api/naps/stop response:', data);
            if (data.status === 'success') {
                fetchTodaySchedule(); // <-- Refresh the UI
            }
        })
        .catch(console.error);
    }


    if (napControlBtn) {
        resetTimerDisplay(); // Set initial timer value on page load
        napControlBtn.addEventListener('click', () => {
            // The action now depends on the appState, not a local variable
            appState.currentNap ? stopNap() : startNap();
        });
    }


    // --- Schedule Toggle Logic ---
    const scheduleHeader = document.getElementById('schedule-header');
    const scheduleList = document.getElementById('schedule-list');
    const scheduleToggleIcon = document.getElementById('schedule-toggle-icon');

    if (scheduleHeader && scheduleList && scheduleToggleIcon) {
        // Toggle visibility on header click
        scheduleHeader.addEventListener('click', () => {
            scheduleList.classList.toggle('hidden');
            scheduleToggleIcon.classList.toggle('rotate-180');
        });

        // Handle editing within the list using event delegation
        scheduleList.addEventListener('click', (event) => {
            if (event.target.classList.contains('edit-nap-btn')) {
                alert('Edit button clicked! (Functionality to be implemented)');
                // Next step: Open a modal or inline form to edit the nap.
            }
        });
    }

    // Call this function when the DOM is loaded to get the initial state
    fetchTodaySchedule();
});