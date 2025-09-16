document.addEventListener('DOMContentLoaded', function() {
    console.log("DOM fully loaded and parsed. Attaching event listeners.");

    // --- State Management ---
    let appState = {
        day: null,
        naps: [],
        currentNap: null,
        nextNap: null,
        sleepSession: null,
    };
    let currentlyEditingNapIndex = null;
    let napTimerInterval = null;
    let napEndTime = 0;
    let sleepInfoInterval = null;
    let isBedtimeActive = false;
    let setBedtimeUIState = () => {};


    // Global dev clock (0 by default). Positive = pretend it's later.
    let clockOffsetMs = 0;

    function nowMs() {
    return Date.now() + clockOffsetMs;
    }
    function nowIso() {
    return new Date(nowMs()).toISOString();
    }



    // Prevents repeated "Nap time is over!" alerts
    let napOverNotified = false;

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
    const scheduleSummary = document.getElementById('schedule-summary');
    const scheduleToggleIcon = document.getElementById('schedule-toggle-icon');
    const sleepInfoContainer = document.getElementById('sleep-summary');
    const sleepDurationText = document.getElementById('sleep-duration-text');
    const wakeTimeText = document.getElementById('wake-time-text');

    // ---------- Modal helpers (lazy injection + safe lookups) ----------
    function ensureEditModal() {
        if (document.getElementById('edit-nap-modal')) return;

        const html = `
        <div id="edit-nap-modal"
             class="fixed inset-0 z-50 hidden"
             role="dialog" aria-modal="true" aria-labelledby="edit-modal-title">
          <div class="absolute inset-0 bg-black/50" data-edit-overlay></div>
          <div class="relative mx-auto mt-24 w-11/12 max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 id="edit-modal-title" class="text-lg font-semibold text-gray-800">
              Edit Nap Duration
            </h3>

            <label for="edit-nap-duration-input" class="mt-4 block text-sm text-gray-600">
              Duration (minutes)
            </label>
            <input
              id="edit-nap-duration-input"
              type="number" min="1" step="1"
              class="mt-1 w-full rounded-xl border border-gray-300 p-3 focus:outline-none focus:ring"
              placeholder="e.g. 45"
            />

            <div class="mt-6 flex justify-end gap-3">
              <button id="cancel-edit-btn"
                      class="rounded-xl bg-gray-100 px-4 py-2 text-gray-700 hover:bg-gray-200">
                Cancel
              </button>
              <button id="save-edit-btn"
                      class="rounded-xl bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700">
                Save
              </button>
            </div>
          </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', html);

        // Wire basic close actions now that it exists
        const modal = document.getElementById('edit-nap-modal');
        modal.querySelector('[data-edit-overlay]').onclick = closeEditModal;
        document.getElementById('cancel-edit-btn').onclick = closeEditModal;
        document.getElementById('save-edit-btn').onclick = handleSaveEdit;
    }

    function getModalEls() {
        // Ensure present before grabbing refs
        ensureEditModal();
        return {
            modal: document.getElementById('edit-nap-modal'),
            title: document.getElementById('edit-modal-title'),
            input: document.getElementById('edit-nap-duration-input'),
            save: document.getElementById('save-edit-btn'),
            cancel: document.getElementById('cancel-edit-btn'),
        };
    }

    // --- Centralized Event Listeners ---
    if (bedtimeBtn) {
      const applyBedtimeActiveUI = () => {
        bedtimeBtn.textContent = 'End Bedtime';
        bedtimeBtn.classList.remove('bg-indigo-600', 'hover:bg-indigo-700');
        bedtimeBtn.classList.add('bg-amber-500', 'hover:bg-amber-600');
        if (napControlBtn) {
          napControlBtn.disabled = true;
          napControlBtn.classList.add('opacity-50', 'cursor-not-allowed');
        }
        if (napTimerContainer) napTimerContainer.style.display = 'none';
      };

      const applyBedtimeInactiveUI = () => {
        bedtimeBtn.textContent = 'Start Bedtime';
        bedtimeBtn.classList.remove('bg-amber-500', 'hover:bg-amber-600');
        bedtimeBtn.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
        if (napControlBtn) {
          if (appState.day && appState.nextNap) {
            napControlBtn.disabled = false;
            napControlBtn.classList.remove('opacity-50', 'cursor-not-allowed');
          } else {
            napControlBtn.disabled = true;
            napControlBtn.classList.add('opacity-50', 'cursor-not-allowed');
          }
        }
      };

      const updateBedtimeUI = (active) => {
        isBedtimeActive = active;
        if (active) {
          applyBedtimeActiveUI();
        } else {
          applyBedtimeInactiveUI();
        }
      };

      bedtimeBtn.addEventListener('click', () => {
        const togglingToActive = !isBedtimeActive;
        const timestamp = nowIso();

        if (togglingToActive) {
          const previousSession = appState.sleepSession;
          setBabyStatus(true, null);
          if (nextEventLabel) nextEventLabel.textContent = 'Next wake time is';
          if (nextEventTime) nextEventTime.textContent = 'N/A';
          updateBedtimeUI(true);
          appState.sleepSession = { start_at: timestamp };
          updateSleepSummary();

          fetch('/api/day/bedtime', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'sleep', timestamp })
          })
          .then(res => res.json())
          .then(data => {
            if (data.status !== 'success') throw new Error(data.message || 'Failed to start bedtime');
            isBedtimeActive = true;
          })
          .catch(err => {
            console.error(err);
            appState.sleepSession = previousSession;
            updateSleepSummary();
            updateBedtimeUI(false);
            fetchTodaySchedule();
          });
        } else {
          const previousSession = appState.sleepSession;
          setBabyStatus(false, null);
          updateBedtimeUI(false);

          fetch('/api/day/bedtime', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'wake', timestamp })
          })
          .then(res => res.json())
          .then(data => {
            if (data.status !== 'success') throw new Error(data.message || 'Failed to end bedtime');
            isBedtimeActive = false;
            fetchTodaySchedule();
          })
          .catch(err => {
            console.error(err);
            appState.sleepSession = previousSession;
            updateBedtimeUI(true);
            updateSleepSummary();
          });
        }
      });

      setBedtimeUIState = updateBedtimeUI;
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

    // Works even if buttons aren't inside #schedule-list
    document.addEventListener('click', (event) => {
      const editBtn = event.target.closest('.edit-nap-btn');
      if (!editBtn) return;

      // accept nap index from the button or a parent
      const napIndex = Number(
        editBtn.dataset.napIndex ??
        editBtn.closest('[data-nap-index]')?.dataset.napIndex
      );

      // find the nap from appState (preferred)
      let napToEdit = appState.naps.find(n => n.nap_index === napIndex);

      // fallback: if we only have duration on the button, build a stub
      if (!napToEdit) {
        const durMin = parseInt(
          editBtn.dataset.duration ||
          editBtn.closest('[data-duration]')?.dataset.duration,
          10
        );
        napToEdit = {
          nap_index: napIndex ?? 0,
          planned_duration_sec: isNaN(durMin) ? 0 : durMin * 60,
          adjusted_duration_sec: null,
          status: 'upcoming'
        };
      }

      if (napToEdit) openEditModal(napToEdit);
    });

    // --- Core Functions ---

    function handleSaveEdit() {
        const { input: durationInput } = getModalEls(); // <-- get the live input ref
        if (!durationInput) return;

        const newDurationMin = parseInt(durationInput.value, 10);
        if (isNaN(newDurationMin) || newDurationMin <= 0) {
            alert("Please enter a valid duration in minutes.");
            return;
        }

        const editingIndexNum = Number(currentlyEditingNapIndex);
        const isEditingCurrent =
            appState.currentNap &&
            Number(appState.currentNap.nap_index) === editingIndexNum;

        fetch('/api/naps/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                index: editingIndexNum,
                duration_min: newDurationMin,
                date: appState.day?.date || undefined,
            })
        })
        .then(res => res.json())
        .then(data => {
            if (data.status !== 'success') {
            alert(`Error: ${data.message || 'Update failed'}`);
            return;
            }

            closeEditModal();

            // If we edited the live nap, retime immediately
            if (isEditingCurrent && appState.currentNap?.actual_start_at) {
            const startTs = new Date(appState.currentNap.actual_start_at).getTime();
            napEndTime = startTs + (newDurationMin * 60 * 1000);

            if (napTimerInterval) {
                clearInterval(napTimerInterval);
                napTimerInterval = null;
            }
            updateTimerDisplay();
            napTimerInterval = setInterval(updateTimerDisplay, 1000);
            setBabyStatus(true, new Date(napEndTime));
            }

            // Pull fresh schedule to sync list + summary
            fetchTodaySchedule();
        })
        .catch(console.error);
        }

    async function fetchTodaySchedule() {
        try {
            const response = await fetch('/api/day/today');
            const data = await response.json();
            appState.sleepSession = data.sleep_session || null;
            if (data.status === 'not_found') {
                console.log("No schedule found for today. Ready to start a new day.");
                appState.day = null;
                appState.naps = [];
                appState.currentNap = null;
                appState.nextNap = null;
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
        const bedtimeActive = Boolean(appState.sleepSession && !appState.sleepSession.end_at && appState.sleepSession.start_at);
        setBedtimeUIState(bedtimeActive);
        scheduleList.innerHTML = '';
        if (!appState.day) {
            if (bedtimeActive) {
                setBabyStatus(true, null);
                statusMessage.textContent = "Baby is asleep!";
                scheduleSummary.textContent = "Night sleep in progress.";
            } else {
                setBabyStatus(false, null);
                statusMessage.textContent = "Ready to start the day!";
                scheduleSummary.textContent = "Wake up time not logged yet.";
            }
            if (nextNapContainer) nextNapContainer.style.display = 'none';
            if (napTimerInterval) {
                clearInterval(napTimerInterval);
                napTimerInterval = null;
            }
            if (napTimerDisplay) napTimerDisplay.textContent = '00:00';
            napOverNotified = false;
            if (napTimerContainer) napTimerContainer.style.display = 'none';
            if (napControlBtn) {
                napControlBtn.textContent = 'Start Nap';
                napControlBtn.disabled = true;
                napControlBtn.className = 'w-full bg-green-500 text-white font-bold py-4 px-6 rounded-2xl shadow-lg hover:bg-green-600 transition-colors opacity-50 cursor-not-allowed';
            }
            updateSleepSummary();
            return;
        }
        if (nextNapContainer) nextNapContainer.style.display = 'block';
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
            napOverNotified = false; // Reset notification flag for new nap
            updateTimerDisplay();
            napTimerInterval = setInterval(updateTimerDisplay, 1000);
            if (napTimerContainer) napTimerContainer.style.display = 'block';
        } else {
            setBabyStatus(false, nextUpcomingNapTime);
            napControlBtn.textContent = appState.nextNap ? 'Start Nap' : 'All Naps Finished';
            napControlBtn.className = 'w-full bg-green-500 text-white font-bold py-4 px-6 rounded-2xl shadow-lg hover:bg-green-600 transition-colors';
            if (napTimerContainer) napTimerContainer.style.display = 'none';
            if (!appState.nextNap) {
                napControlBtn.disabled = true;
                napControlBtn.classList.add('opacity-50', 'cursor-not-allowed');
            } else {
                napControlBtn.disabled = false;
                napControlBtn.classList.remove('opacity-50', 'cursor-not-allowed');
            }
        }

        updateSleepSummary();
    }

    function setBabyStatus(isAsleep, eventTime) {
        if (!statusMessage || !statusCard || !statusIconContainer || !nextEventLabel || !nextEventTime || !awakeIcon || !asleepIcon) return;

        if (isAsleep) {
            // Asleep — indigo theme
            statusMessage.textContent = 'Baby is asleep!';
            statusCard.className = 'bg-indigo-50 rounded-3xl p-8 text-center shadow-lg';
            statusIconContainer.className = 'w-12 h-12 mx-auto text-indigo-500';
            statusMessage.className = 'text-xl font-bold mt-4 text-indigo-800';
            nextEventLabel.textContent = 'Next wake time is';
            nextEventTime.textContent = formatTime(eventTime);
            nextEventLabel.className = 'text-sm text-indigo-700 mt-1';
            nextEventTime.className = 'text-5xl font-extrabold text-indigo-800';
            awakeIcon.classList.add('hidden');
            asleepIcon.classList.remove('hidden');
        } else {
            // Awake — amber theme (matches the “nice” screenshot)
            statusMessage.textContent = 'Baby is awake!';
            statusCard.className = 'bg-amber-50 rounded-3xl p-8 text-center shadow-lg';
            statusIconContainer.className = 'w-12 h-12 mx-auto text-amber-500';
            statusMessage.className = 'text-xl font-bold mt-4 text-amber-800';
            nextEventLabel.textContent = 'Next nap at';
            nextEventTime.textContent = formatTime(eventTime);
            nextEventLabel.className = 'text-sm text-amber-700 mt-1';
            nextEventTime.className = 'text-5xl font-extrabold text-amber-800';
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
            body: JSON.stringify({ index: napIndex, timestamp: nowIso() }),
        })
        .then(res => res.json())
        .then(data => {
            console.log('API /api/naps/start response:', data);
            if (data.status === 'success') {
                napOverNotified = false;
                fetchTodaySchedule();
            }
        })
        .catch(console.error);
    }

    function stopNap() {
        if (!appState.currentNap) return fetchTodaySchedule();
        const napIndex = appState.currentNap.nap_index;
        fetch('/api/naps/stop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ index: napIndex, timestamp: nowIso() }),
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

    const timeLeft = napEndTime - nowMs();

    if (timeLeft <= 0) {
        napTimerDisplay.textContent = '00:00';

        if (napTimerInterval) {
        clearInterval(napTimerInterval);
        napTimerInterval = null;
        }

        if (!napOverNotified) {
        napOverNotified = true;
        if (appState.currentNap) {
            stopNap();   // this will refresh schedule
        } else {
            fetchTodaySchedule();
        }
        alert("Nap time is over!");
        }
        return;
    }

    // ✅ total minutes remaining (not modulo 60)
    const totalMinutes = Math.floor(timeLeft / 60000);
    const seconds = Math.floor((timeLeft % 60000) / 1000);

    napTimerDisplay.textContent =
        `${String(totalMinutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    
    /**
     * Opens the edit modal and populates it with data from the selected nap.
     * @param {object} nap - The nap object from appState to be edited.
     */
    function openEditModal(nap) {
        const { modal, title, input, save, cancel } = getModalEls();
        if (!modal || !title || !input) {
            console.error("Modal elements missing.");
            return;
        }

        // Store the index of the nap being edited
        currentlyEditingNapIndex = nap.nap_index;

        // Populate the modal with the nap's data
        title.textContent = `Edit Nap ${nap.nap_index} Duration`;
        const currentDuration = nap.adjusted_duration_sec || nap.planned_duration_sec;
        input.value = Math.round(currentDuration / 60);

        // (Re)bind save/cancel safely
        if (save) save.onclick = handleSaveEdit;
        if (cancel) cancel.onclick = closeEditModal;

        // Show the modal
        modal.classList.remove('hidden');
    }

    /**
     * Closes the edit modal and resets the editing state.
     */
    function closeEditModal() {
        const modal = document.getElementById('edit-nap-modal');
        if (!modal) return;
        currentlyEditingNapIndex = null;
        modal.classList.add('hidden');
    }

    function formatTime(date) {
        if (!date || isNaN(new Date(date))) return 'N/A';
        return new Date(date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    }

    function formatDuration(totalSeconds) {
        if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return 'N/A';
        const totalMinutes = Math.round(totalSeconds / 60);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        const parts = [];
        if (hours > 0) parts.push(`${hours} hr${hours !== 1 ? 's' : ''}`);
        parts.push(`${minutes} min`);
        return parts.join(' ');
    }

    function secondsSince(startIso) {
        const startMs = new Date(startIso).getTime();
        if (Number.isNaN(startMs)) return null;
        return Math.max(0, Math.floor((nowMs() - startMs) / 1000));
    }

    function stopSleepInfoTicker() {
        if (sleepInfoInterval) {
            clearInterval(sleepInfoInterval);
            sleepInfoInterval = null;
        }
    }

    function updateActiveSleepDuration(startIso) {
        if (!wakeTimeText) return;
        const elapsedSec = secondsSince(startIso);
        if (elapsedSec === null) return;
        wakeTimeText.textContent = `Asleep for ${formatDuration(elapsedSec)}`;
    }

    function updateSleepSummary() {
        if (!sleepInfoContainer) return;

        const activeSession = appState.sleepSession && !appState.sleepSession.end_at && appState.sleepSession.start_at;
        const totalSleepSeconds = Number(appState.day?.total_night_sleep_sec);
        const dayMetrics = Boolean(
            appState.day &&
            appState.day.bedtime_start_at &&
            appState.day.first_wake_at &&
            Number.isFinite(totalSleepSeconds)
        );

        if (activeSession) {
            sleepInfoContainer.classList.remove('hidden');
            if (sleepDurationText) sleepDurationText.textContent = `Went to bed at ${formatTime(appState.sleepSession.start_at)}`;
            updateActiveSleepDuration(appState.sleepSession.start_at);

            if (!sleepInfoInterval) {
                sleepInfoInterval = setInterval(() => {
                    if (!(appState.sleepSession && !appState.sleepSession.end_at && appState.sleepSession.start_at)) {
                        stopSleepInfoTicker();
                        return;
                    }
                    updateActiveSleepDuration(appState.sleepSession.start_at);
                }, 60000);
            }
            return;
        }

        stopSleepInfoTicker();

        if (dayMetrics) {
            sleepInfoContainer.classList.remove('hidden');
            if (sleepDurationText) {
                sleepDurationText.textContent = `Night sleep: ${formatDuration(totalSleepSeconds)}`;
            }
            if (wakeTimeText) {
                wakeTimeText.textContent = `Down at ${formatTime(appState.day.bedtime_start_at)} • Woke at ${formatTime(appState.day.first_wake_at)}`;
            }
        } else {
            sleepInfoContainer.classList.add('hidden');
        }
    }

    // --- Initial Load ---
    fetchTodaySchedule();

    // --- Keyboard Shortcuts ---
    document.addEventListener('keydown', (e) => {
        // Escape-to-close modal
        const modal = document.getElementById('edit-nap-modal');
        if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
            closeEditModal();
            return; // Exclusive action
        }

        // dev: press ] to +5min, [ to -5min, \ to reset
        if (['[', ']', '\\'].includes(e.key)) {
            if (e.key === ']') clockOffsetMs += 5 * 60 * 1000;
            if (e.key === '[') clockOffsetMs -= 5 * 60 * 1000;
            if (e.key === '\\') clockOffsetMs = 0;
            console.log(`DEV: Clock offset is now ${clockOffsetMs / 60000} minutes.`);
            // Repaint anything time-based
            if (appState.currentNap) updateTimerDisplay();
            updateSleepSummary();
        }
    });
});
