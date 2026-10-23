import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { AppError } from '../utils/errors.js';
import { MultiplayerRoom, roomService } from './room.service.js';
import { roomStore } from './room.store.js';
import {
  HostEndSchema,
  HostJoinSchema,
  HostLockSchema,
  HostNextSchema,
  HostStartSchema,
  HostUnlockSchema,
  LeaderboardEntry,
  MULTIPLAYER_CONFIG,
  OutboundMessage,
  PlayerAnswerSchema,
  PlayerJoinSchema,
  PlayerLeaveSchema,
  PlayerReconnectSchema,
} from './room.types.js';

interface SocketMeta {
  roomCode: string;
  role: 'host' | 'player' | null;
  token: string; // hostToken or playerToken
  playerId?: string;
  isAlive: boolean;
}

export class MultiplayerWebSocketServer {
  private wss: WebSocketServer | null = null;
  private roomSockets: Map<string, Set<WebSocket>> = new Map();
  private socketMeta: Map<WebSocket, SocketMeta> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  /**
   * Attaches the WebSocket server to an existing HTTP server.
   */
  public attach(server: http.Server): WebSocketServer {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket) => {
      const meta: SocketMeta = {
        roomCode: '',
        role: null,
        token: '',
        isAlive: true,
      };
      this.socketMeta.set(ws, meta);

      ws.on('pong', () => {
        const m = this.socketMeta.get(ws);
        if (m) m.isAlive = true;
      });

      ws.on('message', (data: Buffer | string) => {
        this.handleMessage(ws, data);
      });

      ws.on('close', () => {
        this.handleDisconnect(ws);
      });

      ws.on('error', (err) => {
        this.handleDisconnect(ws);
      });
    });

    // Setup 30s heartbeat interval
    this.heartbeatInterval = setInterval(() => {
      if (!this.wss) return;
      for (const ws of this.wss.clients) {
        const meta = this.socketMeta.get(ws);
        if (!meta) continue;
        if (!meta.isAlive) {
          ws.terminate();
          continue;
        }
        meta.isAlive = false;
        try {
          ws.ping();
        } catch {
          ws.terminate();
        }
      }
    }, 30000);

    return this.wss;
  }

  /**
   * Closes the WebSocket server and releases all connections and timers.
   */
  public close(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.wss) {
      for (const ws of this.wss.clients) {
        try {
          ws.close();
        } catch {}
      }
      this.wss.close();
      this.wss = null;
    }

    this.roomSockets.clear();
    this.socketMeta.clear();
  }

  /**
   * Handles incoming client messages with complete error boundary.
   */
  private handleMessage(ws: WebSocket, rawData: Buffer | string): void {
    let payload: any;
    try {
      const str = typeof rawData === 'string' ? rawData : rawData.toString('utf-8');
      payload = JSON.parse(str);
    } catch {
      this.sendError(ws, 'INVALID_MESSAGE', 'Malformed JSON payload. Message must be valid JSON.');
      return;
    }

    if (!payload || typeof payload !== 'object' || !payload.type) {
      this.sendError(ws, 'INVALID_MESSAGE', 'Missing message "type" property.');
      return;
    }

    try {
      switch (payload.type) {
        case 'host.join':
          this.handleHostJoin(ws, payload);
          break;

        case 'host.start':
          this.handleHostStart(ws, payload);
          break;

        case 'host.next':
          this.handleHostNext(ws, payload);
          break;

        case 'host.end':
          this.handleHostEnd(ws, payload);
          break;

        case 'host.lock':
          this.handleHostLock(ws, true);
          break;

        case 'host.unlock':
          this.handleHostLock(ws, false);
          break;

        case 'player.join':
          this.handlePlayerJoin(ws, payload);
          break;

        case 'player.answer':
          this.handlePlayerAnswer(ws, payload);
          break;

        case 'player.reconnect':
          this.handlePlayerReconnect(ws, payload);
          break;

        case 'player.leave':
          this.handlePlayerLeave(ws);
          break;

        default:
          this.sendError(ws, 'INVALID_MESSAGE', `Unknown message type: "${payload.type}".`);
      }
    } catch (err: any) {
      const code = err instanceof AppError ? err.code : 'INTERNAL_ERROR';
      const message = err.message || 'An unexpected error occurred.';
      this.sendError(ws, code, message);
    }
  }

  private handleHostJoin(ws: WebSocket, payload: unknown): void {
    const parse = HostJoinSchema.safeParse(payload);
    if (!parse.success) {
      this.sendError(ws, 'INVALID_MESSAGE', parse.error.issues[0]?.message || 'Invalid host.join payload.');
      return;
    }

    const { roomCode, hostToken } = parse.data;
    const room = roomStore.getByRoomCode(roomCode);
    if (!room) {
      this.sendError(ws, 'ROOM_NOT_FOUND', `Room "${roomCode}" not found.`);
      return;
    }

    if (room.hostToken !== hostToken) {
      this.sendError(ws, 'INVALID_HOST_TOKEN', 'Host authorization failed: invalid host token.');
      return;
    }

    this.registerSocket(ws, room.roomCode, 'host', hostToken);

    this.send(ws, {
      type: 'room.joined',
      role: 'host',
      roomCode: room.roomCode,
      roomId: room.roomId,
      state: room.state,
      title: room.gameSpecification.title,
      gameType: room.gameSpecification.gameType,
      totalQuestions: room.gameSpecification.questions.length,
      playerCount: room.players.size,
      players: Array.from(room.players.values()).map((p) => ({
        id: p.playerId,
        displayName: p.displayName,
        connected: p.connected,
      })),
      isLocked: room.isLocked,
      currentQuestionIndex: room.currentQuestionIndex,
    });

    if (room.state === 'QUESTION_ACTIVE') {
      const currentQ = room.getSanitizedCurrentQuestion();
      const answeredCount = Array.from(room.players.values()).filter((p) =>
        p.answeredQuestionIds.has(currentQ.id)
      ).length;
      this.send(ws, {
        type: 'question.started',
        question: currentQ,
        answeredCount,
        totalPlayers: room.players.size,
      });
    } else if (room.state === 'QUESTION_REVEAL') {
      const activeQ = room.gameSpecification.questions[room.currentQuestionIndex];
      this.send(ws, {
        type: 'question.revealed',
        questionId: activeQ.id,
        correctAnswer: activeQ.correctAnswer,
        explanation: activeQ.explanation,
        leaderboard: room.getLeaderboard(),
      });
    } else if (room.state === 'FINISHED') {
      const leaderboard = room.getLeaderboard();
      this.send(ws, {
        type: 'game.finished',
        leaderboard,
        winner: leaderboard[0],
        totalQuestions: room.gameSpecification.questions.length,
      });
    }
  }

  private handleHostLock(ws: WebSocket, locked: boolean): void {
    const meta = this.socketMeta.get(ws);
    if (!meta || meta.role !== 'host') {
      this.sendError(ws, 'NOT_HOST', 'Only the room host can lock or unlock the room.');
      return;
    }

    const room = roomStore.getByRoomCode(meta.roomCode);
    if (!room) {
      this.sendError(ws, 'ROOM_NOT_FOUND', 'Room not found.');
      return;
    }

    room.setLock(meta.token, locked);
    this.broadcastToRoom(room.roomCode, {
      type: 'room.lockStateChanged',
      isLocked: locked,
    });
  }

  private handlePlayerJoin(ws: WebSocket, payload: unknown): void {
    const parse = PlayerJoinSchema.safeParse(payload);
    if (!parse.success) {
      this.sendError(ws, 'INVALID_MESSAGE', parse.error.issues[0]?.message || 'Invalid player.join payload.');
      return;
    }

    const { roomCode, displayName, playerToken } = parse.data;
    const room = roomStore.getByRoomCode(roomCode);
    if (!room) {
      this.sendError(ws, 'ROOM_NOT_FOUND', `Room "${roomCode}" not found.`);
      return;
    }

    // Players can join room with roomCode/PIN without requiring any password (password protection is for game deletion only)
    const { player, isReconnect } = room.addPlayer(displayName, playerToken);
    this.registerSocket(ws, room.roomCode, 'player', player.playerToken, player.playerId);

    this.send(ws, {
      type: 'room.joined',
      role: 'player',
      roomCode: room.roomCode,
      roomId: room.roomId,
      playerId: player.playerId,
      playerToken: player.playerToken,
      score: player.score,
      state: room.state,
      title: room.gameSpecification.title,
      gameType: room.gameSpecification.gameType,
      totalQuestions: room.gameSpecification.questions.length,
      playerCount: room.players.size,
      isLocked: room.isLocked,
      currentQuestionIndex: room.currentQuestionIndex,
    });

    if (!isReconnect) {
      this.broadcastToRoom(room.roomCode, {
        type: 'lobby.playerJoined',
        playerCount: room.players.size,
        player: { id: player.playerId, displayName: player.displayName },
      });
    }

    if (room.state === 'QUESTION_ACTIVE') {
      const currentQ = room.getSanitizedCurrentQuestion();
      const answeredCount = Array.from(room.players.values()).filter((p) =>
        p.answeredQuestionIds.has(currentQ.id)
      ).length;
      this.send(ws, {
        type: 'question.started',
        question: currentQ,
        answeredCount,
        totalPlayers: room.players.size,
      });
      if (player.answeredQuestionIds.has(currentQ.id)) {
        this.send(ws, {
          type: 'question.answerReceived',
          questionId: currentQ.id,
        });
      }
    } else if (room.state === 'QUESTION_REVEAL') {
      const activeQ = room.gameSpecification.questions[room.currentQuestionIndex];
      const personalResult = player.questionResults.get(activeQ.id);
      this.send(ws, {
        type: 'question.revealed',
        questionId: activeQ.id,
        correctAnswer: activeQ.correctAnswer,
        explanation: activeQ.explanation,
        leaderboard: room.getLeaderboard(),
        personalResult,
      });
    } else if (room.state === 'FINISHED') {
      const leaderboard = room.getLeaderboard();
      this.send(ws, {
        type: 'game.finished',
        leaderboard,
        winner: leaderboard[0],
        totalQuestions: room.gameSpecification.questions.length,
      });
    }
  }

  private handlePlayerReconnect(ws: WebSocket, payload: unknown): void {
    const parse = PlayerReconnectSchema.safeParse(payload);
    if (!parse.success) {
      this.sendError(ws, 'INVALID_MESSAGE', parse.error.issues[0]?.message || 'Invalid reconnect payload.');
      return;
    }

    const { roomCode, playerToken } = parse.data;
    const room = roomStore.getByRoomCode(roomCode);
    if (!room) {
      this.sendError(ws, 'ROOM_NOT_FOUND', `Room "${roomCode}" not found.`);
      return;
    }

    const player = room.reconnectPlayer(playerToken);
    this.registerSocket(ws, room.roomCode, 'player', player.playerToken, player.playerId);

    this.send(ws, {
      type: 'room.joined',
      role: 'player',
      roomCode: room.roomCode,
      roomId: room.roomId,
      playerId: player.playerId,
      playerToken: player.playerToken,
      score: player.score,
      state: room.state,
      title: room.gameSpecification.title,
      gameType: room.gameSpecification.gameType,
      totalQuestions: room.gameSpecification.questions.length,
      playerCount: room.players.size,
      isLocked: room.isLocked,
      currentQuestionIndex: room.currentQuestionIndex,
    });

    if (room.state === 'QUESTION_ACTIVE') {
      const currentQ = room.getSanitizedCurrentQuestion();
      const answeredCount = Array.from(room.players.values()).filter((p) =>
        p.answeredQuestionIds.has(currentQ.id)
      ).length;
      this.send(ws, {
        type: 'question.started',
        question: currentQ,
        answeredCount,
        totalPlayers: room.players.size,
      });
      if (player.answeredQuestionIds.has(currentQ.id)) {
        this.send(ws, {
          type: 'question.answerReceived',
          questionId: currentQ.id,
        });
      }
    } else if (room.state === 'QUESTION_REVEAL') {
      const activeQ = room.gameSpecification.questions[room.currentQuestionIndex];
      const personalResult = player.questionResults.get(activeQ.id);
      this.send(ws, {
        type: 'question.revealed',
        questionId: activeQ.id,
        correctAnswer: activeQ.correctAnswer,
        explanation: activeQ.explanation,
        leaderboard: room.getLeaderboard(),
        personalResult,
      });
    } else if (room.state === 'FINISHED') {
      const leaderboard = room.getLeaderboard();
      this.send(ws, {
        type: 'game.finished',
        leaderboard,
        winner: leaderboard[0],
        totalQuestions: room.gameSpecification.questions.length,
      });
    }
  }

  private handleHostStart(ws: WebSocket, _payload: unknown): void {
    const meta = this.socketMeta.get(ws);
    if (!meta || meta.role !== 'host') {
      this.sendError(ws, 'NOT_HOST', 'Only the room host can start the game.');
      return;
    }

    const room = roomStore.getByRoomCode(meta.roomCode);
    if (!room) {
      this.sendError(ws, 'ROOM_NOT_FOUND', 'Room not found.');
      return;
    }

    const question = room.start(meta.token);

    this.broadcastToRoom(room.roomCode, {
      type: 'game.started',
      totalQuestions: room.gameSpecification.questions.length,
    });

    this.broadcastToRoom(room.roomCode, {
      type: 'question.started',
      question,
      answeredCount: 0,
      totalPlayers: room.players.size,
    });

    this.scheduleQuestionTimer(room);
  }

  private handlePlayerAnswer(ws: WebSocket, payload: unknown): void {
    const parse = PlayerAnswerSchema.safeParse(payload);
    if (!parse.success) {
      this.sendError(ws, 'INVALID_MESSAGE', parse.error.issues[0]?.message || 'Invalid player.answer payload.');
      return;
    }

    const meta = this.socketMeta.get(ws);
    if (!meta || meta.role !== 'player') {
      this.sendError(ws, 'SESSION_NOT_FOUND', 'Player session not registered on this connection.');
      return;
    }

    const room = roomStore.getByRoomCode(meta.roomCode);
    if (!room) {
      this.sendError(ws, 'ROOM_NOT_FOUND', 'Room not found.');
      return;
    }

    const { questionId, answer } = parse.data;
    const { allAnswered, answeredCount, totalPlayers } = room.submitPlayerAnswer(meta.token, questionId, answer);

    this.send(ws, {
      type: 'question.answerReceived',
      questionId,
      answeredCount,
      totalPlayers,
    });

    this.broadcastToRoom(room.roomCode, {
      type: 'question.answerCountUpdated',
      questionId,
      answeredCount,
      totalPlayers,
    });

    // If all active players have answered, trigger early reveal
    if (allAnswered) {
      this.revealQuestionAndBroadcast(room);
    }
  }

  private handleHostNext(ws: WebSocket, _payload: unknown): void {
    const meta = this.socketMeta.get(ws);
    if (!meta || meta.role !== 'host') {
      this.sendError(ws, 'NOT_HOST', 'Only the room host can advance questions.');
      return;
    }

    const room = roomStore.getByRoomCode(meta.roomCode);
    if (!room) {
      this.sendError(ws, 'ROOM_NOT_FOUND', 'Room not found.');
      return;
    }

    // Guard against double-advance if auto-advance just transitioned the room
    if (room.state !== 'QUESTION_REVEAL') {
      return;
    }

    this.advanceNextQuestion(room, meta.token);
  }

  private advanceNextQuestion(room: MultiplayerRoom, hostToken: string): void {
    if (room.timerHandle) {
      clearTimeout(room.timerHandle);
      room.timerHandle = null;
    }

    const nextResult = room.nextQuestion(hostToken);

    if (nextResult.nextQuestionAvailable && nextResult.question) {
      this.broadcastToRoom(room.roomCode, {
        type: 'question.started',
        question: nextResult.question,
        answeredCount: 0,
        totalPlayers: room.players.size,
      });

      this.scheduleQuestionTimer(room);
    } else if (nextResult.finished) {
      const leaderboard = nextResult.finalLeaderboard || room.getLeaderboard();
      this.broadcastToRoom(room.roomCode, {
        type: 'game.finished',
        leaderboard,
        winner: leaderboard[0],
        totalQuestions: room.gameSpecification.questions.length,
      });
    }
  }

  private handleHostEnd(ws: WebSocket, _payload: unknown): void {
    const meta = this.socketMeta.get(ws);
    if (!meta || meta.role !== 'host') {
      this.sendError(ws, 'NOT_HOST', 'Only the room host can end the game.');
      return;
    }

    const room = roomStore.getByRoomCode(meta.roomCode);
    if (!room) {
      this.sendError(ws, 'ROOM_NOT_FOUND', 'Room not found.');
      return;
    }

    const leaderboard = room.endGame(meta.token);
    this.broadcastToRoom(room.roomCode, {
      type: 'game.finished',
      leaderboard,
      winner: leaderboard[0],
      totalQuestions: room.gameSpecification.questions.length,
    });
  }

  private handlePlayerLeave(ws: WebSocket): void {
    this.handleDisconnect(ws);
  }

  private handleDisconnect(ws: WebSocket): void {
    const meta = this.socketMeta.get(ws);
    if (!meta) return;

    const { roomCode, role, token, playerId } = meta;
    if (roomCode) {
      const room = roomStore.getByRoomCode(roomCode);
      if (room) {
        if (role === 'player') {
          room.disconnectPlayer(token);
          this.broadcastToRoom(roomCode, {
            type: 'lobby.playerLeft',
            playerCount: room.players.size,
            playerId: playerId || '',
          });
        }
      }

      const socketSet = this.roomSockets.get(roomCode);
      if (socketSet) {
        socketSet.delete(ws);
        if (socketSet.size === 0) {
          this.roomSockets.delete(roomCode);
        }
      }
    }

    this.socketMeta.delete(ws);
  }

  private scheduleQuestionTimer(room: MultiplayerRoom): void {
    if (room.timerHandle) {
      clearTimeout(room.timerHandle);
      room.timerHandle = null;
    }

    const remainingMs = Math.max(0, (room.questionDeadlineAt || Date.now()) - Date.now());
    room.timerHandle = setTimeout(() => {
      this.handleQuestionTimeout(room);
    }, remainingMs + 100);
  }

  private handleQuestionTimeout(room: MultiplayerRoom): void {
    if (room.state !== 'QUESTION_ACTIVE') return;

    this.revealQuestionAndBroadcast(room);
  }

  private scheduleAutoAdvance(room: MultiplayerRoom): void {
    if (room.timerHandle) {
      clearTimeout(room.timerHandle);
      room.timerHandle = null;
    }

    const questionIndexAtReveal = room.currentQuestionIndex;
    const autoAdvanceDelayMs = MULTIPLAYER_CONFIG.AUTO_ADVANCE_DELAY_MS;

    room.timerHandle = setTimeout(() => {
      if (room.state === 'QUESTION_REVEAL' && room.currentQuestionIndex === questionIndexAtReveal) {
        try {
          this.advanceNextQuestion(room, room.hostToken);
        } catch (err: unknown) {
          console.error(
            `[Multiplayer] Failed to auto-advance question in room ${room.roomCode} (idx: ${questionIndexAtReveal}):`,
            err
          );
        }
      }
    }, autoAdvanceDelayMs);
  }

  private revealQuestionAndBroadcast(room: MultiplayerRoom): void {
    if (room.state !== 'QUESTION_ACTIVE') return;

    const revealData = room.revealQuestion();

    // Broadcast timeUp event
    this.broadcastToRoom(room.roomCode, { type: 'question.timeUp' });

    // Send question.revealed to all connected room sockets
    const socketSet = this.roomSockets.get(room.roomCode);
    if (socketSet) {
      for (const ws of socketSet) {
        if (ws.readyState !== WebSocket.OPEN) continue;

        const meta = this.socketMeta.get(ws);
        let personalResult = undefined;

        if (meta && meta.role === 'player') {
          const player = room.players.get(meta.token);
          if (player) {
            personalResult = player.questionResults.get(revealData.questionId);
          }
        }

        this.send(ws, {
          type: 'question.revealed',
          questionId: revealData.questionId,
          correctAnswer: revealData.correctAnswer,
          explanation: revealData.explanation,
          leaderboard: revealData.leaderboard,
          answerStats: revealData.answerStats,
          personalResult,
          autoAdvanceMs: MULTIPLAYER_CONFIG.AUTO_ADVANCE_DELAY_MS,
        });
      }
    }

    // Schedule auto advance for every reveal path (timeout or all players answered)
    this.scheduleAutoAdvance(room);
  }

  private registerSocket(
    ws: WebSocket,
    roomCode: string,
    role: 'host' | 'player',
    token: string,
    playerId?: string
  ): void {
    const upperCode = roomCode.toUpperCase();
    this.socketMeta.set(ws, {
      roomCode: upperCode,
      role,
      token,
      playerId,
      isAlive: true,
    });

    if (!this.roomSockets.has(upperCode)) {
      this.roomSockets.set(upperCode, new Set());
    }
    this.roomSockets.get(upperCode)!.add(ws);
  }

  public broadcastToRoom(roomCode: string, message: OutboundMessage): void {
    const upperCode = roomCode.toUpperCase();
    const sockets = this.roomSockets.get(upperCode);
    if (!sockets) return;

    const data = JSON.stringify(message);
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(data);
        } catch {
          // Socket write errors handled gracefully without bubbling
        }
      }
    }
  }

  public send(ws: WebSocket, message: OutboundMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch {}
    }
  }

  public sendError(ws: WebSocket, code: string, message: string): void {
    this.send(ws, {
      type: 'error',
      code,
      message,
    });
  }
}

export const multiplayerWsServer = new MultiplayerWebSocketServer();

