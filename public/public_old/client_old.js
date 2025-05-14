// public/client.js

// --- Global Variables ---
let socket;
let userRole = null; // 'instructor' or 'student'
let playerName = null;
let playerId = null;
let currentRound = 0;
let totalRounds = 10;
let endowment = 20;
let maxPunishmentPerTarget = 10; // Store game parameters
let punishmentCost = 1;
let punishmentEffect = 3;
let gameConfig = {}; // Store received game config
let isPunishmentActiveForRound = false; // Track if punishment stage is expected
let instructorChart = null; // <<< ADDED: Variable to hold the chart instance
let finalInstructorChart = null; // <<< ADDED: Variable for the game over chart instance

// --- DOM Elements ---
const appContainer = document.getElementById('app-container');
const roleSelectionView = document.getElementById('role-selection');
const instructorSetupView = document.getElementById('instructor-setup');
const instructorGameView = document.getElementById('instructor-game');
const studentJoinView = document.getElementById('student-join');
const studentGameView = document.getElementById('student-game');
const gameOverView = document.getElementById('game-over');
const connectionStatus = document.getElementById('connection-status');

// --- Chart Functions ---

/**
 * Initializes or resets the instructor's main game chart.
 */
function initInstructorChart() {
    if (userRole !== 'instructor') return;
    console.log("Initializing instructor chart.");
    const ctx = document.getElementById('instructorChartCanvas')?.getContext('2d');
    if (!ctx) {
        console.error("Instructor chart canvas context not found.");
        return;
    }

    // Destroy existing chart instance if it exists, before creating a new one
    if (instructorChart) {
        console.log("Destroying previous instructor chart instance.");
        instructorChart.destroy();
        instructorChart = null;
    }

    instructorChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [], // x-axis labels (Round numbers)
            datasets: [{
                label: 'Average Contribution',
                data: [], // y-axis data (Average contribution values)
                borderColor: 'rgb(75, 192, 192)', // Teal
                backgroundColor: 'rgba(75, 192, 192, 0.2)',
                tension: 0.1, // Makes the line slightly curved
                fill: false // Don't fill area under the line
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false, // Important to fit container height
            plugins: {
                title: {
                    display: false, // Title is already above the chart area
                },
                legend: {
                    display: true,
                    position: 'bottom',
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: 'Round'
                    },
                    beginAtZero: true,
                     ticks: {
                         stepSize: 1, // Ensure integer round numbers
                         callback: function(value, index, values) {
                            // Only show integer labels for rounds
                            const round = this.getLabelForValue(value);
                            return Number.isInteger(round) ? round : '';
                        }
                     }
                },
                y: {
                    title: {
                        display: true,
                        text: 'Avg. Tokens Contributed'
                    },
                    beginAtZero: true,
                    suggestedMax: gameConfig.endowment || 20 // Suggest max based on endowment
                }
            }
        }
    });
    console.log("Instructor chart initialized.");
}

/**
 * Updates the instructor's chart with new data from results history.
 * @param {Array} history - The resultsHistory array [{ round, avgContribution }]
 */
function updateInstructorChart(history) {
    if (userRole !== 'instructor' || !instructorChart) return;
    console.log("Updating instructor chart with history:", history);

    if (!Array.isArray(history)) {
        console.error("Invalid history data for chart update.");
        return;
    }

    const labels = history.map(item => item.round);
    const data = history.map(item => item.avgContribution);

    // Ensure labels are unique and sorted if necessary (usually they are by round)
    instructorChart.data.labels = labels;
    instructorChart.data.datasets[0].data = data;
    instructorChart.update(); // Redraw the chart
    console.log("Instructor chart updated.");
}

/**
 * Initializes or resets the instructor's final game chart.
 * @param {Array} history - The final resultsHistory array [{ round, avgContribution }]
 */
function initFinalInstructorChart(history) {
    if (userRole !== 'instructor' || !Array.isArray(history)) return;
    console.log("Initializing final instructor chart.");
    const ctx = document.getElementById('instructorFinalChartCanvas')?.getContext('2d');
    if (!ctx) {
        console.error("Final instructor chart canvas context not found.");
        return;
    }

    // Destroy existing chart instance if it exists
    if (finalInstructorChart) {
        console.log("Destroying previous final instructor chart instance.");
        finalInstructorChart.destroy();
        finalInstructorChart = null;
    }

    const labels = history.map(item => item.round);
    const data = history.map(item => item.avgContribution);

    finalInstructorChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels, // x-axis labels (Round numbers)
            datasets: [{
                label: 'Average Contribution',
                data: data, // y-axis data (Average contribution values)
                borderColor: 'rgb(54, 162, 235)', // Blue
                backgroundColor: 'rgba(54, 162, 235, 0.2)',
                tension: 0.1,
                fill: false
            }]
        },
        options: { // Same options as the main chart, or customize
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: 'Game Summary: Average Contribution per Round'
                },
                legend: {
                    display: false // Only one dataset, legend might be redundant
                }
            },
            scales: {
                x: {
                    title: { display: true, text: 'Round' },
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1,
                        callback: function(value, index, values) {
                            const round = this.getLabelForValue(value);
                            return Number.isInteger(round) ? round : '';
                        }
                    }
                },
                y: {
                    title: { display: true, text: 'Avg. Tokens Contributed' },
                    beginAtZero: true,
                    suggestedMax: gameConfig.endowment || 20
                }
            }
        }
    });
    console.log("Final instructor chart initialized.");
}


// --- Utility Functions ---
function showView(viewId) {
    // Hide all top-level views
    roleSelectionView.classList.add('hidden');
    instructorSetupView.classList.add('hidden');
    instructorGameView.classList.add('hidden');
    studentJoinView.classList.add('hidden');
    studentGameView.classList.add('hidden');
    gameOverView.classList.add('hidden');

    // Show the requested view
    const viewToShow = document.getElementById(viewId);
    if (viewToShow) {
        viewToShow.classList.remove('hidden');
    } else {
        console.error("View ID not found:", viewId);
        roleSelectionView.classList.remove('hidden'); // Default back to role selection on error
    }
}

function updateStudentList(students) {
    const listElement = document.getElementById('student-list');
    const countElement = document.getElementById('student-count');
    if (!listElement || !countElement) return; // Elements might not exist if view changed

    listElement.innerHTML = ''; // Clear current list
    if (students && students.length > 0) {
         students.forEach(student => {
            const li = document.createElement('li');
            li.className = 'flex justify-between items-center mb-1 p-1 hover:bg-gray-100';
            
            // Create student name span
            const nameSpan = document.createElement('span');
            nameSpan.textContent = student.name || `Anon_${student.id.substring(0,4)}`; // Display name or fallback
            
            // Create delete button (only visible in lobby state)
            const deleteBtn = document.createElement('button');
            deleteBtn.innerHTML = '&times;'; // × symbol
            deleteBtn.className = 'text-red-500 font-bold hover:text-red-700 ml-2 px-2 rounded focus:outline-none delete-participant-btn';
            deleteBtn.title = 'Remove participant';
            deleteBtn.dataset.participantId = student.id;
            
            // Add elements to list item
            li.appendChild(nameSpan);
            li.appendChild(deleteBtn);
            
            listElement.appendChild(li);
        });
        countElement.textContent = students.length;
    } else {
        listElement.innerHTML = '<li>No students connected yet.</li>';
        countElement.textContent = 0;
    }
}

function updateInstructorStatus(status) {
    const statusElement = document.getElementById('instructor-game-status');
    if (statusElement) {
        statusElement.textContent = `Status: ${status}`;
    }
}

// Helper to get readable status text
function getStageStatusText(stage) {
    switch (stage) {
        case 'contribution': return 'Waiting for contributions...';
        case 'punishment': return 'Waiting for punishments...';
        case 'feedback': return 'Round finished. Ready for next round.';
        default: return 'Processing...';
    }
}

// --- Socket.IO Event Handlers ---
function setupSocketListeners() {
    socket.on('connect', () => {
        console.log('Connected to server with ID:', socket.id);
        connectionStatus.textContent = 'Connected';
        connectionStatus.classList.remove('text-gray-500', 'text-red-500');
        connectionStatus.classList.add('text-green-500');
        playerId = socket.id; // Store own ID
        showView('role-selection'); // Show role selection on fresh connect/reconnect
    });
    
    socket.on('gameReset', () => {
        console.log('Game has been reset by instructor');
        // Reset client-side game state variables
        currentRound = 0;
        gameConfig = {};
        userRole = null; // This is set back when user re-registers
        
        // Destroy charts if they exist
        if (instructorChart) {
            instructorChart.destroy();
            instructorChart = null;
        }
        if (finalInstructorChart) {
            finalInstructorChart.destroy();
            finalInstructorChart = null;
        }
        
        // Return to initial view based on current role
        showView('role-selection');
        
        // Show notification to user
        alert('The instructor has reset the game. Please rejoin with your role.');
    });
    
    socket.on('gameResetConfirm', (message) => {
        if (userRole === 'instructor') {
            // Only show confirmation to instructor
            alert(message);
            showView('instructor-setup');
        }
    });
    
    socket.on('removedFromGame', (data) => {
        console.log('You have been removed from the game:', data.message);
        alert(data.message);
        // No need to do additional cleanup as the socket will be disconnected
    });
    
    socket.on('participantRemoved', (data) => {
        if (userRole === 'instructor') {
            console.log('Participant removed:', data.message);
            alert(data.message);
        }
    });

    socket.on('disconnect', (reason) => {
        console.log('Disconnected from server:', reason);
        connectionStatus.textContent = 'Disconnected - Please refresh';
        connectionStatus.classList.remove('text-green-500');
        connectionStatus.classList.add('text-red-500');
        showView('role-selection'); // Reset view on disconnect
        userRole = null; // Reset role
        // Destroy charts if they exist on disconnect
        if (instructorChart) instructorChart.destroy();
        if (finalInstructorChart) finalInstructorChart.destroy();
        instructorChart = null;
        finalInstructorChart = null;
    });

    socket.on('connect_error', (err) => {
         console.error('Connection failed:', err);
         connectionStatus.textContent = 'Connection Failed';
         connectionStatus.classList.remove('text-green-500');
         connectionStatus.classList.add('text-red-500');
    });

    socket.on('updatePlayerList', (students) => {
        console.log('Received updatePlayerList:', students);
        if (userRole === 'instructor') {
            updateStudentList(students);
        }
    });

    socket.on('gameStarted', (initialGameState) => {
        console.log('Received gameStarted:', initialGameState);
        gameConfig = initialGameState.config; // Store the config
        totalRounds = gameConfig.totalRounds;
        endowment = gameConfig.endowment;
        maxPunishmentPerTarget = gameConfig.maxPunishmentPerTarget;
        punishmentCost = gameConfig.punishmentCost;
        punishmentEffect = gameConfig.punishmentEffect;

        if (userRole === 'instructor') {
            showView('instructor-game');
            document.getElementById('instructor-total-rounds').textContent = totalRounds;
            initInstructorChart(); // <<< Initialize chart when game starts
            console.log("Instructor view activated for game start.");
        } else if (userRole === 'student') {
            showView('student-game');
            document.getElementById('student-total-rounds').textContent = totalRounds;
            document.getElementById('student-endowment').textContent = endowment;
            document.getElementById('student-max-contribution').textContent = endowment; // Update display
            const contributionInput = document.getElementById('contribution-amount');
            if (contributionInput) contributionInput.max = endowment; // Update input max
            console.log("Student view activated for game start.");
        }
    });

     socket.on('startRound', (roundState) => {
        console.log(`Received startRound (Role: ${userRole}):`, roundState);
        currentRound = roundState.currentRound;

        updateRoundDisplay(); // Update round number display

        isPunishmentActiveForRound = gameConfig.punishmentStartsRound > 0 && currentRound >= gameConfig.punishmentStartsRound;
        console.log(`Punishment active for this round (${currentRound}): ${isPunishmentActiveForRound}`);


        if (userRole === 'instructor') {
            console.log('Updating instructor UI for new round');
            updateInstructorStatus('Waiting for contributions...');
            enableInstructorButtons('contribution');
        } else { // Student
            if (document.getElementById('student-game').classList.contains('hidden')) {
                 showView('student-game');
            }
            const totalEarnedEl = document.getElementById('student-total-earned');
            if(totalEarnedEl) totalEarnedEl.textContent = (roundState.cumulativePayoff || 0).toFixed(2); // Show score
             document.getElementById('student-endowment').textContent = endowment;
             document.getElementById('student-max-contribution').textContent = endowment;
             const contributionInput = document.getElementById('contribution-amount');
             if (contributionInput) contributionInput.max = endowment;

            displayContributionStage();
        }
    });

    socket.on('stageUpdate', (data) => {
        if (userRole === 'instructor') {
            console.log('Instructor received stageUpdate:', data);
            updateInstructorStatus(getStageStatusText(data.stage));
            enableInstructorButtons(data.stage);
        }
    });

    socket.on('resultsUpdate', (history) => {
        if (userRole === 'instructor') {
            console.log('Instructor received resultsUpdate:', history);
            updateInstructorChart(history); // <<< Update chart with new history data
            const detailsContainer = document.getElementById('instructor-group-details');
             if(detailsContainer && history.length > 0) {
                 detailsContainer.textContent = `Round ${history[history.length-1].round} Average Contribution: ${history[history.length-1].avgContribution.toFixed(2)}`;
             }
        }
    });


    socket.on('startPunishmentStage', (punishmentData) => {
        console.log('Received startPunishmentStage:', punishmentData);
        if (userRole === 'student') {
             displayPunishmentStage(punishmentData);
        }
    });

    socket.on('showFeedback', (feedbackData) => {
        console.log('Received showFeedback:', feedbackData);
        if (userRole === 'student') {
            displayFeedbackStage(feedbackData);
            const totalEarnedEl = document.getElementById('student-total-earned');
             if(totalEarnedEl) totalEarnedEl.textContent = (feedbackData.cumulativePayoff || 0).toFixed(2);
        }
    });

    socket.on('gameOver', (finalData) => {
        console.log('Received gameOver:', finalData);
        if (userRole === 'student') {
            document.getElementById('final-score').textContent = (finalData.finalPayoff || 0).toFixed(2);
             showView('game-over');
        } else { // Instructor
            const finalResultsDiv = document.getElementById('instructor-final-results');
            if(finalResultsDiv) finalResultsDiv.classList.remove('hidden');
            initFinalInstructorChart(finalData.resultsHistory); // <<< Display final chart
            enableInstructorButtons('over'); // Disable buttons
             showView('game-over');
        }
    });

    socket.on('errorMsg', (message) => {
        console.error('Server Error Message:', message);
        alert(`Error: ${message}`);
    });
}

// --- Student UI Functions ---
function displayContributionStage() {
    if (userRole !== 'student') return;
    // console.log("Displaying contribution stage for student"); // Reduced verbosity

    if (document.getElementById('student-game').classList.contains('hidden')) {
        showView('student-game');
    }
    document.getElementById('contribution-stage').classList.remove('hidden');
    document.getElementById('punishment-stage').classList.add('hidden');
    document.getElementById('feedback-stage').classList.add('hidden');

    const amountInput = document.getElementById('contribution-amount');
    const submitBtn = document.getElementById('submit-contribution');
    const waitMsg = document.getElementById('contribution-wait');

    if (amountInput) { amountInput.value = ''; amountInput.disabled = false; }
    if (submitBtn) submitBtn.disabled = false;
    if (waitMsg) waitMsg.classList.add('hidden');
}

function displayPunishmentStage(data) {
    if (userRole !== 'student') return;
    console.log("Displaying punishment stage for student");

    document.getElementById('contribution-stage').classList.add('hidden');
    document.getElementById('punishment-stage').classList.remove('hidden');
    document.getElementById('feedback-stage').classList.add('hidden');

    const optionsContainer = document.getElementById('punishment-options');
    const submitBtn = document.getElementById('submit-punishment');
    const waitMsg = document.getElementById('punishment-wait');

    if (!optionsContainer || !submitBtn || !waitMsg) { console.error("Punishment stage elements not found!"); return; }
    optionsContainer.innerHTML = '';

    document.getElementById('round-earnings-pre-punish').textContent = (data.roundEarnings || 0).toFixed(2);
    document.getElementById('max-punish-per-target').textContent = data.maxPunishmentPerTarget ?? maxPunishmentPerTarget;
    // Display cost/effect directly in the text
    document.getElementById('punish-cost-display').textContent = data.punishmentCost ?? punishmentCost;
    document.getElementById('punish-effect-display').textContent = data.punishmentEffect ?? punishmentEffect;


    if (data.contributions) {
        data.contributions.forEach(player => {
            if (player.playerId !== playerId) {
                const div = document.createElement('div');
                div.className = 'flex flex-col sm:flex-row justify-between items-start sm:items-center bg-gray-50 p-2 rounded border';
                const infoSpan = document.createElement('span');
                infoSpan.className = 'mb-2 sm:mb-0 text-sm';
                const displayName = player.name || `Player ${player.role}`;
                infoSpan.innerHTML = `${displayName} contributed: <strong>${player.contribution}</strong> tokens`;
                const controlDiv = document.createElement('div');
                controlDiv.className = 'flex items-center space-x-2 w-full sm:w-auto justify-end';
                const label = document.createElement('label');
                label.htmlFor = `punish-${player.playerId}`;
                label.className = 'text-sm';
                label.textContent = 'Punish points:';
                const input = document.createElement('input');
                input.type = 'number';
                input.id = `punish-${player.playerId}`;
                input.dataset.targetid = player.playerId;
                input.min = 0;
                input.max = data.maxPunishmentPerTarget ?? maxPunishmentPerTarget;
                input.value = 0;
                input.className = 'w-20 px-2 py-1 border border-gray-300 rounded text-center';
                controlDiv.appendChild(label); controlDiv.appendChild(input);
                div.appendChild(infoSpan); div.appendChild(controlDiv);
                optionsContainer.appendChild(div);
            }
        });
    } else { optionsContainer.textContent = "Error: Could not load player contribution data."; }

    submitBtn.disabled = false;
    waitMsg.classList.add('hidden');
}

function displayFeedbackStage(data) {
    if (userRole !== 'student') return;
    // console.log("Displaying feedback stage for student"); // Reduced verbosity

    document.getElementById('contribution-stage').classList.add('hidden');
    document.getElementById('punishment-stage').classList.add('hidden');
    document.getElementById('feedback-stage').classList.remove('hidden');

    document.getElementById('feedback-your-contribution').textContent = data.yourContribution ?? 0;
    document.getElementById('feedback-group-contribution').textContent = data.groupContribution ?? 0;
    document.getElementById('feedback-tokens-kept').textContent = (data.tokensKept ?? 0).toFixed(2);
    document.getElementById('feedback-project-earnings').textContent = (data.projectEarnings ?? 0).toFixed(2);
    document.getElementById('feedback-pre-punish-earnings').textContent = (data.prePunishEarnings ?? 0).toFixed(2);

    const punishFeedbackDiv = document.getElementById('punishment-feedback');
    if (data.punishmentWasEnabled) {
        document.getElementById('feedback-punish-cost').textContent = (data.punishCost ?? 0).toFixed(2);
        document.getElementById('feedback-punish-received').textContent = (data.punishReceived ?? 0).toFixed(2);
        if (punishFeedbackDiv) punishFeedbackDiv.classList.remove('hidden');
    } else {
        if (punishFeedbackDiv) punishFeedbackDiv.classList.add('hidden');
    }
    document.getElementById('feedback-final-earnings').textContent = (data.finalEarnings ?? 0).toFixed(2);

    const waitMsg = document.getElementById('feedback-wait');
    if (waitMsg) waitMsg.classList.remove('hidden');
}

function updateRoundDisplay() {
     const studentRoundEl = document.getElementById('student-current-round');
     const instructorRoundEl = document.getElementById('instructor-current-round');
     if (studentRoundEl) studentRoundEl.textContent = currentRound;
     if (instructorRoundEl) instructorRoundEl.textContent = currentRound;
}


// --- Instructor UI Functions ---
function enableInstructorButtons(stage) {
    if (userRole !== 'instructor') return;
    // console.log(`Enabling instructor buttons for stage: ${stage}`); // Reduced verbosity
    const nextStageBtn = document.getElementById('next-stage-button'); // Kept for potential future use/manual override
    const nextRoundBtn = document.getElementById('next-round-button');
    if (!nextStageBtn || !nextRoundBtn) { console.error("Instructor control buttons not found!"); return; }

    nextStageBtn.disabled = true; // Keep disabled generally
    nextRoundBtn.disabled = true;
    nextStageBtn.classList.add('opacity-50', 'cursor-not-allowed');
    nextRoundBtn.classList.add('opacity-50', 'cursor-not-allowed');

    if (stage === 'feedback' && currentRound < totalRounds) {
        nextRoundBtn.disabled = false;
        nextRoundBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        // console.log('Enabling "Start Next Round" button'); // Reduced verbosity
    } else if (stage === 'over') {
        // console.log("Game over, keeping buttons disabled."); // Reduced verbosity
    }
    // console.log(`Button States: nextStage(disabled)=${nextStageBtn.disabled}, nextRound=${nextRoundBtn.disabled}`); // Reduced verbosity
}


// --- Event Listeners ---
function setupEventListeners() {
    document.getElementById('join-instructor').addEventListener('click', () => {
        userRole = 'instructor';
        showView('instructor-setup');
        if (socket && socket.connected) {
            socket.emit('register', { role: 'instructor' });
        } else { console.error("Cannot register instructor: Socket not connected"); alert("Error: Not connected to server. Please refresh."); }
    });
    
    // Add event listener for reset game button
    document.getElementById('reset-game-button').addEventListener('click', () => {
        if (confirm('Are you sure you want to reset the game? This will end the current game and return all players to the lobby.')) {
            console.log('Instructor requested game reset');
            if (socket && socket.connected) {
                socket.emit('instructorCommand', { command: 'resetGame' });
            } else {
                alert("Error: Not connected to server. Please refresh.");
            }
        }
    });
    
    // Add event delegation for student list delete buttons
    document.getElementById('student-list').addEventListener('click', (event) => {
        // Check if the clicked element is a delete button
        if (event.target.classList.contains('delete-participant-btn')) {
            const participantId = event.target.dataset.participantId;
            if (!participantId) return;
            
            if (confirm('Are you sure you want to remove this participant from the game?')) {
                console.log('Instructor requested participant removal:', participantId);
                if (socket && socket.connected) {
                    socket.emit('instructorCommand', { 
                        command: 'removeParticipant',
                        participantId: participantId
                    });
                } else {
                    alert("Error: Not connected to server. Please refresh.");
                }
            }
        }
    });
    document.getElementById('join-student').addEventListener('click', () => {
        userRole = 'student';
        showView('student-join');
    });
    document.getElementById('submit-student-name').addEventListener('click', () => {
        playerName = document.getElementById('student-name').value.trim();
        const nameInput = document.getElementById('student-name');
        const submitBtn = document.getElementById('submit-student-name');
        const waitMsg = document.getElementById('student-wait-message');
        if (playerName && nameInput && submitBtn && waitMsg) {
             if (socket && socket.connected) {
                socket.emit('register', { role: 'student', name: playerName });
                waitMsg.classList.remove('hidden'); submitBtn.disabled = true; nameInput.disabled = true;
            } else { console.error("Cannot register student: Socket not connected"); alert("Error: Not connected to server. Please refresh."); }
        } else if (!playerName) { alert('Please enter your name.'); }
    });
    document.getElementById('start-game').addEventListener('click', () => {
        const config = {
            endowment: parseInt(document.getElementById('endowment').value) || 20,
            mpcr: parseFloat(document.getElementById('mpcr').value) || 0.4,
            totalRounds: parseInt(document.getElementById('total-rounds').value) || 10,
            punishmentStartsRound: parseInt(document.getElementById('punishment-round').value) || 0,
            punishmentCost: parseFloat(document.getElementById('punishment-cost').value) || 1,
            punishmentEffect: parseFloat(document.getElementById('punishment-effect').value) || 3,
            maxPunishmentPerTarget: parseInt(document.getElementById('max-punishment').value) || 10,
        };
        if (config.totalRounds <= 0 || config.endowment < 0 || config.mpcr < 0 || config.punishmentStartsRound < 0 || config.punishmentCost < 0 || config.punishmentEffect < 0 || config.maxPunishmentPerTarget < 0) {
            alert("Invalid game settings. Please use non-negative values (and > 0 for rounds)."); return;
        }
        console.log('Requesting startGame with config:', config);
        if (socket && socket.connected) { socket.emit('instructorCommand', { command: 'startGame', config: config }); }
        else { alert("Error: Not connected to server."); }
    });
    const nextStageBtn = document.getElementById('next-stage-button');
     if (nextStageBtn) { nextStageBtn.addEventListener('click', () => { console.warn("Next Stage button clicked - generally not needed."); }); }
    const nextRoundBtn = document.getElementById('next-round-button');
    if (nextRoundBtn) {
        nextRoundBtn.addEventListener('click', () => {
            console.log("Instructor clicked Start Next Round");
            if (socket && socket.connected) {
                socket.emit('instructorCommand', { command: 'nextRound' });
                nextRoundBtn.disabled = true; nextRoundBtn.classList.add('opacity-50', 'cursor-not-allowed'); updateInstructorStatus('Starting next round...');
            } else { alert("Error: Not connected to server."); }
        });
    }
    document.getElementById('submit-contribution').addEventListener('click', () => {
        const amountInput = document.getElementById('contribution-amount');
        const submitBtn = document.getElementById('submit-contribution');
        const waitMsg = document.getElementById('contribution-wait');
        if (!amountInput || !submitBtn || !waitMsg) return;
        const amount = parseInt(amountInput.value);
        const maxAmount = parseInt(amountInput.max);
        if (!isNaN(amount) && amount >= 0 && amount <= maxAmount) {
            console.log(`Student submitting contribution: ${amount}`);
             if (socket && socket.connected) {
                socket.emit('submitContribution', { amount: amount });
                amountInput.disabled = true; submitBtn.disabled = true; waitMsg.classList.remove('hidden');
            } else { alert("Error: Not connected to server."); }
        } else { alert(`Please enter a valid contribution between 0 and ${maxAmount}.`); }
    });
    document.getElementById('submit-punishment').addEventListener('click', () => {
        const punishmentInputs = document.querySelectorAll('#punishment-options input[type=number]');
        const submitBtn = document.getElementById('submit-punishment');
        const waitMsg = document.getElementById('punishment-wait');
        if (!submitBtn || !waitMsg) return;
        const punishments = [];
        let totalPunishmentCost = 0;
        const earningsText = document.getElementById('round-earnings-pre-punish')?.textContent || '0';
        const currentEarnings = parseFloat(earningsText);
        let valid = true;
        punishmentInputs.forEach(input => {
            const targetId = input.dataset.targetid; const points = parseInt(input.value); const maxPoints = parseInt(input.max);
            if (isNaN(points) || points < 0 || points > maxPoints) { alert(`Invalid punishment points for player (ID: ${targetId}). Must be between 0 and ${maxPoints}.`); valid = false; return; }
            if (points > 0) { punishments.push({ targetId: targetId, points: points }); totalPunishmentCost += points * (gameConfig.punishmentCost || 1); }
        });
        if (!valid) return;
        if (totalPunishmentCost > currentEarnings + 0.001) { // Add small tolerance for float issues
             alert(`Total punishment cost (${totalPunishmentCost.toFixed(2)}) exceeds your earnings this round (${currentEarnings.toFixed(2)}). Please adjust.`); valid = false; return;
        }
        if (valid) {
            console.log('Submitting punishments:', punishments);
            if (socket && socket.connected) {
                socket.emit('submitPunishment', { punishments: punishments });
                punishmentInputs.forEach(input => input.disabled = true); submitBtn.disabled = true; waitMsg.classList.remove('hidden');
            } else { alert("Error: Not connected to server."); }
        }
    });
}

// --- Instruction Modal Handling ---
function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('hidden');
    }
}

function hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('hidden');
    }
}

function setupInstructionModals() {
    // Open instruction modals
    document.getElementById('show-general-instructions').addEventListener('click', () => {
        showModal('student-instructions-modal'); // Use student instructions for general info
    });
    
    document.getElementById('show-instructor-instructions').addEventListener('click', () => {
        showModal('instructor-instructions-modal');
    });
    
    document.getElementById('show-student-instructions').addEventListener('click', () => {
        showModal('student-instructions-modal');
    });
    
    document.getElementById('show-student-game-instructions').addEventListener('click', () => {
        showModal('student-instructions-modal');
    });
    
    // Close instruction modals
    document.getElementById('close-student-instructions').addEventListener('click', () => {
        hideModal('student-instructions-modal');
    });
    
    document.getElementById('close-instructor-instructions').addEventListener('click', () => {
        hideModal('instructor-instructions-modal');
    });
    
    // Close modals when clicking outside
    document.querySelectorAll('#student-instructions-modal, #instructor-instructions-modal').forEach(modal => {
        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                hideModal(modal.id);
            }
        });
    });
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    showView('role-selection');
    try {
        socket = io();
        console.log("Attempting to connect to Socket.IO server...");
        setupSocketListeners();
        setupEventListeners();
        setupInstructionModals(); // Setup instruction modal handlers
    } catch (error) {
        console.error("Failed to initialize Socket.IO:", error);
        connectionStatus.textContent = 'Error initializing connection';
        connectionStatus.classList.add('text-red-500');
    }
});