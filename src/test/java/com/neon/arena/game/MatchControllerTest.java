package com.neon.arena.game;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class MatchControllerTest {
  private MatchController controller(){
    return new MatchController(new MatchController.Rules(1,10_000,300_000,20,10_000));
  }

  @Test void completeRoundUsesAuthoritativeDeadlines(){
    MatchController match=controller();
    assertEquals(MatchController.Phase.WARMUP,match.update(1_000,1,0).orElseThrow().to());
    assertEquals(1,match.roundNumber());
    assertTrue(match.movementEnabled());
    assertTrue(match.combatEnabled());
    assertFalse(match.scoringEnabled());
    assertTrue(match.update(10_999,1,0).isEmpty());
    assertEquals(MatchController.Phase.PLAYING,match.update(11_000,1,0).orElseThrow().to());
    assertTrue(match.movementEnabled());
    assertTrue(match.scoringEnabled());
    assertEquals(300_000,match.remainingMs(11_000));
    MatchController.Transition finished=match.update(311_000,1,3).orElseThrow();
    assertEquals(MatchController.Phase.FINISHED,finished.to());
    assertEquals(MatchController.FinishReason.TIME_LIMIT,finished.reason());
  }

  @Test void scoreLimitEndsRoundBeforeDeadline(){
    MatchController match=controller();
    match.update(0,1,0);match.update(10_000,1,0);
    assertTrue(match.update(12_000,1,19).isEmpty());
    MatchController.Transition transition=match.update(12_050,1,20).orElseThrow();
    assertEquals(MatchController.Phase.FINISHED,transition.to());
    assertEquals(MatchController.FinishReason.SCORE_LIMIT,transition.reason());
  }

  @Test void finishedPhaseAutomaticallyStartsNextWarmup(){
    MatchController match=controller();
    match.update(0,1,0);match.update(10_000,1,0);match.update(11_000,1,20);
    assertTrue(match.update(20_999,1,20).isEmpty());
    assertEquals(MatchController.Phase.WARMUP,match.update(21_000,1,20).orElseThrow().to());
    assertEquals(2,match.roundNumber());
  }

  @Test void insufficientPlayersCancelsAnyActivePhase(){
    MatchController match=new MatchController(new MatchController.Rules(2,1_000,5_000,5,1_000));
    assertTrue(match.update(0,1,0).isEmpty());
    match.update(10,2,0);
    MatchController.Transition transition=match.update(20,1,0).orElseThrow();
    assertEquals(MatchController.Phase.WAITING,transition.to());
    assertEquals(MatchController.FinishReason.NOT_ENOUGH_PLAYERS,transition.reason());
    assertFalse(match.movementEnabled());
    assertFalse(match.combatEnabled());
  }
}
