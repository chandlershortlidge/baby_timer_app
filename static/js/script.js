document.addEventListener('DOMContentLoaded', function() {
    console.log("DOM fully loaded and parsed. Attaching event listeners.");

    // --- State Management ---
    const DEFAULT_ALARM_LEAD_SEC = 20 * 60;
    const DEFAULT_END_REMINDER_LEAD_SEC = 20 * 60;
    const END_REMINDER_OPTIONS = [
        { label: 'Off', value: 0 },
        { label: '30 seconds', value: 30 },
        { label: '1 minute', value: 60 },
        { label: '5 minutes', value: 5 * 60 },
        { label: '10 minutes', value: 10 * 60 },
        { label: '20 minutes', value: 20 * 60 },
        { label: '30 minutes', value: 30 * 60 },
    ];

    let appState = {
        day: null,
        naps: [],
        currentNap: null,
        nextNap: null,
        sleepSession: null,
        nextNapPlannedStart: null,
        currentNapProjectedEnd: null,
        alarmLeadTimeSec: DEFAULT_ALARM_LEAD_SEC,
        scheduleSignature: '',
        scheduleError: false,
        globalEndReminderSec: DEFAULT_END_REMINDER_LEAD_SEC,
        endReminderSecOverride: null,
        endReminderOverrideNapIndex: null,
        endReminderScheduledAt: null,
        endReminderAutoAdjusted: false,
        upcomingAlarmScheduledAt: null,
        upcomingAlarmOverrideMs: null,
        upcomingAlarmOverrideNapIndex: null,
        upcomingAlarmDismissedNapIndex: null,
        soundEnabled: true,
    };
    let currentlyEditingNapIndex = null;
    let napTimerInterval = null;
    let napEndTime = 0;
    let isBedtimeActive = false;
    let setBedtimeUIState = () => {};
    let summaryTicker = null;
    let upcomingNapAlarmTimeout = null;
    let endReminderTimeout = null;
    let endReminderModalOpen = false;
    let endReminderPickerSelectionSec = null;
    let endReminderPickerOneOff = true;
    let endReminderPreviouslyFocused = null;
    let endReminderModalContextNapIndex = null;
    let bedtimeRequestInFlight = false;
    let alarmToastNode = null;
    let alarmToastTimer = null;
    let alarmToastRestoreFocus = null;
    let alarmToastKeyHandler = null;
    let alarmToastPulseManaged = false;
    let alarmToastContext = null;
    let alarmAudioUnlocked = false;
    let alarmAudioUnlockPromise = null;
    let alarmAudioUnlockFailed = false;
    let alarmSoundStopTimer = null;
    let lastNapActive = false;
    let fallbackAudioCtx = null;
    let fallbackGainNode = null;
    let fallbackOscillator = null;


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

    const sleepSummaryCard = document.getElementById('sleep-summary');
    const sleepStateIcon = document.getElementById('sleep-state-icon');
    const awakeIcon = document.getElementById('awake-icon');
    const asleepIcon = document.getElementById('asleep-icon');
    const sleepStateText = document.getElementById('sleep-state-text');
    const sleepStateSubtext = document.getElementById('sleep-state-subtext');
    const sleepStateTime = document.getElementById('sleep-state-time');
    const sleepMeta = document.getElementById('sleep-meta');
    const awakeTodayText = document.getElementById('awake-today');
    const napTodayText = document.getElementById('total-nap-today');
    const awakeBudgetLabel = document.getElementById('awake-budget-label');
    const awakeBudgetBar = document.getElementById('awake-budget-bar');
    const napControlBtn = document.getElementById('nap-control-btn');
    const napHelperText = document.getElementById('nap-helper-text');
    const napTimerContainer = document.getElementById('nap-timer-container');
    const napTimerDisplay = document.getElementById('nap-timer-display');
    const scheduleHeader = document.getElementById('schedule-header');
    const scheduleList = document.getElementById('schedule-list');
    const scheduleSummary = document.getElementById('schedule-summary');
    const scheduleToggleIcon = document.getElementById('schedule-toggle-icon');
    const napReminderRow = document.getElementById('nap-reminder-row');
    const napReminderBtn = document.getElementById('nap-reminder-btn');
    const napReminderText = document.getElementById('nap-reminder-text');
    const napReminderHelper = document.getElementById('nap-reminder-helper');
    const endReminderActions = document.getElementById('end-reminder-actions');
    const endReminderSnoozeBtn = document.getElementById('end-reminder-snooze');
    const endReminderDismissBtn = document.getElementById('end-reminder-dismiss');
    const toastContainer = document.getElementById('toast-container');
    const toastRoot = document.getElementById('toast-root');
    const alarmAudio = document.getElementById('alarm-audio');
    const napReminderSoundToggle = document.getElementById('nap-reminder-sound-toggle');
    const napAudioHint = document.getElementById('nap-audio-hint');
    const ariaLiveRegion = document.getElementById('aria-live-region');
    const endReminderModal = document.getElementById('end-reminder-modal');
    const endReminderModalOptions = document.getElementById('end-reminder-options');
    const endReminderModalOverlay = endReminderModal ? endReminderModal.querySelector('[data-end-reminder-overlay]') : null;
    const endReminderModalCheckbox = document.getElementById('end-reminder-oneoff');
    const endReminderModalHelper = document.getElementById('end-reminder-modal-helper');
    const endReminderModalCancel = document.getElementById('end-reminder-cancel');
    const endReminderModalSave = document.getElementById('end-reminder-save');
    const bedtimeBtn = document.getElementById('bedtime-btn');
    const bedtimeHelper = document.getElementById('bedtime-helper');
    const bedtimeBtnLabel = document.getElementById('bedtime-btn-label');
    const bedtimePressIndicator = document.getElementById('bedtime-press-indicator');

    try {
        const storedSoundEnabled = localStorage.getItem('napAlarmSoundEnabled');
        if (storedSoundEnabled === 'false') {
            appState.soundEnabled = false;
        } else if (storedSoundEnabled === 'true') {
            appState.soundEnabled = true;
        } else if (storedSoundEnabled == null) {
            localStorage.setItem('napAlarmSoundEnabled', appState.soundEnabled ? 'true' : 'false');
        }
    } catch (error) {
        console.warn('Unable to read sound preference', error);
    }
    updateSoundToggleControl();

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


    if (endReminderModalCheckbox) {
        endReminderModalCheckbox.addEventListener('change', () => {
            endReminderPickerOneOff = !endReminderModalCheckbox.disabled && Boolean(endReminderModalCheckbox.checked);
        });
    }

    function openEndReminderModal() {
        if (!endReminderModal || !endReminderModalOptions) return;

        endReminderPreviouslyFocused = document.activeElement;
        endReminderModalOpen = true;
        endReminderModalContextNapIndex = appState.currentNap?.nap_index ?? null;

        const activeNapIndex = appState.currentNap?.nap_index ?? appState.endReminderOverrideNapIndex;
        const napActive = Number.isInteger(activeNapIndex);
        const hasOverrideForActiveNap = napActive && appState.endReminderOverrideNapIndex === activeNapIndex && Number.isFinite(appState.endReminderSecOverride);

        const baseLead = hasOverrideForActiveNap
            ? appState.endReminderSecOverride
            : Number.isFinite(appState.globalEndReminderSec)
                ? appState.globalEndReminderSec
                : DEFAULT_END_REMINDER_LEAD_SEC;

        endReminderPickerSelectionSec = Number.isFinite(baseLead) ? baseLead : DEFAULT_END_REMINDER_LEAD_SEC;
        endReminderPickerOneOff = hasOverrideForActiveNap;

        if (endReminderModalCheckbox) {
            endReminderModalCheckbox.checked = endReminderPickerOneOff;
            endReminderModalCheckbox.disabled = !napActive;
        }

        if (endReminderModalHelper) {
            endReminderModalHelper.textContent = napActive
                ? 'Changes apply to this nap unless you turn off the toggle.'
                : 'Changes update the default for upcoming naps.';
        }

        populateEndReminderOptions(endReminderPickerSelectionSec);

        endReminderModal.classList.remove('hidden');
        document.body.dataset.scrollLock = 'true';
        document.body.style.overflow = 'hidden';

        const selectedBtn = endReminderModalOptions.querySelector('button[aria-checked="true"]');
        window.setTimeout(() => {
            (selectedBtn || endReminderModalSave || endReminderModal).focus();
        }, 0);
    }

    function closeEndReminderModal({ restoreFocus = true, dueToScheduleChange = false } = {}) {
        if (!endReminderModal) return;

        endReminderModal.classList.add('hidden');
        document.body.style.overflow = '';
        delete document.body.dataset.scrollLock;

        endReminderModalOpen = false;
        endReminderPickerSelectionSec = null;
        endReminderModalContextNapIndex = null;

        if (restoreFocus && endReminderPreviouslyFocused && typeof endReminderPreviouslyFocused.focus === 'function') {
            const previouslyFocused = endReminderPreviouslyFocused;
            window.setTimeout(() => {
                if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
                    previouslyFocused.focus();
                }
            }, 0);
        }
        endReminderPreviouslyFocused = null;

        if (dueToScheduleChange) {
            showToast('Schedule changed; try again.', 'info');
            announce('Schedule changed; try again.');
        }
    }

    function populateEndReminderOptions(selectedValue) {
        if (!endReminderModalOptions) return;
        endReminderModalOptions.innerHTML = '';

        END_REMINDER_OPTIONS.forEach((option) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.dataset.value = String(option.value);
            btn.setAttribute('role', 'radio');
            btn.className = 'flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm';
            btn.innerHTML = `
                <span>${option.label}</span>
                <span class="text-indigo-600" aria-hidden="true">✓</span>
            `;

            btn.addEventListener('click', () => setEndReminderOptionSelection(option.value));
            btn.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setEndReminderOptionSelection(option.value);
                }
            });

            endReminderModalOptions.appendChild(btn);
        });

        setEndReminderOptionSelection(selectedValue, { announceChange: false });
    }

    function setEndReminderOptionSelection(value, { announceChange = true } = {}) {
        const selected = Number.isFinite(value) ? value : DEFAULT_END_REMINDER_LEAD_SEC;
        endReminderPickerSelectionSec = selected;

        if (!endReminderModalOptions) return;

        endReminderModalOptions.querySelectorAll('button[role="radio"]').forEach((btn) => {
            const btnValue = Number(btn.dataset.value);
            const isSelected = btnValue === selected;
            btn.setAttribute('aria-checked', String(isSelected));
            btn.classList.toggle('border-indigo-500', isSelected);
            btn.classList.toggle('bg-indigo-50', isSelected);
            btn.classList.toggle('text-indigo-700', isSelected);
            btn.classList.toggle('border-gray-200', !isSelected);
            btn.classList.toggle('bg-white', !isSelected);
            btn.classList.toggle('text-gray-700', !isSelected);
        });

        if (announceChange) {
            if (!Number.isFinite(selected) || selected <= 0) {
                announce('Nap reminder turned off.');
            } else {
                const napActive = Boolean(appState.currentNap);
                const context = napActive ? 'before the nap ends' : 'before the next nap';
                announce(`Nap reminder set to ${formatLeadPlain(selected)} ${context}.`);
            }
        }
    }

    function trapEndReminderFocus(event) {
        if (!endReminderModalOpen || event.key !== 'Tab') {
            if (endReminderModalOpen && event.key === 'Escape') {
                event.preventDefault();
                closeEndReminderModal();
            }
            return;
        }

        const focusable = Array.from(
            endReminderModal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
        ).filter((el) => !el.hasAttribute('disabled'));

        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;

        if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
        } else if (event.shiftKey && active === first) {
            event.preventDefault();
            last.focus();
        }
    }

    function saveEndReminderSelection() {
        const selectedSec = Number.isFinite(endReminderPickerSelectionSec)
            ? endReminderPickerSelectionSec
            : DEFAULT_END_REMINDER_LEAD_SEC;
        const napActive = Boolean(appState.currentNap);
        const useOverride = napActive && Boolean(endReminderPickerOneOff);

        unlockAlarmAudioOnce();

        if (!napActive) {
            const previousGlobal = appState.globalEndReminderSec;
            const finalize = () => {
                closeEndReminderModal();
                scheduleNapReminder();
                renderReminderRow();
            };

            if (selectedSec === previousGlobal) {
                finalize();
                return;
            }

            if (endReminderModalSave) endReminderModalSave.disabled = true;

            updateGlobalEndReminder(selectedSec)
                .then((lead) => {
                    appState.globalEndReminderSec = lead;
                    if (lead !== previousGlobal) {
                        logEvent('nap_alarm_changed', {
                            scope: 'global',
                            old: Number.isFinite(previousGlobal) ? previousGlobal : null,
                            new: Number.isFinite(lead) ? lead : null,
                        });
                    }
                    if (!Number.isFinite(lead) || lead <= 0) {
                        showToast('Reminder turned off for upcoming naps.', 'info');
                        announce('Reminder turned off for upcoming naps.');
                    } else {
                        showToast(`Reminder set to ${formatLeadPlain(lead)} before the next nap.`, 'success');
                        announce('Reminder updated for upcoming naps.');
                    }
                })
                .catch((error) => {
                    console.error('Failed to update reminder', error);
                    showToast("Couldn't save reminder. Try again.", 'error');
                    announce("Couldn't save reminder. Try again.");
                    appState.globalEndReminderSec = previousGlobal;
                })
                .finally(() => {
                    if (endReminderModalSave) endReminderModalSave.disabled = false;
                    finalize();
                });
            return;
        }

        if (useOverride) {
            const previousOverride = appState.endReminderSecOverride;
            appState.endReminderSecOverride = selectedSec;
            appState.endReminderOverrideNapIndex = appState.currentNap?.nap_index ?? null;
            if (previousOverride !== selectedSec) {
                logEvent('nap_alarm_changed', {
                    scope: 'this_nap',
                    old: Number.isFinite(previousOverride) ? previousOverride : null,
                    new: Number.isFinite(selectedSec) ? selectedSec : null,
                });
            }
            closeEndReminderModal();
            scheduleNapReminder();
            renderReminderRow();
            if (!Number.isFinite(selectedSec) || selectedSec <= 0) {
                showToast('Reminder turned off for this nap.', 'info');
                announce('Reminder turned off for this nap.');
            } else {
                showToast(`Reminder set to ${formatLeadPlain(selectedSec)} before this nap ends.`, 'success');
                announce('Reminder set for this nap.');
            }
            return;
        }

        const needsUpdate = appState.globalEndReminderSec !== selectedSec;
        const previousGlobal = appState.globalEndReminderSec;
        const previousOverride = appState.endReminderSecOverride;
        appState.endReminderSecOverride = null;
        appState.endReminderOverrideNapIndex = null;

        if (previousOverride != null) {
            logEvent('nap_alarm_changed', {
                scope: 'this_nap',
                old: Number.isFinite(previousOverride) ? previousOverride : null,
                new: null,
            });
        }

        const finalize = () => {
            closeEndReminderModal();
            scheduleNapReminder();
            renderReminderRow();
        };

        if (!needsUpdate) {
            finalize();
            return;
        }

        if (endReminderModalSave) endReminderModalSave.disabled = true;

        updateGlobalEndReminder(selectedSec)
            .then((lead) => {
                appState.globalEndReminderSec = lead;
                appState.alarmLeadTimeSec = lead;
                if (lead !== previousGlobal) {
                    logEvent('nap_alarm_changed', {
                        scope: 'global',
                        old: Number.isFinite(previousGlobal) ? previousGlobal : null,
                        new: Number.isFinite(lead) ? lead : null,
                    });
                }
                if (!Number.isFinite(lead) || lead <= 0) {
                    showToast('Reminder default turned off for naps.', 'info');
                    announce('Reminder default turned off.');
                } else {
                    showToast(`Reminder default set to ${formatLeadPlain(lead)} before naps.`, 'success');
                    announce(`Reminder default updated.`);
                }
            })
            .catch((error) => {
                console.error('Failed to update reminder', error);
                showToast("Couldn't save reminder. Try again.", 'error');
                announce("Couldn't save reminder. Try again.");
                appState.globalEndReminderSec = previousGlobal;
            })
            .finally(() => {
                if (endReminderModalSave) endReminderModalSave.disabled = false;
                finalize();
            });
    }

    // --- Centralized Event Listeners ---
    if (bedtimeBtn) {
        attachBedtimeLongPress();
    }

    if (napControlBtn) {
        napControlBtn.addEventListener('click', () => {
            if (napControlBtn.disabled) return;
            appState.currentNap ? stopNap() : startNap();
        });
    }

    if (scheduleHeader) {
        scheduleHeader.addEventListener('click', () => {
            scheduleList.classList.toggle('hidden');
            if (scheduleToggleIcon) scheduleToggleIcon.classList.toggle('rotate-180');
        });
    }

    if (napReminderBtn) {
        const handleOpen = (event) => {
            if (napReminderBtn.disabled) return;
            event.preventDefault();
            unlockAlarmAudioOnce();
            openEndReminderModal();
        };
        napReminderBtn.addEventListener('click', handleOpen);
        napReminderBtn.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                handleOpen(event);
            }
        });
    }

    if (napReminderSoundToggle) {
        napReminderSoundToggle.addEventListener('click', () => {
            appState.soundEnabled = !appState.soundEnabled;
            try {
                localStorage.setItem('napAlarmSoundEnabled', appState.soundEnabled ? 'true' : 'false');
            } catch (error) {
                console.warn('Unable to persist sound toggle', error);
            }
            if (!appState.soundEnabled) {
                stopAlarmSound();
            } else {
                unlockAlarmAudioOnce();
            }
            updateSoundToggleControl();
        });
    }

    if (napAudioHint) {
        napAudioHint.addEventListener('click', () => {
            unlockAlarmAudioOnce();
        });
    }

    if (endReminderSnoozeBtn) {
        endReminderSnoozeBtn.addEventListener('click', () => {
            snoozeEndReminder();
        });
    }

    if (endReminderDismissBtn) {
        endReminderDismissBtn.addEventListener('click', () => {
            dismissEndReminder();
        });
    }

    if (endReminderModalOverlay) {
        endReminderModalOverlay.addEventListener('click', () => closeEndReminderModal());
    }
    if (endReminderModalCancel) {
        endReminderModalCancel.addEventListener('click', () => closeEndReminderModal());
    }
    if (endReminderModalSave) {
        endReminderModalSave.addEventListener('click', () => saveEndReminderSelection());
    }
    if (endReminderModal) {
        endReminderModal.addEventListener('keydown', trapEndReminderFocus);
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
            renderSleepSummary();
            }

            // Pull fresh schedule to sync list + summary
            fetchTodaySchedule();
        })
        .catch(console.error);
        }

    async function fetchTodaySchedule() {
        try {
            const response = await fetch('/api/day/today');
            if (!response.ok) throw new Error(`Request failed with status ${response.status}`);

            const data = await response.json();
            appState.sleepSession = data.sleep_session || null;
            appState.scheduleError = false;

            if (data.status === 'not_found') {
                console.log("No schedule found for today. Ready to start a new day.");
                appState.day = null;
                appState.naps = [];
                appState.currentNap = null;
                appState.nextNap = null;
                appState.alarmLeadTimeSec = Number.isFinite(Number(data.alarm_lead_time_sec))
                    ? Number(data.alarm_lead_time_sec)
                    : DEFAULT_ALARM_LEAD_SEC;
                appState.scheduleSignature = 'not-found';
                renderSchedule();
                cancelAlarms();
                cancelEndReminder({ skipRender: true });
                if (endReminderModalOpen) {
                    closeEndReminderModal({ dueToScheduleChange: true });
                }
                return;
            }

            console.log("Received schedule data:", data);
            appState.day = data.day;
            const leadValue = Number(data.day?.nap_alarm_lead_sec);
            appState.alarmLeadTimeSec = Number.isFinite(leadValue) ? leadValue : DEFAULT_ALARM_LEAD_SEC;
            appState.naps = data.naps;
        appState.currentNap = appState.naps.find(nap => nap.status === 'in_progress');
        appState.nextNap = appState.naps.find(nap => nap.status === 'upcoming');
        appState.scheduleSignature = computeScheduleSignature(appState.naps);

        const napActiveNow = Boolean(appState.currentNap);
        if (!napActiveNow && lastNapActive) {
            stopAlarmSound();
        }
        lastNapActive = napActiveNow;

            renderSchedule();

            if (endReminderModalOpen) {
                const activeNapIndex = appState.currentNap?.nap_index ?? null;
                if (endReminderModalContextNapIndex !== activeNapIndex) {
                    closeEndReminderModal({ dueToScheduleChange: true });
                }
            }

            scheduleNapReminder();
        } catch (error) {
            console.error("Failed to fetch schedule:", error);
            appState.scheduleError = true;
            cancelAlarms();
            cancelEndReminder({ skipRender: true });
            renderSleepSummary();
            renderReminderRow();
        }
    }

    async function fetchEndReminderSetting() {
        try {
            const response = await fetch('/api/settings/reminder');
            if (!response.ok) throw new Error(`Status ${response.status}`);
            const data = await response.json();
            if (data && Number.isFinite(Number(data.lead_time_sec))) {
                appState.globalEndReminderSec = Number(data.lead_time_sec);
            }
        } catch (error) {
            console.error('Failed to fetch end reminder setting:', error);
            appState.globalEndReminderSec = DEFAULT_END_REMINDER_LEAD_SEC;
        } finally {
            appState.alarmLeadTimeSec = appState.globalEndReminderSec;
            scheduleNapReminder();
        }
    }

    function renderSchedule() {
        if (!scheduleList || !scheduleSummary) return;

        const bedtimeActive = Boolean(appState.sleepSession && !appState.sleepSession.end_at && appState.sleepSession.start_at);

        scheduleList.innerHTML = '';

        if (!appState.day) {
            appState.nextNapPlannedStart = null;
            appState.currentNapProjectedEnd = null;
            appState.endReminderSecOverride = null;
            appState.endReminderOverrideNapIndex = null;
            cancelEndReminder({ skipRender: true });
            cancelAlarms();
            stopAlarmSound();

            if (napTimerInterval) {
                clearInterval(napTimerInterval);
                napTimerInterval = null;
            }
            if (napTimerDisplay) napTimerDisplay.textContent = '00:00';
            napOverNotified = false;
            if (napTimerContainer) napTimerContainer.classList.add('hidden');

            scheduleSummary.textContent = bedtimeActive ? 'Night sleep in progress.' : 'Wake up time not logged yet.';
            renderSleepSummary();
            lastNapActive = false;
            return;
        }

        if (appState.endReminderOverrideNapIndex != null && (!appState.currentNap || appState.currentNap.nap_index !== appState.endReminderOverrideNapIndex)) {
            appState.endReminderSecOverride = null;
            appState.endReminderOverrideNapIndex = null;
        }

        let lastEventEndTime = appState.day.first_wake_at ? new Date(appState.day.first_wake_at) : new Date(nowMs());
        if (Number.isNaN(lastEventEndTime.getTime())) {
            lastEventEndTime = new Date(nowMs());
        }

        const firstUpcomingNap = appState.naps.find((nap) => nap.status === 'upcoming') || null;
        appState.nextNap = firstUpcomingNap;

        if (!firstUpcomingNap) {
            appState.upcomingAlarmDismissedNapIndex = null;
            appState.upcomingAlarmOverrideMs = null;
            appState.upcomingAlarmOverrideNapIndex = null;
        } else {
            if (appState.upcomingAlarmDismissedNapIndex != null && firstUpcomingNap.nap_index !== appState.upcomingAlarmDismissedNapIndex) {
                appState.upcomingAlarmDismissedNapIndex = null;
            }
            if (appState.upcomingAlarmOverrideNapIndex != null && firstUpcomingNap.nap_index !== appState.upcomingAlarmOverrideNapIndex) {
                appState.upcomingAlarmOverrideMs = null;
                appState.upcomingAlarmOverrideNapIndex = null;
            }
        }

        let nextUpcomingNapTime = null;
        const WAKE_WINDOWS_MIN = [120, 150, 150, 180];

        appState.naps.forEach((nap, index) => {
            const li = document.createElement('li');
            li.className = 'flex items-center justify-between rounded-xl bg-gray-50 p-4';
            li.setAttribute('data-nap-index', String(nap.nap_index));
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
                <div class="flex items-center gap-2">
                    <span class="container nap-chip hidden inline-flex w-auto flex-none items-center gap-1 rounded-full border border-gray-200 bg-white/70 px-2 py-0.5 text-xs font-medium leading-tight text-gray-600">⏰</span>
                    <button data-nap-index="${nap.nap_index}" class="edit-nap-btn text-sm font-semibold text-blue-600 hover:text-blue-800">Edit</button>
                </div>
            `;

            scheduleList.appendChild(li);

            const napEndAt = nap.actual_end_at ? new Date(nap.actual_end_at) : new Date(displayTime.getTime() + durationSec * 1000);
            lastEventEndTime = napEndAt;
        });

        appState.nextNapPlannedStart = nextUpcomingNapTime;
        appState.currentNapProjectedEnd = appState.currentNap
            ? new Date(new Date(appState.currentNap.actual_start_at).getTime() + (appState.currentNap.adjusted_duration_sec || appState.currentNap.planned_duration_sec) * 1000)
            : null;

        const remainingNaps = appState.naps.filter((nap) => nap.status === 'upcoming').length;
        scheduleSummary.textContent = `${remainingNaps} naps remaining • Next: ${formatTime(nextUpcomingNapTime)}`;

        if (napTimerInterval) {
            clearInterval(napTimerInterval);
            napTimerInterval = null;
        }

        if (appState.currentNap) {
            const currentNapEnd = appState.currentNapProjectedEnd;
            const napDurationSec = appState.currentNap.adjusted_duration_sec || appState.currentNap.planned_duration_sec;
            const startTime = new Date(appState.currentNap.actual_start_at).getTime();
            napEndTime = currentNapEnd ? currentNapEnd.getTime() : startTime + napDurationSec * 1000;
            napOverNotified = false;
            updateTimerDisplay();
            napTimerInterval = setInterval(updateTimerDisplay, 1000);
            if (napTimerContainer) napTimerContainer.classList.remove('hidden');
        } else if (napTimerContainer) {
            napTimerContainer.classList.add('hidden');
        }

        renderSleepSummary();
        renderNapAlarmChip();
        updateSoundToggleControl();
    }

    function renderNapAlarmChip() {
        if (!scheduleList) return;

        const chips = scheduleList.querySelectorAll('.nap-chip');
        chips.forEach((chip) => {
            chip.textContent = '⏰';
            chip.classList.add('hidden');
        });

        const upcomingNap = appState.naps.find((nap) => nap.status === 'upcoming');
        if (!upcomingNap) return;

        if (appState.upcomingAlarmDismissedNapIndex != null && upcomingNap.nap_index === appState.upcomingAlarmDismissedNapIndex) {
            return;
        }

        let effectiveLead = null;

        if (
            appState.upcomingAlarmOverrideNapIndex === upcomingNap.nap_index &&
            Number.isFinite(appState.upcomingAlarmOverrideMs) &&
            appState.nextNapPlannedStart instanceof Date &&
            !Number.isNaN(appState.nextNapPlannedStart?.getTime())
        ) {
            effectiveLead = Math.max(0, Math.round((appState.nextNapPlannedStart.getTime() - appState.upcomingAlarmOverrideMs) / 1000));
        }

        if (!Number.isFinite(effectiveLead) || effectiveLead <= 0) {
            if (appState.endReminderOverrideNapIndex != null && upcomingNap.nap_index === appState.endReminderOverrideNapIndex) {
                const overrideLead = Number(appState.endReminderSecOverride);
                if (Number.isFinite(overrideLead)) {
                    effectiveLead = overrideLead;
                }
            }
        }

        if (!Number.isFinite(effectiveLead) || effectiveLead <= 0) {
            const globalLead = Number(appState.globalEndReminderSec);
            if (Number.isFinite(globalLead)) {
                effectiveLead = globalLead;
            }
        }

        if (!Number.isFinite(effectiveLead) || effectiveLead <= 0) return;

        const targetItem = scheduleList.querySelector(`[data-nap-index="${upcomingNap.nap_index}"] .nap-chip`);
        if (!targetItem) return;

        const label = formatLeadChip(effectiveLead);
        if (!label) return;

        targetItem.textContent = `⏰ ${label}`;
        targetItem.classList.remove('hidden');
    }

    function renderSleepSummary() {
        if (!sleepSummaryCard || !sleepStateText || !sleepStateSubtext || !sleepStateTime) return;

        const dayStarted = Boolean(appState.day && appState.day.first_wake_at);
        const bedtimeActive = Boolean(appState.sleepSession && !appState.sleepSession.end_at && appState.sleepSession.start_at);
        const napActive = Boolean(appState.currentNap);
        const babyAsleep = napActive || bedtimeActive;

        setBedtimeUIState(bedtimeActive);

        const nextEventDate = babyAsleep
            ? (appState.currentNapProjectedEnd instanceof Date ? appState.currentNapProjectedEnd : null)
            : (appState.nextNapPlannedStart instanceof Date ? appState.nextNapPlannedStart : null);

        sleepStateText.textContent = babyAsleep ? 'Baby is asleep' : 'Baby is awake';
        sleepStateText.classList.toggle('text-amber-700', !babyAsleep);
        sleepStateText.classList.toggle('text-indigo-700', babyAsleep);

        sleepStateSubtext.textContent = babyAsleep ? 'Next wake at' : 'Next nap at';
        sleepStateSubtext.classList.toggle('text-amber-600', !babyAsleep);
        sleepStateSubtext.classList.toggle('text-indigo-600', babyAsleep);

        sleepStateTime.textContent = formatTimeOrDash(nextEventDate);
        sleepStateTime.classList.toggle('text-amber-700', !babyAsleep);
        sleepStateTime.classList.toggle('text-indigo-700', babyAsleep);

        sleepStateIcon.classList.toggle('bg-amber-100', !babyAsleep);
        sleepStateIcon.classList.toggle('text-amber-500', !babyAsleep);
        sleepStateIcon.classList.toggle('bg-indigo-100', babyAsleep);
        sleepStateIcon.classList.toggle('text-indigo-500', babyAsleep);
        if (awakeIcon) awakeIcon.classList.toggle('hidden', babyAsleep);
        if (asleepIcon) asleepIcon.classList.toggle('hidden', !babyAsleep);

        const downAtIso = appState.day?.bedtime_start_at || appState.sleepSession?.start_at || null;
        const wokeAtIso = appState.day?.first_wake_at || (appState.sleepSession && appState.sleepSession.end_at ? appState.sleepSession.end_at : null);
        sleepMeta.textContent = `Down at ${formatTimeOrDash(downAtIso)} • Woke at ${formatTimeOrDash(wokeAtIso)}`;

        const awakeSeconds = calculateAwakeSeconds();
        const napSeconds = calculateNapSeconds();
        if (awakeTodayText) awakeTodayText.textContent = formatDuration(Number.isFinite(awakeSeconds) ? awakeSeconds : 0);
        if (napTodayText) napTodayText.textContent = formatDuration(Number.isFinite(napSeconds) ? napSeconds : 0);

        const budgetSec = Number(appState.day?.daily_awake_budget_sec);
        if (Number.isFinite(budgetSec) && budgetSec > 0 && Number.isFinite(awakeSeconds)) {
            const usedRatio = Math.min(1, Math.max(0, (awakeSeconds || 0) / budgetSec));
            const percentUsed = Math.round(usedRatio * 100);
            if (awakeBudgetLabel) awakeBudgetLabel.textContent = `${percentUsed}% of ${formatDuration(budgetSec)} awake budget used`;
            if (awakeBudgetBar) awakeBudgetBar.style.width = `${percentUsed}%`;
        } else {
            if (awakeBudgetLabel) awakeBudgetLabel.textContent = 'Awake budget unavailable';
            if (awakeBudgetBar) awakeBudgetBar.style.width = '0%';
        }

        if (napControlBtn) {
            napControlBtn.classList.remove('bg-red-500', 'hover:bg-red-600', 'bg-green-500', 'hover:bg-green-600', 'opacity-50', 'cursor-not-allowed');
            let helperMessage = '';

            if (napActive) {
                napControlBtn.textContent = 'Stop Nap';
                napControlBtn.disabled = false;
                napControlBtn.classList.add('bg-red-500', 'hover:bg-red-600');
            } else {
                const canStart = Boolean(appState.nextNap) && !bedtimeActive;
                napControlBtn.textContent = appState.nextNap ? 'Start Nap' : 'All Naps Finished';
                napControlBtn.classList.add('bg-green-500', 'hover:bg-green-600');
                if (bedtimeRequestInFlight) {
                    napControlBtn.disabled = true;
                    napControlBtn.classList.add('opacity-50', 'cursor-not-allowed');
                    helperMessage = 'Saving…';
                } else if (canStart) {
                    napControlBtn.disabled = false;
                } else {
                    napControlBtn.disabled = true;
                    napControlBtn.classList.add('opacity-50', 'cursor-not-allowed');
                    helperMessage = bedtimeActive ? 'End bedtime first.' : 'No upcoming naps.';
                }
            }

            if (napHelperText) {
                if (helperMessage) {
                    napHelperText.textContent = helperMessage;
                    napHelperText.classList.remove('hidden');
                } else {
                    napHelperText.classList.add('hidden');
                }
            }
        }

        if (bedtimeBtn) {
            const disabledBecauseNap = Boolean(appState.currentNap);
            const disabled = disabledBecauseNap || bedtimeRequestInFlight;
            bedtimeBtn.disabled = disabled;
            if (bedtimePressIndicator) bedtimePressIndicator.style.opacity = '0';

            if (bedtimeHelper) {
                if (bedtimeRequestInFlight) {
                    bedtimeHelper.textContent = 'Saving…';
                } else if (disabledBecauseNap) {
                    bedtimeHelper.textContent = 'End nap first.';
                } else if (isBedtimeActive) {
                    bedtimeHelper.textContent = 'Long-press to log wake-up.';
                } else if (!dayStarted) {
                    bedtimeHelper.textContent = 'Long-press to start night sleep.';
                } else {
                    bedtimeHelper.textContent = "Start bedtime when you're ready to log night sleep.";
                }
            }
        }

        if (!dayStarted && !bedtimeActive) {
            stopSummaryTicker();
        } else if (!summaryTicker) {
            summaryTicker = setInterval(updateTodaySummary, 60000);
        }

        scheduleNapReminder();
    }

    setBedtimeUIState = (active) => {
        isBedtimeActive = active;
        if (!bedtimeBtn) return;

        bedtimeBtn.classList.remove(
            'bg-purple-600', 'hover:bg-purple-700',
            'bg-purple-700', 'hover:bg-purple-800',
            'bg-amber-500', 'hover:bg-amber-600'
        );
        if (active) {
            bedtimeBtn.classList.add('bg-amber-500', 'hover:bg-amber-600');
            if (bedtimeBtnLabel) bedtimeBtnLabel.textContent = 'End Bedtime';
        } else {
            bedtimeBtn.classList.add('bg-purple-600', 'hover:bg-purple-700');
            if (bedtimeBtnLabel) bedtimeBtnLabel.textContent = 'Start Bedtime';
        }
    };


    function updateTodaySummary() {
        renderSleepSummary();
    }

    function startNap() {
        if (!appState.nextNap) return alert("No upcoming nap to start!");
        const napIndex = appState.nextNap.nap_index;
        unlockAlarmAudioOnce();
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
        stopAlarmSound();
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

    function formatTimeOrDash(date) {
        if (!date) return '—';
        const formatted = formatTime(date);
        return formatted === 'N/A' ? '—' : formatted;
    }

    function formatDuration(totalSeconds) {
        if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '--';
        const totalMinutes = Math.round(totalSeconds / 60);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        const parts = [];
        if (hours > 0) parts.push(`${hours} h`);
        if (minutes > 0 || parts.length === 0) parts.push(`${minutes} m`);
        return parts.join(' ');
    }

    function secondsSince(startIso) {
        const startMs = new Date(startIso).getTime();
        if (Number.isNaN(startMs)) return null;
        return Math.max(0, Math.floor((nowMs() - startMs) / 1000));
    }

    function calculateAwakeSeconds() {
        if (!appState.day || !appState.day.first_wake_at) return null;
        const wakeStartMs = new Date(appState.day.first_wake_at).getTime();
        if (Number.isNaN(wakeStartMs)) return null;

        const now = nowMs();
        let awakeMs = now - wakeStartMs;
        if (awakeMs <= 0) return 0;

        const subtractWindow = (startIso, endIso) => {
            const startMs = new Date(startIso).getTime();
            let endMs = endIso ? new Date(endIso).getTime() : now;
            if (Number.isNaN(startMs)) return;
            if (Number.isNaN(endMs)) endMs = now;
            const clampedStart = Math.max(startMs, wakeStartMs);
            const clampedEnd = Math.min(endMs, now);
            if (clampedEnd > clampedStart) {
                awakeMs -= (clampedEnd - clampedStart);
            }
        };

        appState.naps.forEach((nap) => {
            if (!nap.actual_start_at) return;
            if (nap.status === 'finished' && nap.actual_end_at) {
                subtractWindow(nap.actual_start_at, nap.actual_end_at);
            } else if (nap.status === 'in_progress') {
                subtractWindow(nap.actual_start_at, null);
            }
        });

        if (appState.sleepSession && appState.sleepSession.start_at && !appState.sleepSession.end_at) {
            subtractWindow(appState.sleepSession.start_at, null);
        }

        return Math.max(0, Math.floor(awakeMs / 1000));
    }
    function calculateNapSeconds() {
        if (!Array.isArray(appState.naps) || appState.naps.length === 0) return 0;
        const now = nowMs();
        let totalMs = 0;

        appState.naps.forEach((nap) => {
            if (!nap.actual_start_at) return;
            const startMs = new Date(nap.actual_start_at).getTime();
            if (Number.isNaN(startMs)) return;

            let endMs;
            if (nap.status === 'finished' && nap.actual_end_at) {
                endMs = new Date(nap.actual_end_at).getTime();
            } else if (nap.status === 'in_progress') {
                endMs = now;
            } else {
                endMs = startMs;
            }

            if (Number.isNaN(endMs)) endMs = now;
            const clampedEnd = Math.min(endMs, now);
            if (clampedEnd > startMs) {
                totalMs += clampedEnd - startMs;
            }
        });

        return Math.max(0, Math.floor(totalMs / 1000));
    }

    function renderReminderRow() {
        if (!napReminderBtn || !napReminderText || !napReminderRow) return;

        napReminderRow.classList.remove('hidden');

        const napActive = Boolean(appState.currentNap && appState.currentNapProjectedEnd instanceof Date && !Number.isNaN(appState.currentNapProjectedEnd?.getTime()));
        const hasUpcoming = Boolean(appState.nextNapPlannedStart instanceof Date && !Number.isNaN(appState.nextNapPlannedStart?.getTime()));
        const scheduleError = appState.scheduleError;

        const globalLead = Number(appState.globalEndReminderSec);
        const overrideLead = Number(appState.endReminderSecOverride);
        const leadSec = napActive && Number.isFinite(overrideLead)
            ? overrideLead
            : Number.isFinite(globalLead)
                ? globalLead
                : DEFAULT_END_REMINDER_LEAD_SEC;

        const showHelper = (text) => {
            if (!napReminderHelper) return;
            if (text) {
                napReminderHelper.textContent = text;
                napReminderHelper.classList.remove('hidden');
            } else {
                napReminderHelper.textContent = '';
                napReminderHelper.classList.add('hidden');
            }
        };

        if (scheduleError) {
            napReminderBtn.disabled = true;
            napReminderBtn.setAttribute('aria-disabled', 'true');
            napReminderText.textContent = formatDurationValue(leadSec);
            showHelper('Settings unavailable');
            return;
        }

        if (napActive) {
            napReminderBtn.disabled = false;
            napReminderBtn.setAttribute('aria-disabled', 'false');
            napReminderText.textContent = formatDurationValue(leadSec);

            if (leadSec > 0) {
                let scheduled = appState.endReminderScheduledAt instanceof Date && !Number.isNaN(appState.endReminderScheduledAt?.getTime())
                    ? appState.endReminderScheduledAt
                    : null;

                if (!scheduled && appState.currentNapProjectedEnd instanceof Date && !Number.isNaN(appState.currentNapProjectedEnd?.getTime())) {
                    scheduled = new Date(appState.currentNapProjectedEnd.getTime() - leadSec * 1000);
                }

                showHelper(scheduled ? `before nap ends • fires at ${formatTime(scheduled)}` : 'before nap ends');
            } else {
                napReminderHelper.classList.add('hidden');
            }
            return;
        }

        if (hasUpcoming) {
            napReminderBtn.disabled = false;
            napReminderBtn.setAttribute('aria-disabled', 'false');
            napReminderText.textContent = formatDurationValue(leadSec);
            if (appState.upcomingAlarmDismissedNapIndex != null && appState.nextNap && appState.nextNap.nap_index === appState.upcomingAlarmDismissedNapIndex) {
                showHelper('Dismissed for today');
            } else if (appState.upcomingAlarmScheduledAt instanceof Date && !Number.isNaN(appState.upcomingAlarmScheduledAt?.getTime())) {
                showHelper(`before next nap • fires at ${formatTime(appState.upcomingAlarmScheduledAt)}`);
            } else {
                showHelper('before next nap');
            }
        } else {
            napReminderBtn.disabled = true;
            napReminderBtn.setAttribute('aria-disabled', 'true');
            napReminderText.textContent = formatDurationValue(leadSec);
            showHelper('No upcoming naps');
        }

        renderNapAlarmChip();
    }

    function scheduleEndReminder() {
        cancelEndReminder({ skipRender: true });

        if (!appState.currentNap || !(appState.currentNapProjectedEnd instanceof Date)) {
            return;
        }

        const napEnd = appState.currentNapProjectedEnd.getTime();
        if (Number.isNaN(napEnd)) return;

        const overrideLead = Number(appState.endReminderSecOverride);
        const globalLead = Number(appState.globalEndReminderSec);
        let leadSec = Number.isFinite(overrideLead)
            ? overrideLead
            : Number.isFinite(globalLead)
                ? globalLead
                : DEFAULT_END_REMINDER_LEAD_SEC;

        if (!Number.isFinite(leadSec) || leadSec <= 0) {
            appState.endReminderScheduledAt = null;
            appState.endReminderAutoAdjusted = false;
            return;
        }

        const now = nowMs();
        const leadMs = leadSec * 1000;
        let desiredTarget = napEnd - leadMs;
        let autoAdjusted = false;

        if (!Number.isFinite(desiredTarget)) {
            return;
        }

        if (desiredTarget < now) {
            desiredTarget = now;
            autoAdjusted = true;
        }

        if (desiredTarget > napEnd) {
            desiredTarget = napEnd;
            autoAdjusted = true;
        }

        const delay = Math.max(0, desiredTarget - now);

        appState.endReminderScheduledAt = new Date(desiredTarget);
        appState.endReminderAutoAdjusted = autoAdjusted;

        const actualLeadSec = Math.max(0, Math.round((napEnd - desiredTarget) / 1000));
        logEvent('nap_alarm_scheduled_at', {
            context: 'end',
            fireAt: new Date(desiredTarget).toISOString(),
            leadTimeSec: actualLeadSec,
        });

        endReminderTimeout = window.setTimeout(() => {
            endReminderTimeout = null;
            handleEndReminderFire();
        }, delay);
    }

    function cancelEndReminder({ skipRender = false, keepActions = false } = {}) {
        if (endReminderTimeout) {
            clearTimeout(endReminderTimeout);
            endReminderTimeout = null;
        }
        appState.endReminderScheduledAt = null;
        appState.endReminderAutoAdjusted = false;
        if (!keepActions && endReminderActions) {
            endReminderActions.classList.add('hidden');
        }
        if (napTimerContainer) {
            napTimerContainer.classList.remove('animate-pulse');
        }
        if (!keepActions && alarmToastContext === 'end') {
            clearAlarmToast({ restoreFocus: false });
        }
        if (!keepActions) {
            stopAlarmSound();
        }
        if (!skipRender) {
            renderReminderRow();
        }
    }

    function handleEndReminderFire() {
        cancelEndReminder({ skipRender: true, keepActions: true });
        const now = nowMs();
        const napEnd = appState.currentNapProjectedEnd instanceof Date ? appState.currentNapProjectedEnd.getTime() : now;
        const remainingSec = Math.max(0, Math.round((napEnd - now) / 1000));

        if (napTimerContainer) {
            napTimerContainer.classList.add('animate-pulse');
        }
        if (endReminderActions) {
            endReminderActions.classList.remove('hidden');
        }
        if (napReminderHelper) {
            napReminderHelper.textContent = 'Reminder firing now.';
            napReminderHelper.classList.remove('hidden');
        }

        logEvent('nap_alarm_fired', { context: 'end', remainingSec });
        showAlarmToast({ context: 'end', leadSec: remainingSec, fireAt: new Date(now) });
        playAlarmSound();
        announce('End-of-nap reminder firing now.');
    }

    function snoozeEndReminder() {
        if (!appState.currentNap || !(appState.currentNapProjectedEnd instanceof Date)) {
            return dismissEndReminder();
        }

        if (endReminderActions) endReminderActions.classList.add('hidden');
        if (napTimerContainer) napTimerContainer.classList.remove('animate-pulse');

        const napEnd = appState.currentNapProjectedEnd.getTime();
        const now = nowMs();
        if (!Number.isFinite(napEnd) || napEnd <= now) {
            return dismissEndReminder();
        }

        const snoozeMs = 2 * 60 * 1000;
        const targetMs = Math.min(napEnd, now + snoozeMs);
        const delay = Math.max(0, targetMs - now);

        if (endReminderTimeout) {
            clearTimeout(endReminderTimeout);
        }

        appState.endReminderScheduledAt = new Date(targetMs);
        appState.endReminderAutoAdjusted = true;
        logEvent('nap_alarm_scheduled_at', {
            context: 'end',
            fireAt: new Date(targetMs).toISOString(),
            leadTimeSec: Math.max(0, Math.round((napEnd - targetMs) / 1000)),
        });
        endReminderTimeout = window.setTimeout(() => {
            endReminderTimeout = null;
            handleEndReminderFire();
        }, delay);

        logEvent('nap_alarm_snoozed', { context: 'end', newFireAt: new Date(targetMs).toISOString() });

        renderReminderRow();
        showToast('Reminder snoozed for 2 minutes.', 'info');
        announce('End-of-nap reminder snoozed for two minutes.');
        clearAlarmToast({ restoreFocus: false });
        stopAlarmSound();
        return true;
    }

    function dismissEndReminder() {
        cancelEndReminder();
        logEvent('nap_alarm_dismissed', { context: 'end' });
        showToast('Reminder dismissed.', 'info');
        announce('End-of-nap reminder dismissed.');
        clearAlarmToast({ restoreFocus: false });
        stopAlarmSound();
        return true;
    }

    function formatRelative(totalSeconds) {
        if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '0 sec';
        if (totalSeconds < 60) {
            return `${totalSeconds} sec`;
        }
        const minutes = Math.round(totalSeconds / 60);
        return minutes === 1 ? '1 min' : `${minutes} min`;
    }

    function formatLeadShort(seconds) {
        if (!Number.isFinite(seconds) || seconds <= 0) return 'off';
        if (seconds < 60) return `${seconds} sec`;
        const minutes = seconds / 60;
        return minutes === 1 ? '1 min' : `${minutes} min`;
    }

    function formatLeadPlain(seconds) {
        if (!Number.isFinite(seconds) || seconds <= 0) return 'off';
        if (seconds < 60) return `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
        const minutes = seconds / 60;
        return minutes === 1 ? '1 minute' : `${minutes} minutes`;
    }

    function formatLeadChip(seconds) {
        if (!Number.isFinite(seconds) || seconds <= 0) return '';
        if (seconds < 60) return `${seconds} s`;
        const minutes = Math.max(1, Math.round(seconds / 60));
        return minutes === 1 ? '1 min' : `${minutes} min`;
    }

    function formatLeadToast(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) return '0 s';
        if (seconds < 60) return `${Math.round(seconds)} s`;
        const minutes = Math.max(1, Math.round(seconds / 60));
        return minutes === 1 ? '1 min' : `${minutes} min`;
    }

    function formatDurationValue(seconds) {
        if (!Number.isFinite(seconds) || seconds <= 0) return 'Off';
        if (seconds < 60) return `${seconds} s`;
        const minutes = seconds / 60;
        return minutes === 1 ? '1 min' : `${minutes} min`;
    }

    function computeScheduleSignature(naps) {
        if (!Array.isArray(naps) || naps.length === 0) return 'empty';
        return naps
            .map((nap) => [
                nap.nap_index,
                nap.status,
                nap.actual_start_at,
                nap.actual_end_at,
                nap.adjusted_duration_sec,
                nap.planned_duration_sec,
            ].join(':'))
            .join('|');
    }

    function cancelAlarms({ resetOverride = true } = {}) {
        if (upcomingNapAlarmTimeout) {
            clearTimeout(upcomingNapAlarmTimeout);
            upcomingNapAlarmTimeout = null;
        }

        if (resetOverride) {
            appState.upcomingAlarmScheduledAt = null;
            appState.upcomingAlarmOverrideMs = null;
            appState.upcomingAlarmOverrideNapIndex = null;
        }

        if (alarmToastContext === 'next') {
            clearAlarmToast({ restoreFocus: false });
        }

        stopAlarmSound();
    }

    function scheduleUpcomingAlarm() {
        if (upcomingNapAlarmTimeout) {
            clearTimeout(upcomingNapAlarmTimeout);
            upcomingNapAlarmTimeout = null;
        }

        const nextStart = appState.nextNapPlannedStart;
        if (!(nextStart instanceof Date) || Number.isNaN(nextStart.getTime())) {
            appState.upcomingAlarmScheduledAt = null;
            return;
        }

        const nextStartMs = nextStart.getTime();
        if (!appState.nextNap) {
            appState.upcomingAlarmScheduledAt = null;
            return;
        }

        if (appState.upcomingAlarmDismissedNapIndex != null && appState.nextNap.nap_index === appState.upcomingAlarmDismissedNapIndex) {
            appState.upcomingAlarmScheduledAt = null;
            return;
        }

        const now = nowMs();
        let targetMs = null;

        if (
            appState.upcomingAlarmOverrideNapIndex === appState.nextNap.nap_index &&
            Number.isFinite(appState.upcomingAlarmOverrideMs)
        ) {
            targetMs = appState.upcomingAlarmOverrideMs;
        } else {
            const leadSec = Number(appState.globalEndReminderSec);
            if (!Number.isFinite(leadSec) || leadSec <= 0) {
                appState.upcomingAlarmScheduledAt = null;
                return;
            }
            targetMs = nextStartMs - leadSec * 1000;
            appState.upcomingAlarmOverrideMs = null;
            appState.upcomingAlarmOverrideNapIndex = null;
        }

        if (!Number.isFinite(targetMs)) {
            appState.upcomingAlarmScheduledAt = null;
            return;
        }

        if (targetMs > nextStartMs) {
            targetMs = nextStartMs;
        }

        if (targetMs <= now) {
            appState.upcomingAlarmScheduledAt = null;
            handleUpcomingAlarmFire({ scheduledMs: targetMs });
            return;
        }

        appState.upcomingAlarmScheduledAt = new Date(targetMs);
        const leadSec = Math.max(0, Math.round((nextStartMs - targetMs) / 1000));
        logEvent('nap_alarm_scheduled_at', {
            context: 'next',
            fireAt: new Date(targetMs).toISOString(),
            leadTimeSec: leadSec,
        });

        const delay = targetMs - now;
        upcomingNapAlarmTimeout = window.setTimeout(() => {
            upcomingNapAlarmTimeout = null;
            appState.upcomingAlarmScheduledAt = null;
            if (appState.upcomingAlarmOverrideNapIndex === appState.nextNap?.nap_index) {
                appState.upcomingAlarmOverrideMs = null;
                appState.upcomingAlarmOverrideNapIndex = null;
            }
            handleUpcomingAlarmFire({ scheduledMs: targetMs });
        }, delay);
    }

    function handleUpcomingAlarmFire({ scheduledMs } = {}) {
        const now = nowMs();
        const fireDate = new Date(now);
        const nextStart = appState.nextNapPlannedStart instanceof Date && !Number.isNaN(appState.nextNapPlannedStart?.getTime())
            ? appState.nextNapPlannedStart
            : null;
        const remainingSec = nextStart
            ? Math.max(0, Math.round((nextStart.getTime() - now) / 1000))
            : 0;

        appState.upcomingAlarmScheduledAt = null;
        if (appState.nextNap) {
            appState.upcomingAlarmDismissedNapIndex = appState.nextNap.nap_index;
        }

        appState.upcomingAlarmOverrideMs = null;
        appState.upcomingAlarmOverrideNapIndex = null;

        if (napReminderHelper) {
            napReminderHelper.textContent = 'Reminder firing now.';
            napReminderHelper.classList.remove('hidden');
        }

        logEvent('nap_alarm_fired', { context: 'next', remainingSec, scheduledMs: Number.isFinite(scheduledMs) ? scheduledMs : null });
        showAlarmToast({ context: 'next', leadSec: remainingSec, fireAt: fireDate });
        playAlarmSound();
        announce('Upcoming nap reminder firing now.');
    }

    function snoozeUpcomingAlarm() {
        if (!appState.nextNap || !(appState.nextNapPlannedStart instanceof Date) || Number.isNaN(appState.nextNapPlannedStart?.getTime())) {
            return false;
        }

        const now = nowMs();
        const napStartMs = appState.nextNapPlannedStart.getTime();
        if (!Number.isFinite(napStartMs) || napStartMs <= now) {
            return false;
        }

        const snoozeMs = 2 * 60 * 1000;
        const targetMs = Math.min(napStartMs, now + snoozeMs);

        appState.upcomingAlarmOverrideMs = targetMs;
        appState.upcomingAlarmOverrideNapIndex = appState.nextNap.nap_index;
        appState.upcomingAlarmDismissedNapIndex = null;

        scheduleUpcomingAlarm();
        renderReminderRow();

        const scheduled = appState.upcomingAlarmScheduledAt instanceof Date && !Number.isNaN(appState.upcomingAlarmScheduledAt?.getTime());
        const dismissedForNap = appState.nextNap && appState.upcomingAlarmDismissedNapIndex === appState.nextNap.nap_index;
        if (!scheduled && !dismissedForNap) {
            return false;
        }

        logEvent('nap_alarm_snoozed', { context: 'next', newFireAt: new Date(targetMs).toISOString() });
        showToast('Reminder snoozed for 2 minutes.', 'info');
        announce('Upcoming nap reminder snoozed for two minutes.');
        clearAlarmToast({ restoreFocus: false });
        stopAlarmSound();
        return true;
    }

    function dismissUpcomingAlarm() {
        if (!appState.nextNap) {
            cancelAlarms();
            renderReminderRow();
            return false;
        }

        appState.upcomingAlarmDismissedNapIndex = appState.nextNap.nap_index;
        cancelAlarms();
        renderReminderRow();

        logEvent('nap_alarm_dismissed', { context: 'next' });
        showToast('Reminder dismissed.', 'info');
        announce('Upcoming nap reminder dismissed.');
        clearAlarmToast({ restoreFocus: false });
        stopAlarmSound();
        return true;
    }

    function scheduleNapReminder() {
        const napActive = Boolean(appState.currentNap && appState.currentNapProjectedEnd instanceof Date && !Number.isNaN(appState.currentNapProjectedEnd?.getTime()));

        if (napActive) {
            scheduleEndReminder();
        } else {
            cancelEndReminder({ skipRender: true });

            if (appState.nextNapPlannedStart instanceof Date && !Number.isNaN(appState.nextNapPlannedStart?.getTime())) {
                scheduleUpcomingAlarm();
            } else {
                cancelAlarms();
            }
        }

        renderReminderRow();
    }

    function attachBedtimeLongPress() {
        if (!bedtimeBtn) return;

        const LONG_PRESS_MS = 700;
        let pressTimer = null;

        const resetIndicator = () => {
            if (bedtimePressIndicator) bedtimePressIndicator.style.opacity = '0';
        };

        const cancelTimer = () => {
            if (pressTimer) {
                clearTimeout(pressTimer);
                pressTimer = null;
            }
            resetIndicator();
        };

        const startTimer = () => {
            if (bedtimeBtn.disabled || bedtimeRequestInFlight) return;
            if (pressTimer) clearTimeout(pressTimer);
            if (bedtimePressIndicator) bedtimePressIndicator.style.opacity = '1';
            pressTimer = window.setTimeout(() => {
                pressTimer = null;
                resetIndicator();
                handleBedtimeToggle();
            }, LONG_PRESS_MS);
        };

        bedtimeBtn.addEventListener('pointerdown', (event) => {
            if (bedtimeBtn.disabled || bedtimeRequestInFlight) return;
            bedtimeBtn.setPointerCapture?.(event.pointerId);
            event.preventDefault();
            startTimer();
        });

        const pointerCancel = (event) => {
            bedtimeBtn.releasePointerCapture?.(event.pointerId);
            cancelTimer();
        };

        bedtimeBtn.addEventListener('pointerup', pointerCancel);
        bedtimeBtn.addEventListener('pointercancel', pointerCancel);
        bedtimeBtn.addEventListener('pointerleave', pointerCancel);

        bedtimeBtn.addEventListener('keydown', (event) => {
            if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
                if (bedtimeBtn.disabled || bedtimeRequestInFlight) return;
                event.preventDefault();
                startTimer();
            }
        });

        bedtimeBtn.addEventListener('keyup', (event) => {
            if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault();
                cancelTimer();
            }
        });

        bedtimeBtn.addEventListener('click', (event) => {
            event.preventDefault();
        });
    }

    function handleBedtimeToggle() {
        if (!bedtimeBtn || bedtimeBtn.disabled || bedtimeRequestInFlight) return;

        const togglingToActive = !isBedtimeActive;
        const timestamp = nowIso();
        const previousSession = appState.sleepSession ? { ...appState.sleepSession } : null;

        bedtimeRequestInFlight = true;

        if (togglingToActive) {
            setBedtimeUIState(true);
            appState.sleepSession = { start_at: timestamp };
            cancelAlarms();
            cancelEndReminder({ skipRender: true });
            renderSleepSummary();

            fetch('/api/day/bedtime', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'sleep', timestamp })
            })
            .then((res) => res.json().catch(() => ({})))
            .then((data) => {
                if (!data || data.status !== 'success') {
                    throw new Error(data?.message || "Couldn't save. Try again.");
                }
                showToast('Bedtime started.', 'success');
                announce('Bedtime started.');
            })
            .catch((error) => {
                console.error('Failed to start bedtime', error);
                appState.sleepSession = previousSession;
                setBedtimeUIState(false);
                showToast("Couldn't save. Try again.", 'error');
                announce("Couldn't save. Try again.");
                fetchTodaySchedule();
            })
            .finally(() => {
                bedtimeRequestInFlight = false;
                renderSleepSummary();
            });
        } else {
            setBedtimeUIState(false);
            cancelEndReminder({ skipRender: true });
            renderSleepSummary();

            fetch('/api/day/bedtime', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'wake', timestamp })
            })
            .then((res) => res.json().catch(() => ({})))
            .then((data) => {
                if (!data || data.status !== 'success') {
                    throw new Error(data?.message || "Couldn't save. Try again.");
                }
                bedtimeRequestInFlight = false;
                showToast('Woke for the day.', 'success');
                announce('Woke for the day.');
                renderSleepSummary();
                return fetchTodaySchedule();
            })
            .catch((error) => {
                console.error('Failed to end bedtime', error);
                bedtimeRequestInFlight = false;
                appState.sleepSession = previousSession;
                setBedtimeUIState(true);
                showToast("Couldn't save. Try again.", 'error');
                announce("Couldn't save. Try again.");
                renderSleepSummary();
            });
        }
    }


    function updateGlobalEndReminder(newLeadSec) {
        return fetch('/api/settings/reminder', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lead_time_sec: newLeadSec }),
        })
        .then(async (res) => {
            const payload = await res.json().catch(() => ({}));
            if (!res.ok || payload.status !== 'success') {
                const errorMessage = payload.message || "Couldn't save reminder.";
                throw new Error(errorMessage);
            }
            return payload.lead_time_sec ?? newLeadSec;
        });
    }

    function clearAlarmToast({ restoreFocus = true } = {}) {
        if (alarmToastTimer) {
            clearTimeout(alarmToastTimer);
            alarmToastTimer = null;
        }
        if (alarmToastKeyHandler) {
            document.removeEventListener('keydown', alarmToastKeyHandler, true);
            alarmToastKeyHandler = null;
        }
        if (alarmToastNode) {
            alarmToastNode.remove();
            alarmToastNode = null;
        }
        if (alarmToastPulseManaged && napTimerContainer) {
            napTimerContainer.classList.remove('animate-pulse');
        }
        alarmToastPulseManaged = false;
        const focusTarget = alarmToastRestoreFocus;
        alarmToastRestoreFocus = null;
        alarmToastContext = null;

        if (restoreFocus && focusTarget && typeof focusTarget.focus === 'function') {
            window.setTimeout(() => {
                if (document.contains(focusTarget)) {
                    focusTarget.focus();
                }
            }, 0);
        }
    }

    function showAlarmToast({ context, leadSec, fireAt }) {
        if (!toastRoot) {
            console.debug('Nap alarm:', context, leadSec, fireAt);
            return;
        }

        const normalizedContext = context === 'end' ? 'end' : 'next';

        clearAlarmToast({ restoreFocus: false });

        const activeEl = document.activeElement;
        alarmToastRestoreFocus = (activeEl && typeof activeEl.focus === 'function') ? activeEl : null;

        const toast = document.createElement('div');
        toast.className = 'nap-alarm-toast pointer-events-auto w-full max-w-md rounded-2xl bg-white p-4 shadow-lg ring-1 ring-gray-200';
        toast.setAttribute('data-context', normalizedContext);

        const heading = document.createElement('p');
        heading.className = 'text-sm font-semibold text-gray-900';
        heading.textContent = 'Nap alarm';

        const subtitle = document.createElement('p');
        subtitle.className = 'mt-1 text-xs text-gray-600';
        const subtitleSuffix = normalizedContext === 'end' ? 'before end' : 'before next nap';
        subtitle.textContent = `${formatLeadToast(leadSec)} ${subtitleSuffix}`;

        const actions = document.createElement('div');
        actions.className = 'mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end';

        const snoozeBtn = document.createElement('button');
        snoozeBtn.type = 'button';
        snoozeBtn.className = 'rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2';
        snoozeBtn.textContent = 'Snooze 2 min';

        const dismissBtn = document.createElement('button');
        dismissBtn.type = 'button';
        dismissBtn.className = 'rounded-xl bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-offset-2';
        dismissBtn.textContent = 'Dismiss';

        const handleAction = (action) => {
            if (alarmToastTimer) {
                clearTimeout(alarmToastTimer);
                alarmToastTimer = null;
            }

            let success = false;
            try {
                if (action === 'snooze') {
                    success = normalizedContext === 'end' ? snoozeEndReminder() : snoozeUpcomingAlarm();
                } else if (action === 'dismiss') {
                    success = normalizedContext === 'end' ? dismissEndReminder() : dismissUpcomingAlarm();
                }
            } catch (error) {
                console.error('Failed to handle alarm toast action', error);
                success = false;
            }

            if (!success) {
                showToast("Couldn't update alarm. Try again.", 'error');
                announce("Couldn't update alarm. Try again.");
                alarmToastTimer = window.setTimeout(() => {
                    clearAlarmToast();
                }, 6000);
                return;
            }

            clearAlarmToast();
        };

        snoozeBtn.addEventListener('click', () => handleAction('snooze'));
        dismissBtn.addEventListener('click', () => handleAction('dismiss'));

        actions.appendChild(snoozeBtn);
        actions.appendChild(dismissBtn);

        toast.appendChild(heading);
        toast.appendChild(subtitle);
        toast.appendChild(actions);

        toastRoot.appendChild(toast);
        alarmToastNode = toast;
        alarmToastContext = normalizedContext;

        if (napTimerContainer && normalizedContext === 'next') {
            napTimerContainer.classList.add('animate-pulse');
            alarmToastPulseManaged = true;
        } else {
            alarmToastPulseManaged = false;
        }

        alarmToastTimer = window.setTimeout(() => {
            clearAlarmToast();
        }, 6000);

        alarmToastKeyHandler = (event) => {
            if (!alarmToastNode) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                clearAlarmToast();
                return;
            }

            if (event.key.toLowerCase?.() === 's') {
                event.preventDefault();
                handleAction('snooze');
                return;
            }

            if (event.key.toLowerCase?.() === 'd') {
                event.preventDefault();
                handleAction('dismiss');
            }
        };

        document.addEventListener('keydown', alarmToastKeyHandler, true);

        window.setTimeout(() => {
            snoozeBtn.focus();
        }, 0);
    }

    function showToast(message, type = 'info') {
        if (!toastContainer) {
            console.log(`[toast:${type}]`, message);
            return;
        }

        const colorMap = {
            success: 'bg-emerald-500',
            error: 'bg-red-500',
            info: 'bg-indigo-500',
            warning: 'bg-amber-500',
        };

        const toast = document.createElement('div');
        toast.className = `${colorMap[type] || colorMap.info} pointer-events-auto rounded-full px-4 py-2 text-sm font-medium text-white shadow-lg transition`;
        toast.textContent = message;

        toastContainer.appendChild(toast);

        window.setTimeout(() => {
            toast.classList.add('opacity-0', 'translate-y-2');
        }, 2800);

        window.setTimeout(() => {
            toast.remove();
        }, 3500);
    }

    function announce(message) {
        if (!ariaLiveRegion) return;
        ariaLiveRegion.textContent = '';
        window.setTimeout(() => {
            ariaLiveRegion.textContent = message;
        }, 50);
    }

    function logEvent(name, payload = {}) {
        const timestamp = new Date(nowMs()).toISOString();
        console.debug(`[event] ${timestamp} ${name}`, payload);
    }

    function ensureFallbackAudioContext() {
        if (typeof window === 'undefined') return null;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return null;
        if (!fallbackAudioCtx) {
            fallbackAudioCtx = new Ctx();
            fallbackGainNode = fallbackAudioCtx.createGain();
            fallbackGainNode.gain.value = 0.18;
            fallbackGainNode.connect(fallbackAudioCtx.destination);
        }
        return fallbackAudioCtx;
    }

    function startFallbackTone() {
        const ctx = ensureFallbackAudioContext();
        if (!ctx || !appState.soundEnabled) return;

        if (ctx.state === 'suspended') {
            ctx.resume().catch(() => {});
        }

        if (fallbackOscillator) {
            stopFallbackTone();
        }

        fallbackOscillator = ctx.createOscillator();
        fallbackOscillator.type = 'sine';
        fallbackOscillator.frequency.value = 880;
        fallbackOscillator.connect(fallbackGainNode);
        fallbackOscillator.start();

        if (alarmSoundStopTimer) {
            clearTimeout(alarmSoundStopTimer);
        }
        alarmSoundStopTimer = window.setTimeout(() => {
            stopAlarmSound();
        }, 10000);
    }

    function stopFallbackTone() {
        if (fallbackOscillator) {
            try {
                fallbackOscillator.stop();
            } catch (error) {
                // Ignore stop errors if oscillator already stopped.
            }
            fallbackOscillator.disconnect();
            fallbackOscillator = null;
        }
        if (fallbackAudioCtx && alarmSoundStopTimer) {
            // timer cleared by stopAlarmSound.
        }
    }

    function updateSoundToggleControl() {
        if (!napReminderSoundToggle) return;

        if (appState.scheduleError) {
            napReminderSoundToggle.classList.add('hidden');
        } else {
            napReminderSoundToggle.classList.remove('hidden');
        }

        napReminderSoundToggle.textContent = appState.soundEnabled ? 'Sound on' : 'Sound off';

        if (napAudioHint) {
            if (alarmAudioUnlockFailed && appState.soundEnabled) {
                napAudioHint.classList.remove('hidden');
            } else {
                napAudioHint.classList.add('hidden');
            }
        }
    }

    function unlockAlarmAudioOnce() {
        if (!alarmAudio) return Promise.resolve(false);
        if (alarmAudioUnlocked) return Promise.resolve(true);
        if (alarmAudioUnlockPromise) return alarmAudioUnlockPromise;

        alarmAudioUnlockFailed = false;

        const ctx = ensureFallbackAudioContext();
        if (ctx && ctx.state === 'suspended') {
            ctx.resume().catch(() => {});
        }

        const attempt = alarmAudio.play()
            .then(() => {
                alarmAudio.pause();
                alarmAudio.currentTime = 0;
                alarmAudioUnlocked = true;
                alarmAudio.loop = false;
                alarmAudioUnlockFailed = false;
                if (napAudioHint) napAudioHint.classList.add('hidden');
                updateSoundToggleControl();
                return true;
            })
            .catch((error) => {
                console.warn('Alarm audio unlock blocked', error);
                alarmAudioUnlockFailed = true;
                updateSoundToggleControl();
                return false;
            })
            .finally(() => {
                alarmAudioUnlockPromise = null;
            });

        alarmAudioUnlockPromise = attempt;
        return attempt;
    }

    function stopAlarmSound() {
        if (alarmSoundStopTimer) {
            clearTimeout(alarmSoundStopTimer);
            alarmSoundStopTimer = null;
        }
        if (alarmAudio) {
            alarmAudio.loop = false;
            alarmAudio.pause();
            try {
                alarmAudio.currentTime = 0;
            } catch (error) {
                // Some browsers restrict setting currentTime while detached; ignore.
            }
        }
        stopFallbackTone();
    }

    function playAlarmSound() {
        if (!alarmAudio || !appState.soundEnabled) return;

        unlockAlarmAudioOnce().then((unlocked) => {
            if (!unlocked || !appState.soundEnabled) {
                startFallbackTone();
                return;
            }

            if (alarmSoundStopTimer) {
                clearTimeout(alarmSoundStopTimer);
                alarmSoundStopTimer = null;
            }

            alarmAudio.loop = true;
            try {
                alarmAudio.currentTime = 0;
            } catch (error) {
                console.warn('Unable to reset alarm audio time', error);
            }

            const playPromise = alarmAudio.play();
            if (playPromise && typeof playPromise.catch === 'function') {
                playPromise.catch((error) => {
                    console.warn('Alarm audio play blocked', error);
                    alarmAudioUnlockFailed = true;
                    updateSoundToggleControl();
                    startFallbackTone();
                });
            }

            alarmSoundStopTimer = window.setTimeout(() => {
                stopAlarmSound();
            }, 10000);
        });
    }

    function stopSummaryTicker() {
        if (summaryTicker) {
            clearInterval(summaryTicker);
            summaryTicker = null;
        }
    }

    function updateTodaySummary() {
        renderSleepSummary();
    }

    window.addEventListener('pagehide', () => stopAlarmSound());
    window.addEventListener('beforeunload', () => stopAlarmSound());

    // --- Initial Load ---
    renderSleepSummary();
    fetchEndReminderSetting().finally(() => fetchTodaySchedule());

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
            renderSleepSummary();
        }
    });
});
