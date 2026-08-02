package com.neon.arena.game;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.util.Optional;

/**
 * 单房间 FFA 比赛状态机。它只决定“何时从哪个阶段进入哪个阶段”，不直接修改
 * Player、道具或网络连接；这些副作用由 GameRoom 在唯一房间线程中执行。
 * 将纯时间逻辑独立出来后，单元测试可以推进虚拟时间，不需要真的等待数分钟。
 */
@Component
public final class MatchController {
  public enum Phase { WAITING, WARMUP, PLAYING, FINISHED }
  public enum FinishReason { NONE, SCORE_LIMIT, TIME_LIMIT, NOT_ENOUGH_PLAYERS }

  public record Rules(int minPlayers,long warmupMs,long durationMs,int scoreLimit,long finishedMs) {
    public Rules {
      if (minPlayers < 1) throw new IllegalArgumentException("minPlayers must be positive");
      if (warmupMs < 0 || durationMs <= 0 || scoreLimit <= 0 || finishedMs <= 0)
        throw new IllegalArgumentException("match durations and scoreLimit must be valid");
    }
  }

  public record Transition(Phase from,Phase to,FinishReason reason,long occurredAt) {}

  private final Rules rules;
  private Phase phase=Phase.WAITING;
  private FinishReason finishReason=FinishReason.NONE;
  private long phaseStartedAt;
  private long phaseEndsAt;
  private int roundNumber;

  @Autowired
  public MatchController(
      @Value("${game.match.min-players:1}") int minPlayers,
      @Value("${game.match.warmup-seconds:10}") long warmupSeconds,
      @Value("${game.match.duration-seconds:300}") long durationSeconds,
      @Value("${game.match.score-limit:20}") int scoreLimit,
      @Value("${game.match.finished-seconds:10}") long finishedSeconds) {
    this(new Rules(minPlayers,warmupSeconds*1_000,durationSeconds*1_000,
        scoreLimit,finishedSeconds*1_000));
  }

  MatchController(Rules rules) { this.rules=rules; }

  /**
   * 每个 Tick 最多发生一次迁移，避免零时长配置导致同一帧连续跨越多个阶段。
   * 人数不足拥有最高优先级：未来把 minPlayers 调为 2 后，最后一名玩家离开会
   * 立即中止比赛并回到等待，而不是让空房间继续计时。
   */
  public Optional<Transition> update(long now,int activePlayers,int highestKills) {
    if (activePlayers < rules.minPlayers()) {
      if (phase != Phase.WAITING)
        return Optional.of(transition(Phase.WAITING,FinishReason.NOT_ENOUGH_PLAYERS,now,0));
      return Optional.empty();
    }
    return switch (phase) {
      case WAITING -> {
        roundNumber++;
        yield Optional.of(transition(Phase.WARMUP,FinishReason.NONE,now,rules.warmupMs()));
      }
      case WARMUP -> now>=phaseEndsAt
          ? Optional.of(transition(Phase.PLAYING,FinishReason.NONE,now,rules.durationMs()))
          : Optional.empty();
      case PLAYING -> {
        if(highestKills>=rules.scoreLimit())
          yield Optional.of(transition(Phase.FINISHED,FinishReason.SCORE_LIMIT,now,rules.finishedMs()));
        if(now>=phaseEndsAt)
          yield Optional.of(transition(Phase.FINISHED,FinishReason.TIME_LIMIT,now,rules.finishedMs()));
        yield Optional.empty();
      }
      case FINISHED -> {
        if(now<phaseEndsAt)yield Optional.empty();
        roundNumber++;
        yield Optional.of(transition(Phase.WARMUP,FinishReason.NONE,now,rules.warmupMs()));
      }
    };
  }

  private Transition transition(Phase next,FinishReason reason,long now,long duration) {
    Phase previous=phase;
    phase=next;
    finishReason=reason;
    phaseStartedAt=now;
    phaseEndsAt=duration>0?now+duration:0;
    return new Transition(previous,next,reason,now);
  }

  /** 热身允许已完成 Buff 选择的玩家移动，但所有武器和拾取规则仍等到正式比赛。 */
  public boolean movementEnabled(){return phase==Phase.WARMUP||phase==Phase.PLAYING;}
  /** 热身允许试枪和互相攻击；正式开始会重置战斗状态，且热身不计分。 */
  public boolean combatEnabled(){return phase==Phase.WARMUP||phase==Phase.PLAYING;}
  public boolean scoringEnabled(){return phase==Phase.PLAYING;}
  public long remainingMs(long now){return phaseEndsAt==0?0:Math.max(0,phaseEndsAt-now);}
  public Phase phase(){return phase;}
  public FinishReason finishReason(){return finishReason;}
  public long phaseStartedAt(){return phaseStartedAt;}
  public long phaseEndsAt(){return phaseEndsAt;}
  public int roundNumber(){return roundNumber;}
  public Rules rules(){return rules;}
}
