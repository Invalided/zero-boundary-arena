package com.neon.arena.game;

import com.fasterxml.jackson.databind.JsonNode;
import com.neon.arena.transport.GameConnection;

/** 网络线程投递给房间线程的三类生命周期命令。 */
public sealed interface GameCommand {
  record Connect(GameConnection connection) implements GameCommand {}
  record Disconnect(String connectionId) implements GameCommand {}
  record Message(String connectionId, JsonNode payload) implements GameCommand {}
}
