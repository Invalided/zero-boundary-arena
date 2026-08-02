package com.neon.arena.game;

/** 服务端对一发射击的最终解释；NEGATED/DEFLECTED/JAMMED 为 FFA Buff 预留。 */
public enum ShotOutcome {
  HIT, MISS, BLOCKED, REJECTED, NEGATED, DEFLECTED, JAMMED
}
