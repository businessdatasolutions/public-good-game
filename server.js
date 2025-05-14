const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const path = require('path');

const app = express();

// VERY FIRST MIDDLEWARE to log all requests
app.use((req, res, next) => {
    console.log(`[SERVER REQUEST] Method: ${req.method}, URL: ${req.url}`);
    next();
});

const server = http.createServer(app); // Create server AFTER app and logging middleware are defined
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const GROUP_SIZE = 4; // Fixed group size
const GAME_ID_LENGTH = 5;
const GAME_TIMEOUT_MS = 4 * 60 * 60 * 1000; // 4 hours
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// --- Game State Management ---
let activeGames = {}; // Key: gameId, Value: gameState object

const initialGameStateTemplate = {
    gameId: null,
    status: 'lobby', // lobby, running, over
    config: {},
    currentRound: 0,
    currentStage: '', // contribution, punishment, feedback
    players: {}, // { socketId: { id, name, role, gameId, groupIndex, roleInGroup, cumulativePayoff, roundData: {...} } }
    groups: [],
    resultsHistory: [],
    instructorSocketId: null,
    lastActivityTimestamp: Date.now()
};

// --- Helper Functions ---
function generateGameId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let id = '';
    do {
        id = '';
        for (let i = 0; i < GAME_ID_LENGTH; i++) {
            id += chars.charAt(Math.floor(Math.random() * chars.length));
        }
    } while (activeGames[id]); // Ensure unique
    return id;
}

function getGameForSocket(socket) {
    return activeGames[socket.gameId];
}

function getStudentsInGame(game) {
    if (!game || !game.players) return [];
    return Object.values(game.players).filter(p => p.role === 'student');
}

function getPlayerGroup(player, game) {
    if (player && player.groupIndex !== undefined && game.groups[player.groupIndex]) {
        return game.groups[player.groupIndex];
    }
    return null;
}

function getOtherGroupMembers(player, game) {
    const group = getPlayerGroup(player, game);
    if (!player || !group) return [];
    return group.members
        .filter(memberId => memberId !== player.id)
        .map(memberId => game.players[memberId])
        .filter(p => p);
}

function checkAllSubmitted(stage, game) {
    if (!game.groups || game.groups.length === 0) return false; // No groups, nothing to check
    if (!Object.values(game.players).some(p => p.role === 'student')) return true; // No students, consider submitted

    const needsPunishmentCheck = stage === 'punishment' && isPunishmentActive(game);

    for (const group of game.groups) {
        for (const memberId of group.members) {
            const player = game.players[memberId];
            if (!player || player.role !== 'student') continue;
            if (stage === 'contribution' && player.roundData.contribution === null) return false;
            if (needsPunishmentCheck && player.roundData.punishmentsGiven === null) return false;
        }
    }
    return true;
}

function isPunishmentActive(game) {
    const config = game.config;
    return config.punishmentStartsRound > 0 && game.currentRound >= config.punishmentStartsRound;
}

function calculateRoundPayoffs(game) {
    game.lastActivityTimestamp = Date.now();
    const config = game.config;
    if (!config || config.endowment === undefined || config.mpcr === undefined) {
        console.error(`[${game.gameId}] Cannot calculate payoffs: Game config missing/invalid. Endowment: ${config.endowment}, MPCR: ${config.mpcr}`);
        return;
    }
    const punishmentActiveThisStage = isPunishmentActive(game);

    game.groups.forEach((group, groupIndex) => {
        group.roundData = group.roundData || {};
        group.roundData.totalContribution = group.members.reduce((sum, memberId) => {
            const player = game.players[memberId];
            return sum + (player?.roundData?.contribution ?? 0);
        }, 0);

        group.members.forEach(memberId => {
            if (game.players[memberId]?.roundData) game.players[memberId].roundData.punishmentReceived = 0;
        });

        if (punishmentActiveThisStage && game.currentStage === 'feedback') {
            group.members.forEach(punisherId => {
                const punisher = game.players[punisherId];
                 if (punisher?.roundData?.punishmentsGiven) {
                    punisher.roundData.punishmentsGiven.forEach(punishment => {
                        const targetPlayer = game.players[punishment.targetId];
                        if (targetPlayer && targetPlayer.groupIndex === group.id) {
                            const punishmentAmount = (punishment.points * config.punishmentEffect);
                            targetPlayer.roundData.punishmentReceived += punishmentAmount;
                         }
                    });
                 }
            });
        }
    });

    Object.values(game.players).forEach(player => {
        if (player.role !== 'student' || !player.roundData) return;
        const group = getPlayerGroup(player, game);
        if (!group || !group.roundData) return;

        const contribution = player.roundData.contribution ?? 0;
        player.roundData.tokensKept = config.endowment - contribution;
        player.roundData.projectEarnings = group.roundData.totalContribution * config.mpcr;
        player.roundData.prePunishEarnings = player.roundData.tokensKept + player.roundData.projectEarnings;
        
        player.roundData.punishmentCost = 0;
        if (punishmentActiveThisStage && player.roundData.punishmentsGiven) {
             player.roundData.punishmentCost = player.roundData.punishmentsGiven.reduce((sum, p) => sum + (p.points * config.punishmentCost), 0);
        }
        
        let effectivePunishmentReceived = Math.min(player.roundData.punishmentReceived || 0, player.roundData.prePunishEarnings);
        // Ensure punishment received doesn't make earnings negative from punishment alone, costs can.
        effectivePunishmentReceived = Math.max(0, effectivePunishmentReceived);


        player.roundData.roundPayoff = player.roundData.prePunishEarnings - effectivePunishmentReceived - player.roundData.punishmentCost;
        player.cumulativePayoff = (player.cumulativePayoff || 0) + player.roundData.roundPayoff;
    });
}

function resetPlayerRoundData(game) {
     Object.values(game.players).forEach(player => {
        if (player.role === 'student') {
            player.roundData = {
                contribution: null, punishmentsGiven: null, punishmentReceived: 0,
                roundPayoff: 0, tokensKept: 0, projectEarnings: 0,
                prePunishEarnings: 0, punishmentCost: 0
            };
        }
     });
     game.groups.forEach(group => { group.roundData = { totalContribution: 0 }; });
 }

function startGameLogic(config, game) {
    game.lastActivityTimestamp = Date.now();
    const students = getStudentsInGame(game);

    if (students.length < GROUP_SIZE) {
        if(game.instructorSocketId) io.to(game.instructorSocketId).emit('errorMsg', `Need at least ${GROUP_SIZE} students to start (currently ${students.length}).`);
        return false;
    }

    for (let i = students.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [students[i], students[j]] = [students[j], students[i]];
    }

    game.groups = [];
    let formedCompleteGroup = false;
    for (let i = 0; i < students.length; i += GROUP_SIZE) {
        if (students.length - i < GROUP_SIZE) {
            console.log(`[${game.gameId}] Not forming an incomplete group with remaining ${students.length - i} students.`);
            break;
        }
        const groupMembers = students.slice(i, i + GROUP_SIZE).map(p => p.id);
        const groupObj = { id: game.groups.length, members: groupMembers, roundData: {} };
        game.groups.push(groupObj);
        formedCompleteGroup = true;
        groupMembers.forEach((playerId, index) => {
            if (game.players[playerId]) {
                game.players[playerId].groupIndex = groupObj.id;
                game.players[playerId].roleInGroup = index + 1;
                game.players[playerId].cumulativePayoff = 0;
            }
        });
    }
    
    if (!formedCompleteGroup) {
        if(game.instructorSocketId) io.to(game.instructorSocketId).emit('errorMsg', `Could not form any complete groups of ${GROUP_SIZE}. At least ${GROUP_SIZE} students required.`);
        return false;
    }

    game.config = config;
    game.currentRound = 0;
    game.status = 'running';
    game.resultsHistory = [];

    console.log(`[${game.gameId}] Game starting with config:`, config, "Groups:", game.groups.length);

    io.to(game.gameId).emit('gameStarted', {
        gameId: game.gameId,
        config: game.config,
    });
    startNextRound(game);
    return true;
}

function startNextRound(game) {
    game.lastActivityTimestamp = Date.now();
    if (game.status !== 'running') return;

    if (game.currentRound >= game.config.totalRounds) {
        gameOver(game);
        return;
    }
    game.currentRound++;
    game.currentStage = 'contribution';
    resetPlayerRoundData(game);
    console.log(`[${game.gameId}] --- Starting Round ${game.currentRound} ---`);

    Object.values(game.players).forEach(player => {
        if (!player || !player.id) return;
        const payload = {
            gameId: game.gameId,
            currentRound: game.currentRound,
            totalRounds: game.config.totalRounds,
            stage: game.currentStage
        };
        if (player.role === 'student') {
            payload.endowment = game.config.endowment;
            payload.cumulativePayoff = player.cumulativePayoff || 0;
        }
        io.to(player.id).emit('startRound', payload);
    });
}

function advanceStage(game) {
    game.lastActivityTimestamp = Date.now();
    if (game.status !== 'running') return;
    const currentStage = game.currentStage;
    const punishmentActive = isPunishmentActive(game);

    if (currentStage === 'contribution') {
        calculateRoundPayoffs(game);

        if (punishmentActive) {
            game.currentStage = 'punishment';
            game.groups.forEach(group => {
                 group.members.forEach(memberId => {
                     const player = game.players[memberId];
                     if(!player || player.role !== 'student') return;
                     const contributions = group.members.map(mId => ({
                         playerId: mId, name: game.players[mId]?.name,
                         contribution: game.players[mId]?.roundData?.contribution ?? 0
                     }));
                     io.to(memberId).emit('startPunishmentStage', {
                         gameId: game.gameId, currentRound: game.currentRound, contributions: contributions,
                         roundEarnings: player.roundData?.prePunishEarnings ?? 0,
                         maxPunishmentPerTarget: game.config.maxPunishmentPerTarget,
                         punishmentEffect: game.config.punishmentEffect,
                         punishmentCost: game.config.punishmentCost
                     });
                 });
            });
            if (game.instructorSocketId) io.to(game.instructorSocketId).emit('stageUpdate', { gameId: game.gameId, stage: 'punishment', round: game.currentRound });
        } else {
             game.currentStage = 'feedback';
             showFeedback(game);
        }
    } else if (currentStage === 'punishment') {
         game.currentStage = 'feedback';
         calculateRoundPayoffs(game);
         showFeedback(game);
    }
}

function showFeedback(game) {
     game.lastActivityTimestamp = Date.now();
     if (game.status !== 'running') return;
     const punishmentActive = isPunishmentActive(game);
     let roundAvgContribution = 0;
     const studentsInGame = getStudentsInGame(game);
     let studentCountThisRound = 0;

     studentsInGame.forEach(player => {
         if (!player.roundData) return;
         studentCountThisRound++;
         roundAvgContribution += (player.roundData.contribution || 0);
         const feedbackData = {
             gameId: game.gameId, round: game.currentRound,
             yourContribution: player.roundData.contribution ?? 0,
             groupContribution: getPlayerGroup(player, game)?.roundData?.totalContribution ?? 0,
             tokensKept: player.roundData.tokensKept,
             projectEarnings: player.roundData.projectEarnings,
             prePunishEarnings: player.roundData.prePunishEarnings,
             punishmentWasEnabled: punishmentActive,
             punishCost: player.roundData.punishmentCost || 0,
             punishReceived: player.roundData.punishmentReceived || 0,
             finalEarnings: player.roundData.roundPayoff,
             cumulativePayoff: player.cumulativePayoff
         };
         io.to(player.id).emit('showFeedback', feedbackData);
     });

      if (studentCountThisRound > 0) roundAvgContribution /= studentCountThisRound;
      else roundAvgContribution = 0;
      
      game.resultsHistory.push({ round: game.currentRound, avgContribution: roundAvgContribution });
      
      if (game.instructorSocketId) {
          io.to(game.instructorSocketId).emit('stageUpdate', { gameId: game.gameId, stage: 'feedback', round: game.currentRound });
          io.to(game.instructorSocketId).emit('resultsUpdate', { gameId: game.gameId, history: game.resultsHistory});
      }
 }

function gameOver(game) {
    game.lastActivityTimestamp = Date.now();
    console.log(`[${game.gameId}] --- Game Over ---`);
    game.status = 'over';
     Object.values(game.players).forEach(player => {
        io.to(player.id).emit('gameOver', {
            gameId: game.gameId,
            finalPayoff: player.cumulativePayoff || 0,
            resultsHistory: game.resultsHistory
        });
    });
}

function resetGame(game) {
    game.lastActivityTimestamp = Date.now();
    console.log(`[${game.gameId}] --- Resetting Game to Lobby State ---`);
    
    game.status = 'lobby';
    game.config = {};
    game.currentRound = 0;
    game.currentStage = '';
    game.groups = [];
    game.resultsHistory = [];

    Object.values(game.players).forEach(player => {
        player.groupIndex = undefined;
        player.roleInGroup = undefined;
        player.cumulativePayoff = 0;
        player.roundData = {};
    });
    
    const newGameConfigForClient = { status: 'lobby' };
    io.to(game.gameId).emit('gameReset', { gameId: game.gameId, newGameConfig: newGameConfigForClient });
    if (game.instructorSocketId) {
         io.to(game.instructorSocketId).emit('updatePlayerList', getStudentsInGame(game));
    }
}

// --- Express Routes ---
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files from 'public' directory

app.get('/game/:gameId', (req, res) => {
    // Serves index.html for any /game/GAMEID URL. Client JS will handle the gameId.
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/', (req, res) => {
    // Serves index.html for the root URL.
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Socket.IO Connection Handling ---
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);
    socket.gameId = null;

    socket.on('disconnect', (reason) => {
        console.log(`User disconnected: ${socket.id}, reason: ${reason}`);
        const game = getGameForSocket(socket); // socket.gameId might be null if not registered
        if (game && game.players[socket.id]) {
            const player = game.players[socket.id];
            console.log(`Player ${player.name} (${player.role}) from game ${game.gameId} disconnected.`);
            
            if (player.role === 'instructor' && game.instructorSocketId === socket.id) {
                game.instructorSocketId = null;
                console.warn(`[${game.gameId}] Instructor disconnected!`);
            }
            
            delete game.players[socket.id];
            game.lastActivityTimestamp = Date.now();

            if (game.instructorSocketId) {
                io.to(game.instructorSocketId).emit('updatePlayerList', getStudentsInGame(game));
            }
            if (Object.keys(game.players).length === 0 && !game.instructorSocketId) {
                console.log(`[${game.gameId}] Game empty. Will be cleaned up.`);
            }
        } else {
            console.log(`Unassigned user ${socket.id} disconnected or game not found for socket.`);
        }
    });

    socket.on('createGameRequest', (data) => {
        const newGameId = generateGameId();
        activeGames[newGameId] = JSON.parse(JSON.stringify(initialGameStateTemplate));
        const game = activeGames[newGameId];
        
        game.gameId = newGameId;
        game.instructorSocketId = socket.id;
        game.lastActivityTimestamp = Date.now();
        
        socket.join(newGameId);
        socket.gameId = newGameId;
        
        const instructorName = data.name || 'Instructor';
        game.players[socket.id] = { 
            id: socket.id, name: instructorName, role: 'instructor', 
            gameId: newGameId, cumulativePayoff: 0, roundData: {}
        };

        console.log(`Instructor ${socket.id} (${instructorName}) created game ${newGameId}`);
        socket.emit('gameCreated', { gameId: newGameId });
    });

    socket.on('register', (data) => {
        const gameId = data.gameId;
        const game = activeGames[gameId];

        if (!game) {
            socket.emit('errorMsg', `Game ID '${gameId}' not found.`);
            return;
        }
        game.lastActivityTimestamp = Date.now();
        socket.gameId = gameId; // Associate socket with game early
        socket.join(gameId);   // Ensure in Socket.IO room

        if (game.players[socket.id] && data.isReconnection) {
            console.log(`Player ${game.players[socket.id].name} (${socket.id}) reconnected to game ${gameId}.`);
            // Player object already exists, just ensure they are in the room and send state
            if (game.status === 'lobby') {
                 socket.emit('joinedGame', { gameId: gameId, gameConfig: { status: 'lobby' } });
                 if (game.players[socket.id].role === 'instructor' && game.instructorSocketId === socket.id) {
                    socket.emit('updatePlayerList', getStudentsInGame(game));
                 } else if (game.players[socket.id].role === 'student' && game.instructorSocketId) {
                    io.to(game.instructorSocketId).emit('updatePlayerList', getStudentsInGame(game)); // Update instructor too
                 }
            } else if (game.status === 'running') {
                 socket.emit('gameStarted', { gameId: gameId, config: game.config });
                 const playerState = game.players[socket.id];
                 const payload = {
                     gameId: game.gameId, currentRound: game.currentRound, totalRounds: game.config.totalRounds,
                     stage: game.currentStage, endowment: game.config.endowment,
                     cumulativePayoff: playerState.cumulativePayoff || 0
                 };
                 socket.emit('startRound', payload);
            } else if (game.status === 'over') {
                socket.emit('gameOver', { gameId: game.gameId, finalPayoff: game.players[socket.id].cumulativePayoff || 0, resultsHistory: game.resultsHistory });
            }
            return;
        }
        
        // New player registration
        if (data.role === 'instructor') {
            if (game.instructorSocketId && game.instructorSocketId !== socket.id) {
                 socket.emit('errorMsg', 'Another instructor is already hosting this game.'); 
                 socket.leave(gameId); // Leave room if mistakenly joined
                 socket.gameId = null;
                 return;
            }
            game.instructorSocketId = socket.id;
            game.players[socket.id] = { id: socket.id, name: data.name || 'Instructor', role: 'instructor', gameId: gameId, cumulativePayoff: 0, roundData: {} };
        } else if (data.role === 'student') {
            if (game.status !== 'lobby' && game.status !== 'running') {
                 socket.emit('errorMsg', 'Cannot join game: Not in lobby or running state.'); 
                 socket.leave(gameId);
                 socket.gameId = null;
                 return;
            }
            game.players[socket.id] = { id: socket.id, name: data.name || `Anon_${socket.id.substring(0,4)}`, role: 'student', gameId: gameId, cumulativePayoff: 0, roundData: {} };
        } else {
            socket.emit('errorMsg', 'Invalid role for registration.'); return;
        }

        console.log(`${data.role} ${game.players[socket.id].name} (${socket.id}) registered for game ${gameId}`);

        if (data.role === 'student') {
            socket.emit('joinedGame', { gameId: gameId, gameConfig: { status: game.status, ...game.config } });
            if (game.instructorSocketId) {
                io.to(game.instructorSocketId).emit('updatePlayerList', getStudentsInGame(game));
            }
            if (game.status === 'running') {
                socket.emit('gameStarted', { gameId: gameId, config: game.config });
                const payload = {
                     gameId: game.gameId, currentRound: game.currentRound, totalRounds: game.config.totalRounds,
                     stage: game.currentStage, endowment: game.config.endowment,
                     cumulativePayoff: 0 
                 };
                socket.emit('startRound', payload);
            }
        }
    });

    socket.on('instructorCommand', (data) => {
        const game = activeGames[data.gameId];
        if (!game || socket.id !== game.instructorSocketId) {
             console.warn(`Command ignored. Socket ${socket.id} not instructor for game ${data.gameId}.`);
             socket.emit('errorMsg', 'Unauthorized command or game not found.');
            return;
        }
        game.lastActivityTimestamp = Date.now();
        console.log(`[${data.gameId}] Instructor command: ${data.command}`);
        switch (data.command) {
            case 'startGame':
                if (game.status === 'lobby') startGameLogic(data.config, game);
                else socket.emit('errorMsg', 'Game already running or over.');
                break;
            case 'nextRound':
                if (game.status === 'running' && game.currentStage === 'feedback') startNextRound(game);
                else socket.emit('errorMsg', `Cannot start next round from state: ${game.currentStage}/${game.status}`);
                break;
            case 'resetGame':
                resetGame(game);
                break;
            case 'removeParticipant':
                if (game.status !== 'lobby') {
                    socket.emit('errorMsg', 'Cannot remove participant: Game not in lobby.'); return;
                }
                const participantToRemove = game.players[data.participantId];
                if (participantToRemove && participantToRemove.role === 'student') {
                    io.to(data.participantId).emit('removedFromGame', { message: 'You have been removed by the instructor.' });
                    const pSocket = io.sockets.sockets.get(data.participantId);
                    if(pSocket) {
                        pSocket.leave(game.gameId); // Make them leave the room
                        pSocket.disconnect(true);   // Then disconnect
                    }
                    
                    delete game.players[data.participantId]; // Remove from game state
                    io.to(game.instructorSocketId).emit('updatePlayerList', getStudentsInGame(game));
                    socket.emit('participantRemoved', { message: `Participant ${participantToRemove.name} removed.`});
                } else {
                    socket.emit('errorMsg', 'Participant not found or not a student.');
                }
                break;
        }
    });

    socket.on('submitContribution', (data) => {
        const game = activeGames[data.gameId];
        if (!game) { console.warn(`Contribution for unknown game ${data.gameId}`); return; }
        const player = game.players[socket.id];
        if (!player || player.role !== 'student' || game.status !== 'running' || game.currentStage !== 'contribution') return;
        if (player.roundData.contribution !== null) return;

        const amount = parseInt(data.amount);
        if (isNaN(amount) || amount < 0 || amount > game.config.endowment) {
             socket.emit('errorMsg', `Invalid contribution (0-${game.config.endowment}).`); return;
        }
        player.roundData.contribution = amount;
        game.lastActivityTimestamp = Date.now();
        if (checkAllSubmitted('contribution', game)) advanceStage(game);
    });

     socket.on('submitPunishment', (data) => {
         const game = activeGames[data.gameId];
         if (!game) { console.warn(`Punishment for unknown game ${data.gameId}`); return; }
         const player = game.players[socket.id];
         if (!player || player.role !== 'student' || game.status !== 'running' || game.currentStage !== 'punishment') return;
         if (player.roundData.punishmentsGiven !== null) return;
         if (!Array.isArray(data.punishments)) { socket.emit('errorMsg', 'Invalid punishment data.'); return; }

         const config = game.config;
         let totalPunishmentCost = 0;
         const validPunishments = [];
         // Ensure prePunishEarnings is available; calculate if necessary (though it should be from advanceStage)
         let playerEarnings = player.roundData.prePunishEarnings;
         if (playerEarnings === undefined) {
            const contribution = player.roundData.contribution ?? 0;
            const group = getPlayerGroup(player, game);
            const groupTotalContribution = group?.roundData?.totalContribution ?? 0; // Needs group total for this calc
            playerEarnings = (config.endowment - contribution) + (groupTotalContribution * config.mpcr);
         }


         for (const p of data.punishments) {
             const points = parseInt(p.points);
             const targetPlayer = game.players[p.targetId];
             if (!targetPlayer || getPlayerGroup(targetPlayer, game)?.id !== getPlayerGroup(player, game)?.id || p.targetId === player.id) continue;
             if (isNaN(points) || points < 0 || points > config.maxPunishmentPerTarget) {
                 socket.emit('errorMsg', `Invalid punishment points (0-${config.maxPunishmentPerTarget}).`); return;
             }
             totalPunishmentCost += (points * config.punishmentCost);
             if (points > 0) validPunishments.push({ targetId: p.targetId, points: points });
         }
         if (totalPunishmentCost > playerEarnings + 0.001) {
             socket.emit('errorMsg', `Punishment cost (${totalPunishmentCost.toFixed(2)}) exceeds earnings (${playerEarnings.toFixed(2)}).`); return;
         }
         player.roundData.punishmentsGiven = validPunishments;
         game.lastActivityTimestamp = Date.now();
         if (checkAllSubmitted('punishment', game)) advanceStage(game);
     });
});

// Game Cleanup Interval
setInterval(() => {
    const now = Date.now();
    for (const gameId in activeGames) {
        if (now - activeGames[gameId].lastActivityTimestamp > GAME_TIMEOUT_MS) {
            console.log(`[${gameId}] Game timed out due to inactivity. Cleaning up.`);
            io.to(gameId).emit('gameClosed', { message: 'Game session timed out and has been closed.' });
            
            const socketsInRoom = io.sockets.adapter.rooms.get(gameId);
            if (socketsInRoom) {
                socketsInRoom.forEach(socketId => {
                    const sock = io.sockets.sockets.get(socketId);
                    if(sock) sock.disconnect(true);
                });
            }
            delete activeGames[gameId];
        }
    }
}, CLEANUP_INTERVAL_MS);


server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});