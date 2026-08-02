package com.neon.arena.game;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class SpawnBuffTest {
  @Test
  void invalidClientValueCannotSelectAnUnknownBuff() {
    assertEquals(SpawnBuff.NONE, SpawnBuff.parse("wallhack"));
    assertEquals(SpawnBuff.FEARLESS, SpawnBuff.parse("fearless"));
  }

  @Test
  void roundOpeningAndRegularRespawnUseUnifiedTenSecondSelectionWindow() {
    Player player = new Player("p", new com.neon.arena.weapon.WeaponRegistry().require("m4a1"));
    player.respawn(new double[] {0, 0},true);

    assertEquals(SpawnBuff.NONE,player.spawnBuff);
    assertFalse(player.spawnBuffSelected);
    assertTrue(player.spawnBuffSelectionUntil-System.currentTimeMillis()<=10_000);
    assertTrue(player.spawnBuffSelectionUntil-System.currentTimeMillis()>9_800);
    long selectedAt=player.spawnBuffSelectionUntil-1;
    assertTrue(player.selectSpawnBuff(SpawnBuff.FEARLESS,selectedAt));
    assertEquals(selectedAt,player.invulnerableUntil);
    assertFalse(player.selectSpawnBuff(SpawnBuff.LEFT_TRAJECTORY,selectedAt));
    assertTrue(player.hasActiveSpawnBuff(player.spawnBuffUntil - 1));
    assertFalse(player.hasActiveSpawnBuff(player.spawnBuffUntil));

    player.respawn(new double[] {0, 0});
    assertTrue(player.spawnBuffSelectionUntil-System.currentTimeMillis()<=10_000);
    assertTrue(player.spawnBuffSelectionUntil-System.currentTimeMillis()>9_800);
  }

  @Test
  void matchStartRepositionsPlayerAndActivatesPreparedBuff() {
    Player player = new Player("p", new com.neon.arena.weapon.WeaponRegistry().require("m4a1"));

    player.startMatch(new double[] {8, -3, 1.25},SpawnBuff.LEFT_TRAJECTORY);

    assertEquals(8,player.x);
    assertEquals(-3,player.z);
    assertEquals(1.25,player.yaw);
    assertTrue(player.spawnBuffSelected);
    assertEquals(SpawnBuff.LEFT_TRAJECTORY,player.spawnBuff);
    assertTrue(player.spawnBuffUntil-System.currentTimeMillis()<=5_000);
    assertTrue(player.spawnBuffUntil-System.currentTimeMillis()>4_800);
    assertFalse(player.hasActiveSpawnBuff(player.spawnBuffUntil));
  }

  @Test
  void playerCanExplicitlySkipAndImmediatelyEnterCombat() {
    Player player = new Player("p", new com.neon.arena.weapon.WeaponRegistry().require("m4a1"));
    player.respawn(new double[] {0, 0});
    long selectedAt=System.currentTimeMillis();

    assertTrue(player.selectSpawnBuff(SpawnBuff.NONE,selectedAt));
    assertTrue(player.spawnBuffSelected);
    assertEquals(SpawnBuff.NONE,player.spawnBuff);
    assertEquals(0,player.spawnBuffUntil);
    assertEquals(selectedAt,player.invulnerableUntil);
  }

  @Test
  void selectionAfterInvulnerabilityWindowIsRejected() {
    Player player = new Player("p", new com.neon.arena.weapon.WeaponRegistry().require("m4a1"));
    player.respawn(new double[] {0, 0});
    assertFalse(player.selectSpawnBuff(SpawnBuff.NO_AMMO,player.spawnBuffSelectionUntil));
    assertEquals(SpawnBuff.NONE,player.spawnBuff);
  }

  @Test
  void respawnAppliesAuthoritativeMapFacing() {
    Player player = new Player("p", new com.neon.arena.weapon.WeaponRegistry().require("m4a1"));
    player.yaw=0.25;player.pitch=0.5;

    player.respawn(new double[] {4, -7, 2.4});

    assertEquals(2.4,player.yaw);
    assertEquals(0,player.pitch);
    assertEquals(2.4,player.input.yaw());
    assertEquals(0,player.input.pitch());
  }
}
