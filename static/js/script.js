console.log("script.js file is loaded by the browser.");

document.addEventListener('DOMContentLoaded', function() {
    console.log("DOM fully loaded and parsed. Attaching event listeners.");

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
                console.log('Bedtime started (night sleep)');
                // In the future, this will call: POST /api/day/bedtime { type: "sleep" }
            } else {
                // --- Change back to "Start Bedtime" state ---
                bedtimeBtn.textContent = 'Start Bedtime'; // Or maybe "New Day Started"
                bedtimeBtn.classList.remove('bg-amber-500', 'hover:bg-amber-600');
                bedtimeBtn.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
                console.log('Bedtime ended (morning wake up)');

                // This is the crucial call to set firstWakeAt
                fetch('/api/day/bedtime', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type: 'wake', timestamp: new Date().toISOString() })
                })
                .then(res => res.json())
                .then(data => console.log('Wake time logged:', data))
                .catch(console.error);
            }
        });
    }

    // --- Nap Controls Logic ---
    const napControlBtn = document.getElementById('nap-control-btn');
    const napTimerContainer = document.getElementById('nap-timer-container');
    const napTimerDisplay = document.getElementById('nap-timer-display');

    let isNapActive = false;
    let napTimerInterval = null;
    let napEndTime = 0;
    const NAP_DURATION_MS = 45 * 60 * 1000; // 45 minutes for now

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

    function startNap() {
        isNapActive = true;

        // Update button to "Stop Nap"
        napControlBtn.textContent = 'Stop Nap';
        napControlBtn.classList.remove('bg-green-500', 'hover:bg-green-600');
        napControlBtn.classList.add('bg-red-500', 'hover:bg-red-600');

        // Start timer
        napEndTime = Date.now() + NAP_DURATION_MS;
        updateTimerDisplay(); // Initial display to avoid 1s delay
        napTimerInterval = setInterval(updateTimerDisplay, 1000);

        // Log start event to backend using the new API
        // Placeholder: We need a way to know which nap index this is.
        const napIndex = 1; 
        fetch('/api/naps/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ index: napIndex, timestamp: new Date().toISOString() }),
        }).then(res => res.json()).then(data => console.log('API /api/naps/start response:', data)).catch(console.error);
    }

    function stopNap(logEvent = true) {
        isNapActive = false;
        clearInterval(napTimerInterval);
        napTimerInterval = null;

        // Update button to "Start Nap"
        napControlBtn.textContent = 'Start Nap';
        napControlBtn.classList.remove('bg-red-500', 'hover:bg-red-600');
        napControlBtn.classList.add('bg-green-500', 'hover:bg-green-600');

        // Reset timer display
        resetTimerDisplay();

        // Log stop event to backend if triggered by user
        if (logEvent) {
            // Placeholder: We need a way to know which nap index this is.
            const napIndex = 1;
            fetch('/api/naps/stop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ index: napIndex, timestamp: new Date().toISOString() }),
            }).then(res => res.json()).then(data => console.log('API /api/naps/stop response:', data)).catch(console.error);
        }
    }

    if (napControlBtn) {
        resetTimerDisplay(); // Set initial timer value on page load
        napControlBtn.addEventListener('click', () => {
            isNapActive ? stopNap() : startNap();
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
});