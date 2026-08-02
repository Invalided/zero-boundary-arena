package com.neon.arena.game;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Server-owned training bot tuning shared by every room. */
@Component
public final class BotSettings {
  private final boolean enabled;
  private final int minimumCombatants;
  private final long reactionMs;
  private final long shotIntervalMinMs;
  private final long shotIntervalMaxMs;
  private final double aimErrorRadians;
  private final double movementScale;
  private final double safeSpawnDistance;
  private final int spawnCandidateCount;
  private final long spawnHoldMs;

  public BotSettings(
      @Value("${game.bots.enabled:true}") boolean enabled,
      @Value("${game.bots.minimum-combatants:3}") int minimumCombatants,
      @Value("${game.bots.reaction-ms:1800}") long reactionMs,
      @Value("${game.bots.shot-interval-min-ms:300}") long shotIntervalMinMs,
      @Value("${game.bots.shot-interval-max-ms:420}") long shotIntervalMaxMs,
      @Value("${game.bots.aim-error-degrees:1.25}") double aimErrorDegrees,
      @Value("${game.bots.movement-scale:0.82}") double movementScale,
      @Value("${game.bots.safe-spawn-distance:16}") double safeSpawnDistance,
      @Value("${game.bots.spawn-candidate-count:24}") int spawnCandidateCount,
      @Value("${game.bots.spawn-hold-ms:1500}") long spawnHoldMs) {
    this.enabled = enabled;
    this.minimumCombatants = clamp(minimumCombatants, 1, 8);
    this.reactionMs = clamp(reactionMs, 250, 10_000);
    this.shotIntervalMinMs = clamp(shotIntervalMinMs, 120, 5_000);
    this.shotIntervalMaxMs = Math.max(this.shotIntervalMinMs,
        clamp(shotIntervalMaxMs, 120, 5_000));
    this.aimErrorRadians = Math.toRadians(Math.max(0, Math.min(12, aimErrorDegrees)));
    this.movementScale = Math.max(.35, Math.min(1, movementScale));
    this.safeSpawnDistance = Math.max(4, Math.min(40, safeSpawnDistance));
    this.spawnCandidateCount = clamp(spawnCandidateCount, 4, 64);
    this.spawnHoldMs = clamp(spawnHoldMs, 0, 5_000);
  }

  public boolean enabled() { return enabled; }
  public int minimumCombatants() { return minimumCombatants; }
  public long reactionMs() { return reactionMs; }
  public long shotIntervalMinMs() { return shotIntervalMinMs; }
  public long shotIntervalMaxMs() { return shotIntervalMaxMs; }
  public double aimErrorRadians() { return aimErrorRadians; }
  public double movementScale() { return movementScale; }
  public double safeSpawnDistance() { return safeSpawnDistance; }
  public int spawnCandidateCount() { return spawnCandidateCount; }
  public long spawnHoldMs() { return spawnHoldMs; }

  private static int clamp(int value, int min, int max) {
    return Math.max(min, Math.min(max, value));
  }

  private static long clamp(long value, long min, long max) {
    return Math.max(min, Math.min(max, value));
  }
}
