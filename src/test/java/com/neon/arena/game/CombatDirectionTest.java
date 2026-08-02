package com.neon.arena.game;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.neon.arena.weapon.*;
import org.junit.jupiter.api.Test;

class CombatDirectionTest {
  private static final WeaponDefinition STARTER=new WeaponDefinition(
      "test","00000000-0000-0000-0000-000000000001","test.standard","test","Test",
      WeaponCategory.ASSAULT_RIFLE,WeaponSlot.PRIMARY,WeaponFireMode.SEMI_AUTO,
      WeaponReloadType.MAGAZINE,"test",30,90,30,1.5,0,100,0,false,100,300,1000,750,100,
      .01,.005,5,.1,2,.01,.003,5,6,1,.8,20,60,.5);

  @Test void convertsWorldPositionsToGameYaw(){
    Player victim=new Player("victim",STARTER,new double[]{0,0,0});
    Player attacker=new Player("attacker",STARTER,new double[]{0,-10,0});
    attacker.x=0;attacker.z=-10;
    assertEquals(0,GameRoom.sourceYaw(victim,attacker),1e-9);
    attacker.x=10;attacker.z=0;
    assertEquals(-Math.PI/2,GameRoom.sourceYaw(victim,attacker),1e-9);
    attacker.x=0;attacker.z=10;
    assertEquals(Math.PI,Math.abs(GameRoom.sourceYaw(victim,attacker)),1e-9);
  }
}
