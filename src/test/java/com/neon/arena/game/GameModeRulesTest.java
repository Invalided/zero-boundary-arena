package com.neon.arena.game;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class GameModeRulesTest {
  @Test void ffaEnablesBuffsButTeamModeDoesNot(){
    assertTrue(new GameModeRules("FFA_ARENA").buffsEnabled());
    assertFalse(new GameModeRules("TEAM_DEATHMATCH").buffsEnabled());
    assertTrue(new GameModeRules("TEAM_DEATHMATCH").singleWeaponPerSlot());
  }
}
