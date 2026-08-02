package com.neon.arena.game;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class BotDifficultyTest {
  @Test void difficultyProfilesPreserveCurrentHardAndCreateRealExtremes(){
    assertFalse(BotDifficulty.OFF.enabled());
    assertEquals(1_800,BotDifficulty.HARD.reactionMs());
    assertTrue(BotDifficulty.EASY.reactionMs()>BotDifficulty.HARD.reactionMs());
    assertTrue(BotDifficulty.INFERNO.reactionMs()<BotDifficulty.HARD.reactionMs());
    assertTrue(BotDifficulty.INFERNO.aimErrorRadians()<BotDifficulty.HARD.aimErrorRadians());
    assertTrue(BotDifficulty.INFERNO.aimHeightOffset()>BotDifficulty.HARD.aimHeightOffset());
  }
}
