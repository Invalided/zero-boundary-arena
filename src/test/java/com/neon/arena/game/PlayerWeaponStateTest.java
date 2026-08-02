package com.neon.arena.game;

import com.neon.arena.weapon.*;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class PlayerWeaponStateTest {
  @Test
  void finiteReserveTransfersOnlyMissingRounds() {
    WeaponDefinition weapon=weapon(12);
    PlayerWeaponState state=new PlayerWeaponState(weapon);
    for(int i=0;i<7;i++)assertTrue(state.consumeRound());

    assertEquals(7,state.commitReload(weapon));
    assertEquals(30,state.magazineAmmo());
    assertEquals(5,state.reserveAmmo());
  }

  @Test
  void infiniteReserveRefillsWithoutChangingSentinel() {
    WeaponDefinition weapon=weapon(PlayerWeaponState.INFINITE_RESERVE);
    PlayerWeaponState state=new PlayerWeaponState(weapon);
    for(int i=0;i<30;i++)assertTrue(state.consumeRound());

    assertEquals(30,state.commitReload(weapon));
    assertEquals(30,state.magazineAmmo());
    assertEquals(PlayerWeaponState.INFINITE_RESERVE,state.reserveAmmo());
  }

  @Test
  void ammoBoxRefillsReserveButNeverExceedsConfiguredMaximum(){
    WeaponDefinition weapon=weapon(60);PlayerWeaponState state=new PlayerWeaponState(weapon);
    for(int i=0;i<30;i++)assertTrue(state.consumeRound());
    assertEquals(30,state.commitReload(weapon));assertEquals(30,state.reserveAmmo());
    assertTrue(state.addReserveAmmo(weapon,30));assertEquals(60,state.reserveAmmo());
    assertFalse(state.addReserveAmmo(weapon,30));assertEquals(60,state.reserveAmmo());
  }

  @Test
  void ammoBoxLoadsEmptyMagazineBeforeReserve(){
    WeaponDefinition weapon=weapon(60);PlayerWeaponState state=new PlayerWeaponState(weapon);
    for(int i=0;i<30;i++)assertTrue(state.consumeRound());

    assertTrue(state.addAmmoBox(weapon,30));
    assertEquals(30,state.magazineAmmo());
    assertEquals(60,state.reserveAmmo());

    assertFalse(state.addAmmoBox(weapon,30));
    assertEquals(30,state.magazineAmmo());
    assertEquals(60,state.reserveAmmo());
  }

  @Test
  void shotHeatAccumulatesAndRecoversPerWeapon() {
    WeaponDefinition weapon=weapon(PlayerWeaponState.INFINITE_RESERVE);
    PlayerWeaponState state=new PlayerWeaponState(weapon);
    assertEquals(0,state.consumeShotHeat(weapon,1_000),0.000001);
    assertEquals(weapon.bloomPerShot(),state.consumeShotHeat(weapon,1_000),0.000001);
    assertEquals(0,state.consumeShotHeat(weapon,2_000),0.000001);
    state.reset(weapon);
    assertEquals(0,state.consumeShotHeat(weapon,2_000),0.000001);
  }

  private WeaponDefinition weapon(int reserveAmmo){
    return new WeaponDefinition("test","00000000-0000-0000-0000-000000000001","test.standard","test","Test",WeaponCategory.ASSAULT_RIFLE,
        WeaponSlot.PRIMARY,WeaponFireMode.FULL_AUTO,WeaponReloadType.MAGAZINE,"test",30,reserveAmmo,30,1.5,0,100,0,false,100,300,1000,750,100,
        .01,.005,5,.1,2,.01,.003,5,6,1,.8,20,60,.5);
  }
}
