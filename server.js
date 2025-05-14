// server.js
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const GROUP_SIZE = 4; // Fixed group size

// --- Game State ---
let initialGameState = {
    status: 'lobby', // lobby, running, over
    config: {},
    currentRound: 0,
    currentStage: '', // contribution, punishment, feedback
    players: {}, // { socketId: { id, name, role, groupIndex, roleInGroup, cumulativePayoff, roundData: { contribution, punishmentsGiven, punishmentReceived, roundPayoff, tokensKept, projectEarnings, prePunishEarnings, punishmentCost } } }
    groups: [], // [ { id, members: [socketId,...], roundData: { totalContribution, punishments: {} } } ]
    resultsHistory: [], // [{ round, avgContribution, groupContributions: [...] }]
    instructorSocketId: null
};

let gameState = {...initialGameState};
// --------------------

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Helper Functions ---
function getPlayerGroup(playerId) {
    const player = gameState.players[playerId];
    if (player && player.groupIndex !== undefined && gameState.groups[player.groupIndex]) {
        return gameState.groups[player.groupIndex];
    }
    console.warn(`Could not find group for player ${playerId} with groupIndex ${player?.groupIndex}`);
    return null;
}

function getOtherGroupMembers(playerId) {
    const player = gameState.players[playerId];
    const group = getPlayerGroup(playerId);
    if (!player || !group) return [];
    return group.members
        .filter(memberId => memberId !== playerId)
        .map(memberId => gameState.players[memberId])
        .filter(p => p); // Filter out potentially undefined players if state is inconsistent
}

function checkAllSubmitted(stage) {
    if (!gameState.groups || gameState.groups.length === 0) {
        console.log("checkAllSubmitted: No groups exist.");
        return false;
    }

    const needsPunishmentCheck = stage === 'punishment' && isPunishmentActive();

    for (const group of gameState.groups) {
        for (const memberId of group.members) {
            const player = gameState.players[memberId];
            if (!player) {
                console.warn(`checkAllSubmitted: Player ${memberId} not found in group ${group.id}`);
                continue; // Skip if player somehow missing
            }
            if(player.role !== 'student') continue; // Only check students

            if (stage === 'contribution' && player.roundData.contribution === null) {
                 console.log(`checkAllSubmitted: Player ${player.name} (${player.id}) contribution pending.`);
                return false;
            }
            if (needsPunishmentCheck && player.roundData.punishmentsGiven === null) {
                 console.log(`checkAllSubmitted: Player ${player.name} (${player.id}) punishment pending.`);
                 return false;
            }
        }
    }
    console.log(`checkAllSubmitted for stage '${stage}': All submitted.`);
    return true; // All relevant players submitted
}


function isPunishmentActive() {
    const config = gameState.config;
    if (!config || config.punishmentStartsRound === undefined) return false;
    return config.punishmentStartsRound > 0 && gameState.currentRound >= config.punishmentStartsRound;
}

function calculateRoundPayoffs() {
    console.log("Calculating payoffs for round", gameState.currentRound);
    const config = gameState.config;
    if (!config || !config.endowment || !config.mpcr) {
        console.error("Cannot calculate payoffs: Game config missing.");
        return;
    }
    const punishmentActive = isPunishmentActive();

    gameState.groups.forEach((group, groupIndex) => {
        // 1. Calculate total contribution for the group
        group.roundData = group.roundData || {}; // Ensure roundData exists
        group.roundData.totalContribution = group.members.reduce((sum, memberId) => {
            const player = gameState.players[memberId];
            return sum + (player?.roundData?.contribution ?? 0);
        }, 0);
        console.log(`Group ${groupIndex} total contribution: ${group.roundData.totalContribution}`);

        // Reset punishment received counts before recalculating
         group.members.forEach(memberId => {
            if (gameState.players[memberId] && gameState.players[memberId].roundData) {
                 gameState.players[memberId].roundData.punishmentReceived = 0;
            }
         });

         // 2. Calculate punishments received (if applicable)
        if (punishmentActive && gameState.currentStage === 'feedback') { // Calculate only *after* punishments submitted
            console.log(`Calculating punishment effects for Group ${groupIndex}`);
            group.members.forEach(punisherId => {
                const punisher = gameState.players[punisherId];
                 if (punisher?.roundData?.punishmentsGiven) {
                    punisher.roundData.punishmentsGiven.forEach(punishment => {
                        const targetPlayer = gameState.players[punishment.targetId];
                        if (targetPlayer && targetPlayer.groupIndex === group.id) { // Ensure target is in the same group
                            const punishmentAmount = (punishment.points * config.punishmentEffect);
                            targetPlayer.roundData.punishmentReceived += punishmentAmount;
                             console.log(`Player ${targetPlayer.name} received ${punishmentAmount} punishment from ${punisher.name}`);
                         }
                    });
                 }
            });
        }
    });

     // 3. Calculate individual payoffs
    Object.values(gameState.players).forEach(player => {
        if (player.role !== 'student' || !player.roundData) return;
        const group = getPlayerGroup(player.id);
        if (!group || !group.roundData) return;

        const contribution = player.roundData.contribution ?? 0;
        const tokensKept = config.endowment - contribution;
        const projectEarnings = group.roundData.totalContribution * config.mpcr;
        const prePunishEarnings = tokensKept + projectEarnings;

        let punishmentCost = 0;
        if (punishmentActive && player.roundData.punishmentsGiven) {
             punishmentCost = player.roundData.punishmentsGiven.reduce((sum, p) => sum + (p.points * config.punishmentCost), 0);
        }

        let punishmentReceived = player.roundData.punishmentReceived || 0;

        // Apply punishment cap based on pre-punish earnings
         punishmentReceived = Math.min(punishmentReceived, prePunishEarnings);

        player.roundData.roundPayoff = prePunishEarnings - punishmentReceived - punishmentCost;
        player.roundData.tokensKept = tokensKept;
        player.roundData.projectEarnings = projectEarnings;
        player.roundData.prePunishEarnings = prePunishEarnings;
        player.roundData.punishmentCost = punishmentCost; // Store for feedback
        // punishmentReceived already updated on player.roundData

        player.cumulativePayoff = (player.cumulativePayoff || 0) + player.roundData.roundPayoff;
        console.log(`Payoff calculated for ${player.name}: Kept=${tokensKept}, Proj=${projectEarnings.toFixed(2)}, PrePun=${prePunishEarnings.toFixed(2)}, PunCost=${punishmentCost}, PunRcv=${punishmentReceived}, Final=${player.roundData.roundPayoff.toFixed(2)}, Cumul=${player.cumulativePayoff.toFixed(2)}`);
    });
}

function resetPlayerRoundData() {
     console.log("Resetting player round data");
     Object.values(gameState.players).forEach(player => {
        if (player.role === 'student') {
            player.roundData = {
                contribution: null,
                punishmentsGiven: null, // Store array [{ targetId, points }]
                punishmentReceived: 0, // Calculated effect
                roundPayoff: 0,
                tokensKept: 0,
                projectEarnings: 0,
                prePunishEarnings: 0,
                punishmentCost: 0
            };
        }
     });
     gameState.groups.forEach(group => {
         group.roundData = { totalContribution: 0 };
     });
 }


function startGame(config) {
    console.log("Attempting to start game...");
    const playersList = Object.values(gameState.players);
    const students = playersList.filter(p => p.role === 'student');

    if (students.length < GROUP_SIZE) {
        console.warn(`Start game failed: Need at least ${GROUP_SIZE} students.`);
        if(gameState.instructorSocketId) io.to(gameState.instructorSocketId).emit('errorMsg', `Need at least ${GROUP_SIZE} students to start (currently ${students.length}).`);
        return;
    }
    // Allow non-multiples for now, but it will break things. Add check back if needed.
    // if (students.length % GROUP_SIZE !== 0) {
    //     io.to(gameState.instructorSocketId).emit('errorMsg', `Number of students (${students.length}) must be a multiple of ${GROUP_SIZE}.`);
    //     return;
    // }

    // Shuffle students
    for (let i = students.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [students[i], students[j]] = [students[j], students[i]];
    }

    // Assign groups
    gameState.groups = [];
    for (let i = 0; i < students.length; i += GROUP_SIZE) {
        const groupMembers = students.slice(i, i + GROUP_SIZE).map(p => p.id);
        if (groupMembers.length < GROUP_SIZE && i + GROUP_SIZE >= students.length) {
            console.warn(`Warning: Last group has only ${groupMembers.length} members. Game might not work correctly.`);
            // Decide how to handle incomplete groups - skip for now? Or error?
             if(gameState.instructorSocketId) io.to(gameState.instructorSocketId).emit('errorMsg', `Could not form complete groups. Last group only has ${groupMembers.length}. Student count must be multiple of ${GROUP_SIZE}.`);
             return; // Prevent starting with incomplete group
        }
        const group = { id: gameState.groups.length, members: groupMembers, roundData: {} };
        gameState.groups.push(group);
        groupMembers.forEach((playerId, index) => {
            if (gameState.players[playerId]) {
                gameState.players[playerId].groupIndex = group.id;
                gameState.players[playerId].roleInGroup = index + 1; // Assign role 1, 2, 3, 4 within group
                gameState.players[playerId].cumulativePayoff = 0; // Initialize score
            } else {
                console.error(`Error assigning group: Player ${playerId} not found in gameState.players`);
            }
        });
    }

    gameState.config = config;
    gameState.currentRound = 0; // Will be incremented by startNextRound
    gameState.status = 'running';
    gameState.resultsHistory = []; // Clear history

    console.log("Game starting with config:", config);
    console.log("Groups:", gameState.groups.map(g => ({ id: g.id, members: g.members.map(m => gameState.players[m]?.name) })));


    // Notify all players game has started
    Object.values(gameState.players).forEach(player => {
        if (!player || !player.id) return;
        const group = getPlayerGroup(player.id);
        io.to(player.id).emit('gameStarted', {
            config: gameState.config,
            currentRound: gameState.currentRound + 1, // Will be 1 initially
            totalRounds: config.totalRounds,
            groupInfo: group ? { // Check if player is in a group
                groupIndex: player.groupIndex,
                roleInGroup: player.roleInGroup,
                members: getOtherGroupMembers(player.id).map(m => ({ id: m.id, name: m.name, roleInGroup: m.roleInGroup })) // Send info about others
            } : null // Send null if not assigned (shouldn't happen for students in valid start)
        });
    });

    startNextRound(); // Start the first round
}

function startNextRound() {
    if (gameState.status !== 'running') return; // Don't start if not running

    if (gameState.currentRound >= gameState.config.totalRounds) {
        gameOver();
        return;
    }
    gameState.currentRound++;
    gameState.currentStage = 'contribution';
    resetPlayerRoundData();
    console.log(`--- Starting Round ${gameState.currentRound} ---`);

     // Emit startRound to all players
    Object.values(gameState.players).forEach(player => {
         if (!player || !player.id) return;
         if (player.role === 'student') {
              io.to(player.id).emit('startRound', {
                  currentRound: gameState.currentRound,
                  totalRounds: gameState.config.totalRounds,
                  endowment: gameState.config.endowment,
                  cumulativePayoff: player.cumulativePayoff || 0
              });
         } else if (player.role === 'instructor') {
              console.log(`Emitting startRound to instructor: ${player.id}`); // <-- ADDED LOG
              io.to(player.id).emit('startRound', { // Send basic info to instructor too
                  currentRound: gameState.currentRound,
                  totalRounds: gameState.config.totalRounds,
                  stage: gameState.currentStage
              });
         }
    });
}


function advanceStage() {
    if (gameState.status !== 'running') return;

    const currentStage = gameState.currentStage;
    const punishmentActive = isPunishmentActive();

    console.log(`Attempting to advance stage from: ${currentStage} (Punishment active: ${punishmentActive})`);

    if (currentStage === 'contribution') {
        // Calculate preliminary data (group total, kept tokens) - full payoff later
        calculateRoundPayoffs(); // Calculates pre-punish earnings & group totals needed for punishment

        if (punishmentActive) {
            gameState.currentStage = 'punishment';
            console.log("Transitioning to Punishment Stage for round", gameState.currentRound);
             // Send contribution data to each player for punishment decisions
            gameState.groups.forEach(group => {
                 group.members.forEach(memberId => {
                     const player = gameState.players[memberId];
                     if(!player || player.role !== 'student') return;

                     const contributions = group.members.map(mId => ({
                         playerId: mId,
                         role: gameState.players[mId]?.roleInGroup,
                         contribution: gameState.players[mId]?.roundData?.contribution ?? 0
                     }));

                     io.to(memberId).emit('startPunishmentStage', {
                         currentRound: gameState.currentRound,
                         contributions: contributions,
                         roundEarnings: player.roundData?.prePunishEarnings ?? 0,
                         maxPunishmentPerTarget: gameState.config.maxPunishmentPerTarget,
                         punishmentEffect: gameState.config.punishmentEffect,
                         punishmentCost: gameState.config.punishmentCost
                     });
                 });
            });
             // Notify instructor
            if (gameState.instructorSocketId) {
                 console.log(`Emitting stageUpdate ('punishment') to instructor: ${gameState.instructorSocketId}`); // <-- ADDED LOG
                 io.to(gameState.instructorSocketId).emit('stageUpdate', { stage: 'punishment', round: gameState.currentRound });
             } else {
                 console.warn("No instructor socket ID found when trying to emit punishment stage update."); // <-- ADDED LOG
             }

        } else {
             // Skip punishment, go directly to feedback
             console.log("Skipping punishment, going directly to feedback for round", gameState.currentRound);
             gameState.currentStage = 'feedback';
             // Payoffs already calculated in the initial calculateRoundPayoffs call
             showFeedback();
        }
    } else if (currentStage === 'punishment') {
         console.log("Transitioning to Feedback Stage (after punishment) for round", gameState.currentRound);
         gameState.currentStage = 'feedback';
         calculateRoundPayoffs(); // Recalculate payoffs *with* punishment effects applied
         showFeedback();

    } else if (currentStage === 'feedback') {
         console.warn("Advance stage called during feedback - should use 'nextRound' command.");
         // startNextRound(); // Don't auto-advance, wait for instructor click
    } else {
        console.error(`Unknown stage to advance from: ${currentStage}`);
    }
}

function showFeedback() {
     if (gameState.status !== 'running') return;
     console.log("Showing Feedback for Round", gameState.currentRound);
     const punishmentActive = isPunishmentActive();
     let roundAvgContribution = 0;
     let studentCount = 0;

     // Prepare and send feedback to each student
     Object.values(gameState.players).forEach(player => {
         if (player.role !== 'student' || !player.roundData) return;
         studentCount++;
         roundAvgContribution += (player.roundData.contribution || 0);

         const feedbackData = {
             round: gameState.currentRound,
             yourContribution: player.roundData.contribution ?? 0,
             groupContribution: getPlayerGroup(player.id)?.roundData?.totalContribution ?? 0,
             tokensKept: player.roundData.tokensKept,
             projectEarnings: player.roundData.projectEarnings,
             prePunishEarnings: player.roundData.prePunishEarnings,
             punishmentWasEnabled: punishmentActive, // Tell client if punishment was possible this round
             punishCost: player.roundData.punishmentCost || 0,
             punishReceived: player.roundData.punishmentReceived || 0,
             finalEarnings: player.roundData.roundPayoff,
             cumulativePayoff: player.cumulativePayoff
         };
         io.to(player.id).emit('showFeedback', feedbackData);
     });

      // Record history for instructor chart
      if (studentCount > 0) {
          roundAvgContribution /= studentCount;
      } else {
          roundAvgContribution = 0; // Avoid NaN
      }
      gameState.resultsHistory.push({
          round: gameState.currentRound,
          avgContribution: roundAvgContribution,
          // Could add more detailed group data if needed
      });
      console.log(`Round ${gameState.currentRound} average contribution: ${roundAvgContribution.toFixed(2)}`);

      // Notify instructor
      if (gameState.instructorSocketId) {
          console.log(`Emitting stageUpdate ('feedback') to instructor: ${gameState.instructorSocketId}`); // <-- ADDED LOG
          io.to(gameState.instructorSocketId).emit('stageUpdate', { stage: 'feedback', round: gameState.currentRound });
          console.log(`Emitting resultsUpdate to instructor: ${gameState.instructorSocketId}`); // <-- ADDED LOG
          io.to(gameState.instructorSocketId).emit('resultsUpdate', gameState.resultsHistory); // Send history for chart
      } else {
          console.warn("No instructor socket ID found when trying to emit feedback results."); // <-- ADDED LOG
      }
 }

function gameOver() {
    console.log("--- Game Over ---");
    gameState.status = 'over';
    Object.values(gameState.players).forEach(player => {
        if (!player || !player.id) return;
        io.to(player.id).emit('gameOver', {
            finalPayoff: player.cumulativePayoff || 0,
            resultsHistory: gameState.resultsHistory // Send final results to everyone
        });
    });
}

function resetGame() {
    console.log("--- Resetting Game to Lobby State ---");
    // Save connected players to restore after reset
    const connectedPlayers = {...gameState.players};
    const instructorId = gameState.instructorSocketId;
    
    // Reset to initial state
    gameState = {
        ...initialGameState,
        players: connectedPlayers, // Keep connected players
        instructorSocketId: instructorId // Keep instructor ID
    };
    
    // Notify all players of the reset
    Object.values(gameState.players).forEach(player => {
        if (!player || !player.id) return;
        
        // Reset player game-specific attributes
        player.groupIndex = undefined;
        player.roleInGroup = undefined;
        player.cumulativePayoff = 0;
        player.roundData = {};
        
        // Send reset notification
        io.to(player.id).emit('gameReset');
    });
    
    // Notify instructor with updated player list
    if (instructorId) {
        io.to(instructorId).emit('updatePlayerList', 
            Object.values(gameState.players).filter(p => p.role === 'student'));
    }
}

// --- Socket.IO Connection Handling ---
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);
    // Don't add to players immediately, wait for registration
    // gameState.players[socket.id] = { id: socket.id, name: `Anon_${socket.id.substring(0, 4)}`, role: null, roundData: {}, cumulativePayoff: 0 };

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        const player = gameState.players[socket.id];
        if (player) {
            console.log(`Player ${player.name} (${player.role}) disconnected.`);
            if (player.role === 'instructor') {
                gameState.instructorSocketId = null;
                 // TODO: Maybe pause the game or notify students?
                 console.warn("Instructor disconnected!");
                 // Optionally notify students game is paused/ended?
            }
            // Remove player and notify instructor
            delete gameState.players[socket.id];
             // TODO: If game is running, need robust handling (pause, dummy player?)
             // For simplicity now, just remove. If mid-round, this will likely break checkAllSubmitted
             console.warn(`Player ${player.name} removed. Game state might be inconsistent if mid-round.`);
             if (gameState.instructorSocketId) {
                io.to(gameState.instructorSocketId).emit('updatePlayerList', Object.values(gameState.players).filter(p => p.role === 'student'));
             }
        } else {
            console.log(`Unregistered user ${socket.id} disconnected.`);
        }
    });

    socket.on('register', (data) => {
        // Don't allow registration if game is running? Or allow late join? For now, allow.
        // if (gameState.status === 'running') {
        //     socket.emit('errorMsg', 'Game already in progress. Cannot join now.');
        //     socket.disconnect(); // Force disconnect
        //     return;
        // }

        // Initialize player object on registration
        gameState.players[socket.id] = {
             id: socket.id,
             name: data.name || `Anon_${socket.id.substring(0,4)}`,
             role: data.role,
             roundData: {},
             cumulativePayoff: 0,
             groupIndex: undefined,
             roleInGroup: undefined
        };
        const player = gameState.players[socket.id]; // Get reference

        if (data.role === 'instructor') {
            if (gameState.instructorSocketId && gameState.instructorSocketId !== socket.id) {
                 socket.emit('errorMsg', 'Another instructor is already hosting.');
                 delete gameState.players[socket.id]; // Clean up player entry
                 socket.disconnect();
                 return;
             }
            gameState.instructorSocketId = socket.id;
            console.log(`Instructor registered: ${socket.id}`);
            // Send current student list to new instructor
             socket.emit('updatePlayerList', Object.values(gameState.players).filter(p => p.role === 'student'));

        } else if (data.role === 'student') {
            player.name = data.name || player.name;
            console.log(`Student registered: ${player.name} (${socket.id})`);
            // Notify instructor of new student
             if (gameState.instructorSocketId) {
                 io.to(gameState.instructorSocketId).emit('updatePlayerList', Object.values(gameState.players).filter(p => p.role === 'student'));
             }
             // If game already started, need to catch student up? Complex. For now, assumes joining before start.
        }
    });

    socket.on('instructorCommand', (data) => {
        if (socket.id !== gameState.instructorSocketId) {
             console.warn(`Command ignored from non-instructor ${socket.id}:`, data.command);
            return;
        }

        console.log(`Instructor command received: ${data.command}`);
        switch (data.command) {
            case 'startGame':
                if (gameState.status === 'lobby') {
                    startGame(data.config);
                } else {
                    socket.emit('errorMsg', 'Game cannot be started, already running or over.');
                }
                break;
            // 'nextStage' command removed as flow is now automatic based on submissions
            // case 'nextStage': ...
             case 'nextRound': // Triggered by instructor after viewing feedback
                if (gameState.status === 'running' && gameState.currentStage === 'feedback') {
                     console.log("Instructor triggered next round.");
                     startNextRound(); // This handles the feedback -> next round transition
                } else {
                    console.warn(`Cannot start next round from stage: ${gameState.currentStage} or status: ${gameState.status}`);
                    socket.emit('errorMsg', `Cannot start next round from current state (${gameState.currentStage}).`);
                }
                break;
            case 'resetGame': // New command to reset the game
                console.log("Instructor triggered game reset.");
                resetGame();
                socket.emit('gameResetConfirm', 'Game has been reset to lobby state.');
                break;
            case 'removeParticipant': // Remove a specific participant
                if (gameState.status !== 'lobby') {
                    console.warn("Cannot remove participant: Game already in progress");
                    socket.emit('errorMsg', 'Cannot remove participant once the game has started.');
                    return;
                }
                if (!data.participantId) {
                    console.warn("Cannot remove participant: No ID provided");
                    socket.emit('errorMsg', 'No participant ID provided for removal.');
                    return;
                }
                
                const participantToRemove = gameState.players[data.participantId];
                if (!participantToRemove) {
                    console.warn(`Cannot remove participant: ID ${data.participantId} not found`);
                    socket.emit('errorMsg', `Participant ${data.participantId} not found.`);
                    return;
                }
                
                if (participantToRemove.role !== 'student') {
                    console.warn(`Cannot remove non-student participant: ${data.participantId}`);
                    socket.emit('errorMsg', 'Only student participants can be removed.');
                    return;
                }
                
                console.log(`Removing participant: ${participantToRemove.name} (${data.participantId})`);
                
                // First, notify the participant they're being removed
                io.to(data.participantId).emit('removedFromGame', { message: 'You have been removed from the game by the instructor.' });
                
                // Then disconnect them
                const participantSocket = io.sockets.sockets.get(data.participantId);
                if (participantSocket) {
                    participantSocket.disconnect(true);
                }
                
                // Remove from players list
                delete gameState.players[data.participantId];
                
                // Update instructor's player list
                io.to(gameState.instructorSocketId).emit('updatePlayerList', 
                    Object.values(gameState.players).filter(p => p.role === 'student'));
                
                socket.emit('participantRemoved', { 
                    message: `Participant ${participantToRemove.name} has been removed.`,
                    removedId: data.participantId
                });
                break;
            // Add other commands if needed (e.g., pause)
        }
    });

    socket.on('submitContribution', (data) => {
        const player = gameState.players[socket.id];
        if (!player || player.role !== 'student' || gameState.status !== 'running' || gameState.currentStage !== 'contribution') {
             console.warn(`Invalid contribution submission state for ${socket.id}. Stage: ${gameState.currentStage}, Status: ${gameState.status}`);
             return;
        }
        if (player.roundData.contribution !== null) {
            console.warn(`Player ${player.name} (${socket.id}) already submitted contribution.`);
            return; // Prevent double submission
        }

        const amount = parseInt(data.amount);
        if (isNaN(amount) || amount < 0 || amount > gameState.config.endowment) {
             socket.emit('errorMsg', `Invalid contribution amount (must be 0-${gameState.config.endowment}).`);
             return;
        }

        player.roundData.contribution = amount;
        console.log(`Player ${player.name} (${socket.id}) contributed ${amount} in round ${gameState.currentRound}`);

        // Check if all players in this stage have submitted
        if (checkAllSubmitted('contribution')) {
             console.log("All contributions received for round", gameState.currentRound);
             advanceStage(); // Move to punishment or feedback
        }
    });

     socket.on('submitPunishment', (data) => {
         const player = gameState.players[socket.id];
         if (!player || player.role !== 'student' || gameState.status !== 'running' || gameState.currentStage !== 'punishment') {
             console.warn(`Invalid punishment submission state for ${socket.id}. Stage: ${gameState.currentStage}, Status: ${gameState.status}`);
             return;
         }
         if (player.roundData.punishmentsGiven !== null) {
             console.warn(`Player ${player.name} (${socket.id}) already submitted punishments.`);
             return; // Prevent double submission
         }
         if (!Array.isArray(data.punishments)) {
             socket.emit('errorMsg', 'Invalid punishment data format.');
             return;
         }

         const config = gameState.config;
         let totalPunishmentCost = 0;
         const validPunishments = [];

         // Pre-calculate prePunishEarnings if not already done (should be by now)
         if (player.roundData.prePunishEarnings === undefined) {
             console.warn(`prePunishEarnings not calculated for ${player.name} before punishment submission.`);
             // Attempt calculation on the fly - might be inaccurate if group data changed
             const contribution = player.roundData.contribution ?? 0;
             const tokensKept = config.endowment - contribution;
             const group = getPlayerGroup(player.id);
             const projectEarnings = (group?.roundData?.totalContribution ?? 0) * config.mpcr;
             player.roundData.prePunishEarnings = tokensKept + projectEarnings;
         }
         const playerEarnings = player.roundData.prePunishEarnings || 0;


         for (const p of data.punishments) {
             const points = parseInt(p.points);
             const targetPlayer = gameState.players[p.targetId];
             const targetGroup = getPlayerGroup(p.targetId);
             const playerGroup = getPlayerGroup(player.id);

             // Basic validation
             if (!targetPlayer || targetGroup?.id !== playerGroup?.id) {
                 console.warn(`Invalid punishment target ${p.targetId} from ${player.id}`);
                 continue; // Ignore punishment to invalid or wrong-group target
             }
              if (p.targetId === player.id) {
                  console.warn(`Player ${player.id} tried to punish self.`);
                  continue; // Cannot punish self
              }
             if (isNaN(points) || points < 0 || points > config.maxPunishmentPerTarget) {
                 socket.emit('errorMsg', `Invalid punishment points for player ${targetPlayer.name} (0-${config.maxPunishmentPerTarget}).`);
                 console.error(`Invalid punishment points (${points}) submitted by ${player.id} for ${targetPlayer.id}. Submission rejected.`);
                 // Invalidate the whole submission by returning early
                 return;
             }
             totalPunishmentCost += (points * config.punishmentCost);
             if (points > 0) {
                 validPunishments.push({ targetId: p.targetId, points: points });
             }
         }

         // Check total cost against earnings (pre-punishment)
         if (totalPunishmentCost > playerEarnings) {
             console.warn(`Player ${player.name} tried to spend ${totalPunishmentCost} on punishment with only ${playerEarnings} earnings.`);
             socket.emit('errorMsg', `Total punishment cost (${totalPunishmentCost}) exceeds earnings for this round (${playerEarnings.toFixed(2)}).`);
             return; // Reject submission
         }

         player.roundData.punishmentsGiven = validPunishments; // Store the validated list
         console.log(`Player ${player.name} (${socket.id}) submitted punishments: ${JSON.stringify(validPunishments)} in round ${gameState.currentRound}`);


        // Check if all players in this stage have submitted
         if (checkAllSubmitted('punishment')) {
             console.log("All punishments received for round", gameState.currentRound);
             advanceStage(); // Move to feedback
         }
     });

});

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});