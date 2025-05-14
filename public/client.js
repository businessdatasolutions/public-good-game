// public/client.js

// --- Global Variables ---
let socket;
let userRole = null; // 'instructor' or 'student'
let playerName = null;
let playerId = null; // Socket ID
let currentGameId = null; // Current Game ID for this client session

let currentRound = 0;
let totalRounds = 10;
let endowment = 20;
let maxPunishmentPerTarget = 10;
let punishmentCost = 1;
let punishmentEffect = 3;
let gameConfig = {}; // Store received game config for current game
let isPunishmentActiveForRound = false;

let instructorChart = null;
let finalInstructorChart = null;
let qrcodeInstance = null; // For QR code object

// --- DOM Elements ---
const appContainer = document.getElementById('app-container');
const initialOptionsView = document.getElementById('initial-options');
const instructorSetupView = document.getElementById('instructor-setup');
const instructorGameView = document.getElementById('instructor-game');
const studentJoinView = document.getElementById('student-join');
const studentGameView = document.getElementById('student-game');
const gameOverView = document.getElementById('game-over');
const connectionStatus = document.getElementById('connection-status');

// --- Chart Functions ---
function initInstructorChart() {
    if (userRole !== 'instructor') return;
    const ctx = document.getElementById('instructorChartCanvas')?.getContext('2d');
    if (!ctx) { console.error("Instructor chart canvas context not found."); return; }
    if (instructorChart) { instructorChart.destroy(); instructorChart = null; }

    instructorChart = new Chart(ctx, {
        type: 'line',
        data: { labels: [], datasets: [{ label: 'Average Contribution', data: [], borderColor: 'rgb(75, 192, 192)', backgroundColor: 'rgba(75, 192, 192, 0.2)', tension: 0.1, fill: false }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: true, position: 'bottom' } },
            scales: {
                x: { title: { display: true, text: 'Round' }, beginAtZero: true, ticks: { stepSize: 1, callback: function(value) { const round = this.getLabelForValue(value); return Number.isInteger(Number(round)) ? round : ''; }}},
                y: { title: { display: true, text: 'Avg. Tokens Contributed' }, beginAtZero: true, suggestedMax: gameConfig.endowment || 20 }
            }
        }
    });
}
function updateInstructorChart(history) {
    if (userRole !== 'instructor' || !instructorChart || !Array.isArray(history)) return;
    instructorChart.data.labels = history.map(item => item.round);
    instructorChart.data.datasets[0].data = history.map(item => item.avgContribution);
    instructorChart.update();
}
function initFinalInstructorChart(history) {
    if (userRole !== 'instructor' || !Array.isArray(history)) return;
    const ctx = document.getElementById('instructorFinalChartCanvas')?.getContext('2d');
    if (!ctx) { console.error("Final instructor chart canvas context not found."); return; }
    if (finalInstructorChart) { finalInstructorChart.destroy(); finalInstructorChart = null; }

    finalInstructorChart = new Chart(ctx, {
        type: 'line',
        data: { labels: history.map(item => item.round), datasets: [{ label: 'Average Contribution', data: history.map(item => item.avgContribution), borderColor: 'rgb(54, 162, 235)', backgroundColor: 'rgba(54, 162, 235, 0.2)', tension: 0.1, fill: false }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { title: { display: true, text: 'Game Summary: Average Contribution per Round' }, legend: { display: false } },
            scales: {
                x: { title: { display: true, text: 'Round' }, beginAtZero: true, ticks: { stepSize: 1, callback: function(value) { const round = this.getLabelForValue(value); return Number.isInteger(Number(round)) ? round : ''; }}},
                y: { title: { display: true, text: 'Avg. Tokens Contributed' }, beginAtZero: true, suggestedMax: gameConfig.endowment || 20 }
            }
        }
    });
}

// --- Utility Functions ---
function showView(viewId) {
    [initialOptionsView, instructorSetupView, instructorGameView, studentJoinView, studentGameView, gameOverView].forEach(view => {
        if (view) view.classList.add('hidden');
    });
    const viewToShow = document.getElementById(viewId);
    if (viewToShow) {
        viewToShow.classList.remove('hidden');
    } else {
        console.error("View ID not found:", viewId);
        if(initialOptionsView) initialOptionsView.classList.remove('hidden');
    }
}

function getGameIdFromUrl() {
    const pathSegments = window.location.pathname.split('/');
    if (pathSegments.length >= 3 && pathSegments[1].toLowerCase() === 'game') {
        return pathSegments[2].toUpperCase();
    }
    return null;
}

function displayLobbyInfo(gameId) {
    if (userRole !== 'instructor') return;
    const gameUrl = `${window.location.origin}/game/${gameId}`;
    const gameUrlDisplay = document.getElementById('game-url-display');
    const gameIdDisplay = document.getElementById('game-id-display');
    const qrcodeContainer = document.getElementById('qrcode-container');

    if(gameUrlDisplay) gameUrlDisplay.value = gameUrl;
    if(gameIdDisplay) gameIdDisplay.textContent = gameId;
    
    if (qrcodeContainer) {
        qrcodeContainer.innerHTML = ''; // Clear previous QR code
        if (qrcodeInstance && typeof qrcodeInstance.clear === 'function') {
             qrcodeInstance.clear(); // If qrcode.js instance stored
        }


        qrcodeInstance = new QRCode(qrcodeContainer, {
            text: gameUrl,
            width: 150,
            height: 150,
            colorDark : "#000000",
            colorLight : "#ffffff",
            correctLevel : QRCode.CorrectLevel.H
        });
    }
    document.getElementById('game-lobby-info')?.classList.remove('hidden');
}


function updateStudentList(students) {
    const listElement = document.getElementById('student-list');
    const countElement = document.getElementById('student-count');
    if (!listElement || !countElement) return;

    listElement.innerHTML = '';
    if (students && students.length > 0) {
         students.forEach(student => {
            const li = document.createElement('li');
            li.className = 'flex justify-between items-center mb-1 p-1 hover:bg-gray-100 text-sm';
            const nameSpan = document.createElement('span');
            nameSpan.textContent = student.name || `Anon_${student.id.substring(0,4)}`;
            
            const deleteBtn = document.createElement('button');
            deleteBtn.innerHTML = '×';
            deleteBtn.className = 'text-red-500 font-bold hover:text-red-700 ml-2 px-1 rounded focus:outline-none delete-participant-btn text-xs';
            deleteBtn.title = 'Remove participant';
            deleteBtn.dataset.participantId = student.id;
            
            if (gameConfig && gameConfig.status && gameConfig.status !== 'lobby') {
                deleteBtn.classList.add('hidden');
            }
            
            li.appendChild(nameSpan);
            li.appendChild(deleteBtn);
            listElement.appendChild(li);
        });
        countElement.textContent = students.length;
    } else {
        listElement.innerHTML = '<li class="text-sm text-gray-500">No students connected yet.</li>';
        countElement.textContent = 0;
    }
}

function updateInstructorStatus(status) {
    const statusElement = document.getElementById('instructor-game-status');
    if (statusElement) statusElement.textContent = status;
}
function getStageStatusText(stage) {
    switch (stage) {
        case 'contribution': return 'Waiting for contributions...';
        case 'punishment': return 'Waiting for punishments...';
        case 'feedback': return 'Round finished. Ready for next round.';
        default: return 'Processing...';
    }
}

function resetClientStateForNewGame() {
    userRole = null;
    playerName = null;
    currentRound = 0;
    gameConfig = {};
    isPunishmentActiveForRound = false;
    if (instructorChart) { instructorChart.destroy(); instructorChart = null; }
    if (finalInstructorChart) { finalInstructorChart.destroy(); finalInstructorChart = null; }
    const qrcodeContainer = document.getElementById('qrcode-container');
    if (qrcodeInstance && typeof qrcodeInstance.clear === 'function') {
        qrcodeInstance.clear(); 
        qrcodeInstance = null; 
    }
    if(qrcodeContainer) qrcodeContainer.innerHTML = '';
    
    document.getElementById('student-list').innerHTML = '';
    document.getElementById('student-count').textContent = '0';
    const endowmentInput = document.getElementById('endowment');
    if(endowmentInput) endowmentInput.value = "20";
    const mpcrInput = document.getElementById('mpcr');
    if(mpcrInput) mpcrInput.value = "0.4";
    const totalRoundsInput = document.getElementById('total-rounds');
    if(totalRoundsInput) totalRoundsInput.value = "10";
    const punishmentRoundInput = document.getElementById('punishment-round');
    if(punishmentRoundInput) punishmentRoundInput.value = "0";


    console.log("Client state reset for new game/lobby.");
}


// --- Socket.IO Event Handlers ---
function setupSocketListeners() {
    socket.on('connect', () => {
        playerId = socket.id;
        console.log('Connected to server with ID:', playerId);
        connectionStatus.textContent = 'Connected';
        connectionStatus.classList.remove('text-gray-500', 'text-red-500');
        connectionStatus.classList.add('text-green-500');

        const urlGameId = getGameIdFromUrl();

        if (currentGameId && userRole) { // A game session was active on this client
            console.log(`Re-registering for game ${currentGameId} as ${userRole}`);
            socket.emit('register', {
                role: userRole,
                name: playerName,
                gameId: currentGameId,
                isReconnection: true
            });
        } else if (urlGameId) {
            // User landed directly on a game page (e.g. /game/XYZ12)
            currentGameId = urlGameId;
            if(document.getElementById('joining-game-id-display')) document.getElementById('joining-game-id-display').textContent = currentGameId;
            showView('student-join'); // Prompt for name, then register
        } else {
            // Fresh connection or returned to root URL
            resetClientStateForNewGame();
            currentGameId = null; // Explicitly nullify if at root
            showView('initial-options');
        }
    });

    socket.on('disconnect', (reason) => {
        console.log('Disconnected from server:', reason);
        connectionStatus.textContent = 'Disconnected - Attempting to reconnect...';
        connectionStatus.classList.remove('text-green-500');
        connectionStatus.classList.add('text-red-500');
    });
    
    socket.on('connect_error', (err) => {
         console.error('Connection failed:', err);
         connectionStatus.textContent = 'Connection Failed - Please refresh';
         connectionStatus.classList.remove('text-green-500');
         connectionStatus.classList.add('text-red-500');
    });

    // client.js
    socket.on('gameCreated', (data) => { // For Instructor
        console.log('[CLIENT] Received gameCreated event:', data); // <<<< ADD THIS
        console.log('[CLIENT] userRole at gameCreated:', userRole); // <<<< ADD THIS

        if (userRole !== 'instructor') {
            console.warn('[CLIENT] gameCreated event ignored because userRole is not "instructor". Current role:', userRole);
            return;
        }
        currentGameId = data.gameId;
        console.log(`[CLIENT] Game created by instructor. Game ID: ${currentGameId}`); 
        
        history.pushState({ gameId: currentGameId }, `Game ${currentGameId}`, `/game/${currentGameId}`);
        
        showView('instructor-setup'); 
        displayLobbyInfo(currentGameId); 
        updateStudentList([]); 
    });
    
    socket.on('joinedGame', (data) => {
        if(userRole !== 'student') return;
        if (currentGameId !== data.gameId) {
            console.warn(`Joined game ${data.gameId} but current client gameId is ${currentGameId}. Updating.`);
            currentGameId = data.gameId; // Align client with server
        }
        gameConfig = data.gameConfig || {};
        console.log(`Successfully joined game ${currentGameId}. Current status: ${gameConfig.status}`);
        
        const studentWaitMsg = document.getElementById('student-wait-message');
        const studentNameInput = document.getElementById('student-name');
        const submitStudentNameBtn = document.getElementById('submit-student-name');

        if (gameConfig.status === 'lobby') {
            if(studentWaitMsg) studentWaitMsg.classList.remove('hidden');
            if(studentNameInput) studentNameInput.disabled = true;
            if(submitStudentNameBtn) submitStudentNameBtn.disabled = true;
            showView('student-join');
        } else if (gameConfig.status === 'running') {
            console.log("Joining a game already in progress.");
        }
    });

    socket.on('updatePlayerList', (students) => {
        console.log('Received updatePlayerList:', students);
        if (userRole === 'instructor' && currentGameId) {
            updateStudentList(students);
        }
    });

    socket.on('gameStarted', (initialGameState) => {
        if (!currentGameId || currentGameId !== initialGameState.gameId) {
            console.warn("Received gameStarted for a different/unknown game. Ignoring.");
            return;
        }
        gameConfig = initialGameState.config;
        totalRounds = gameConfig.totalRounds;
        endowment = gameConfig.endowment;
        maxPunishmentPerTarget = gameConfig.maxPunishmentPerTarget;
        punishmentCost = gameConfig.punishmentCost;
        punishmentEffect = gameConfig.punishmentEffect;
        gameConfig.status = 'running';

        if (userRole === 'instructor') {
            document.getElementById('instructor-game-id').textContent = currentGameId;
            showView('instructor-game');
            document.getElementById('instructor-total-rounds').textContent = totalRounds;
            initInstructorChart();
        } else if (userRole === 'student') {
            showView('student-game');
            document.getElementById('student-game-id-display').textContent = currentGameId;
            document.getElementById('student-total-rounds').textContent = totalRounds;
            document.getElementById('student-endowment').textContent = endowment;
            document.getElementById('student-max-contribution').textContent = endowment;
            const contributionInput = document.getElementById('contribution-amount');
            if (contributionInput) contributionInput.max = endowment;
            document.getElementById('student-total-earned').textContent = '0';
        }
    });

     socket.on('startRound', (roundState) => {
        if (!currentGameId || currentGameId !== roundState.gameId) return;
        console.log(`Received startRound (Role: ${userRole}, Game: ${roundState.gameId}):`, roundState);
        currentRound = roundState.currentRound;
        updateRoundDisplay();
        isPunishmentActiveForRound = gameConfig.punishmentStartsRound > 0 && currentRound >= gameConfig.punishmentStartsRound;

        if (userRole === 'instructor') {
            updateInstructorStatus(getStageStatusText(roundState.stage));
            enableInstructorButtons(roundState.stage);
        } else {
            if (document.getElementById('student-game').classList.contains('hidden')) {
                 showView('student-game');
            }
            const totalEarnedEl = document.getElementById('student-total-earned');
            if(totalEarnedEl) totalEarnedEl.textContent = (roundState.cumulativePayoff || 0).toFixed(2);
             document.getElementById('student-endowment').textContent = endowment;
             document.getElementById('student-max-contribution').textContent = endowment;
             const contributionInput = document.getElementById('contribution-amount');
             if (contributionInput) { contributionInput.value = ''; contributionInput.max = endowment; }
            displayContributionStage();
        }
    });

    socket.on('stageUpdate', (data) => {
        if (!currentGameId || currentGameId !== data.gameId) return;
        if (userRole === 'instructor') {
            updateInstructorStatus(getStageStatusText(data.stage));
            enableInstructorButtons(data.stage);
        }
    });

    socket.on('resultsUpdate', (data) => {
        if (!currentGameId || currentGameId !== data.gameId) return;
        if (userRole === 'instructor') {
            updateInstructorChart(data.history);
            const detailsContainer = document.getElementById('instructor-group-details');
             if(detailsContainer && data.history.length > 0) {
                 detailsContainer.textContent = `Round ${data.history[data.history.length-1].round} Avg Contribution: ${data.history[data.history.length-1].avgContribution.toFixed(2)}`;
             }
        }
    });

    socket.on('startPunishmentStage', (punishmentData) => {
        if (!currentGameId || currentGameId !== punishmentData.gameId) return;
        if (userRole === 'student') {
             displayPunishmentStage(punishmentData);
        }
    });

    socket.on('showFeedback', (feedbackData) => {
        if (!currentGameId || currentGameId !== feedbackData.gameId) return;
        if (userRole === 'student') {
            displayFeedbackStage(feedbackData);
            const totalEarnedEl = document.getElementById('student-total-earned');
             if(totalEarnedEl) totalEarnedEl.textContent = (feedbackData.cumulativePayoff || 0).toFixed(2);
        }
    });

    socket.on('gameOver', (finalData) => {
        if (!currentGameId || currentGameId !== finalData.gameId) return;
        console.log('Received gameOver:', finalData);
        gameConfig.status = 'over';
        
        document.getElementById('game-over-game-id').textContent = currentGameId;

        if (userRole === 'student') {
            document.getElementById('final-score').textContent = (finalData.finalPayoff || 0).toFixed(2);
            document.getElementById('student-return-to-main-button').classList.remove('hidden');
            document.getElementById('instructor-final-results').classList.add('hidden');
            showView('game-over');
        } else { 
            const finalResultsDiv = document.getElementById('instructor-final-results');
            if(finalResultsDiv) finalResultsDiv.classList.remove('hidden');
            document.getElementById('student-return-to-main-button').classList.add('hidden');
            initFinalInstructorChart(finalData.resultsHistory);
            enableInstructorButtons('over');
            showView('game-over');
        }
    });
    
    socket.on('gameReset', (data) => {
        if (!currentGameId || currentGameId !== data.gameId) return;
        console.log(`Game ${data.gameId} has been reset by instructor.`);
        alert(`The game (ID: ${data.gameId}) has been reset by the instructor.`);
        
        currentRound = 0;
        gameConfig = data.newGameConfig || {};
        if (userRole === 'instructor') {
            showView('instructor-setup');
            if (instructorChart) { instructorChart.destroy(); instructorChart = null; }
            if (finalInstructorChart) { finalInstructorChart.destroy(); finalInstructorChart = null; }
            // Student list updated separately
        } else if (userRole === 'student') {
            const studentWaitMsg = document.getElementById('student-wait-message');
            if(studentWaitMsg) studentWaitMsg.classList.remove('hidden');
            showView('student-join');
        }
    });

    socket.on('removedFromGame', (data) => {
        alert(data.message);
        window.location.href = '/';
    });
    
    socket.on('participantRemoved', (data) => {
        if (userRole === 'instructor') {
            alert(data.message);
        }
    });
    
    socket.on('gameClosed', (data) => {
        alert(data.message || "The game session has been closed.");
        window.location.href = '/';
    });

    socket.on('errorMsg', (message) => {
        console.error('Server Error Message:', message);
        alert(`Error: ${message}`);
    });
}

// --- Student UI Functions ---
function displayContributionStage() {
    if (userRole !== 'student') return;
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
    document.getElementById('punish-cost-display').textContent = data.punishmentCost ?? punishmentCost;
    document.getElementById('punish-effect-display').textContent = data.punishmentEffect ?? punishmentEffect;

    if (data.contributions) {
        data.contributions.forEach(player => {
            if (player.playerId !== playerId) {
                const div = document.createElement('div');
                div.className = 'flex flex-col sm:flex-row justify-between items-start sm:items-center bg-gray-50 p-2 rounded border';
                const infoSpan = document.createElement('span');
                infoSpan.className = 'mb-2 sm:mb-0 text-sm';
                const displayName = player.name || `Player ${player.playerId.substring(0,4)}`; 
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
    const nextRoundBtn = document.getElementById('next-round-button');
    if (!nextRoundBtn) { console.error("Instructor control buttons not found!"); return; }

    nextRoundBtn.disabled = true;
    nextRoundBtn.classList.add('opacity-50', 'cursor-not-allowed');

    if (stage === 'feedback' && currentRound < totalRounds) {
        nextRoundBtn.disabled = false;
        nextRoundBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
}

// --- Instruction Modal Handling (defined at top level now) ---
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
    document.getElementById('show-general-instructions-initial')?.addEventListener('click', () => showModal('student-instructions-modal'));
    document.getElementById('show-instructor-instructions')?.addEventListener('click', () => showModal('instructor-instructions-modal'));
    document.getElementById('show-student-instructions')?.addEventListener('click', () => showModal('student-instructions-modal'));
    document.getElementById('show-student-game-instructions')?.addEventListener('click', () => showModal('student-instructions-modal'));
    document.getElementById('close-student-instructions')?.addEventListener('click', () => hideModal('student-instructions-modal'));
    document.getElementById('close-instructor-instructions')?.addEventListener('click', () => hideModal('instructor-instructions-modal'));
    document.querySelectorAll('#student-instructions-modal, #instructor-instructions-modal').forEach(modal => {
        modal.addEventListener('click', (event) => { if (event.target === modal) hideModal(modal.id); });
    });
}

// --- Event Listeners ---
function setupEventListeners() {
    // client.js
    document.getElementById('host-new-game').addEventListener('click', () => {
        // 1. Reset general client state from any previous game.
        resetClientStateForNewGame(); // This function already sets userRole = null

        // 2. Set the role and name for the current "Host New Game" action.
        // This ensures that when 'gameCreated' comes back, userRole is 'instructor'.
        userRole = 'instructor';
        playerName = 'Instructor'; 

        // 3. Emit the request.
        if (socket && socket.connected) {
            // 'role' in the payload is for the server to know what kind of entity is creating the game.
            socket.emit('createGameRequest', { role: 'instructor' }); 
        } else { 
            alert("Error: Not connected to server. Please refresh."); 
        }
    });

    document.getElementById('join-by-id').addEventListener('click', () => {
        const gameIdInput = document.getElementById('game-id-input');
        const enteredId = gameIdInput.value.trim().toUpperCase();
        if (enteredId) {
            // Don't set currentGameId here yet, let the URL navigation and connect handler do it.
            window.location.href = `/game/${enteredId}`;
        } else {
            alert('Please enter a Game ID.');
        }
    });
    
    document.getElementById('submit-student-name').addEventListener('click', () => {
        playerName = document.getElementById('student-name').value.trim();
        if (!playerName) { alert('Please enter your name.'); return; }
        if (!currentGameId) { // Should be set if on /game/GAMEID URL
            alert('Error: No Game ID active. Please join via URL or Game ID entry.'); 
            window.location.href = '/'; // Redirect to main if no gameId context
            return; 
        }

        if (socket && socket.connected) {
            userRole = 'student';
            socket.emit('register', { 
                role: 'student', 
                name: playerName, 
                gameId: currentGameId 
            });
        } else { alert("Error: Not connected to server. Please refresh."); }
    });

    document.getElementById('start-game').addEventListener('click', () => {
        if(userRole !== 'instructor' || !currentGameId) return;
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
        if (socket && socket.connected) { 
            socket.emit('instructorCommand', { command: 'startGame', config: config, gameId: currentGameId }); 
        } else { alert("Error: Not connected to server."); }
    });

    document.getElementById('next-round-button').addEventListener('click', () => {
        if(userRole !== 'instructor' || !currentGameId) return;
        if (socket && socket.connected) {
            socket.emit('instructorCommand', { command: 'nextRound', gameId: currentGameId });
            const nextRoundBtn = document.getElementById('next-round-button');
            if(nextRoundBtn) { nextRoundBtn.disabled = true; nextRoundBtn.classList.add('opacity-50', 'cursor-not-allowed');}
            updateInstructorStatus('Starting next round...');
        } else { alert("Error: Not connected to server."); }
    });
    
    document.getElementById('reset-game-button').addEventListener('click', () => {
        if(userRole !== 'instructor' || !currentGameId) return;
        if (confirm('Are you sure you want to reset this game? This will end the current game and return all players in THIS GAME to the lobby state.')) {
            if (socket && socket.connected) {
                socket.emit('instructorCommand', { command: 'resetGame', gameId: currentGameId });
            } else { alert("Error: Not connected to server. Please refresh."); }
        }
    });
    
    document.getElementById('student-list').addEventListener('click', (event) => {
        if(userRole !== 'instructor' || !currentGameId) return;
        if (event.target.classList.contains('delete-participant-btn')) {
            const participantId = event.target.dataset.participantId;
            if (!participantId) return;
            if (gameConfig.status && gameConfig.status !== 'lobby') {
                alert("Cannot remove participants once the game has started.");
                return;
            }
            if (confirm('Are you sure you want to remove this participant from the game?')) {
                if (socket && socket.connected) {
                    socket.emit('instructorCommand', { 
                        command: 'removeParticipant',
                        participantId: participantId,
                        gameId: currentGameId 
                    });
                } else { alert("Error: Not connected to server. Please refresh."); }
            }
        }
    });
    
    document.getElementById('return-to-lobby-button').addEventListener('click', () => {
        window.location.href = '/'; 
    });
    document.getElementById('student-return-to-main-button').addEventListener('click', () => {
        window.location.href = '/';
    });

    document.getElementById('submit-contribution').addEventListener('click', () => {
        const amountInput = document.getElementById('contribution-amount');
        const submitBtn = document.getElementById('submit-contribution');
        const waitMsg = document.getElementById('contribution-wait');
        if (!amountInput || !submitBtn || !waitMsg) return;
        const amount = parseInt(amountInput.value);
        const maxAmount = parseInt(amountInput.max);
        if (!isNaN(amount) && amount >= 0 && amount <= maxAmount) {
             if (socket && socket.connected && currentGameId) {
                socket.emit('submitContribution', { amount: amount, gameId: currentGameId });
                amountInput.disabled = true; submitBtn.disabled = true; waitMsg.classList.remove('hidden');
            } else { alert("Error: Not connected to server or no game active."); }
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
            const targetId = input.dataset.targetid; const points = parseInt(input.value); 
            const maxPoints = parseInt(input.max);
            if (isNaN(points) || points < 0 || points > maxPoints) { alert(`Invalid punishment points for player. Must be between 0 and ${maxPoints}.`); valid = false; return; }
            if (points > 0) { punishments.push({ targetId: targetId, points: points }); totalPunishmentCost += points * (gameConfig.punishmentCost || 1); }
        });
        if (!valid) return;
        if (totalPunishmentCost > currentEarnings + 0.001) { 
             alert(`Total punishment cost (${totalPunishmentCost.toFixed(2)}) exceeds your earnings this round (${currentEarnings.toFixed(2)}). Please adjust.`); valid = false; return;
        }
        if (valid) {
            if (socket && socket.connected && currentGameId) {
                socket.emit('submitPunishment', { punishments: punishments, gameId: currentGameId });
                punishmentInputs.forEach(input => input.disabled = true); submitBtn.disabled = true; waitMsg.classList.remove('hidden');
            } else { alert("Error: Not connected to server or no game active."); }
        }
    });
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // currentGameId will be set by getGameIdFromUrl() if on a game page,
    // or will remain null if on the root page.
    // The socket 'connect' handler will use this information.
    
    try {
        socket = io({
            reconnectionAttempts: 5,
            reconnectionDelay: 1000,
        });
        console.log("Attempting to connect to Socket.IO server...");
        setupSocketListeners(); 
        setupEventListeners();
        setupInstructionModals(); // Now correctly defined globally
    } catch (error) {
        console.error("Failed to initialize Socket.IO:", error);
        connectionStatus.textContent = 'Error initializing connection';
        connectionStatus.classList.add('text-red-500');
    }
});