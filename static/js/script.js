console.log("script.js file is loaded by the browser.");

document.addEventListener('DOMContentLoaded', function() {
    console.log("DOM fully loaded and parsed. Attaching event listeners.");
    // --- Nap Plan Modal Logic ---
    const planNapBtn = document.getElementById('plan-nap-btn');
    const planNapModal = document.getElementById('plan-nap-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');

    if (planNapBtn && planNapModal) {
        // Show modal on "Plan Nap Schedule" button click
        planNapBtn.addEventListener('click', () => {
            planNapModal.classList.remove('hidden');
        });
    }

    if (closeModalBtn && planNapModal) {
        // Hide modal on "Cancel" button click
        closeModalBtn.addEventListener('click', () => {
            planNapModal.classList.add('hidden');
        });
    }

    // Hide modal on clicking the background overlay
    if (planNapModal) {
        planNapModal.addEventListener('click', (event) => {
            // We check if the click is on the modal background itself, not on its children
            if (event.target === planNapModal) {
                planNapModal.classList.add('hidden');
            }
        });
    }

    // --- Start Nap Timer Logic ---
    const startNapBtn = document.getElementById('start-nap-btn');
    if (startNapBtn) {
        startNapBtn.addEventListener('click', () => {
            console.log('Start Nap Timer button clicked');
            // Send a POST request to the /log_nap endpoint
            fetch('/log_nap', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    event: 'start_nap',
                    timestamp: new Date().toISOString(),
                }),
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                console.log('Success:', data);
                // Here you could update the UI, for example, by changing the status card
                alert('Nap timer started! (Check console for details)');
            })
            .catch((error) => {
                console.error('Error:', error);
                alert('Failed to start nap timer.');
            });
        });
    }

    // --- Schedule Toggle Logic ---
    const scheduleHeader = document.getElementById('schedule-header');
    const scheduleList = document.getElementById('schedule-list');
    const scheduleToggleIcon = document.getElementById('schedule-toggle-icon');

    if (scheduleHeader && scheduleList && scheduleToggleIcon) {
        scheduleHeader.addEventListener('click', () => {
            scheduleList.classList.toggle('hidden');
            scheduleToggleIcon.classList.toggle('rotate-180');
        });
    }
});