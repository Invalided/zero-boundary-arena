package com.neon.arena.weapon;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class WeaponDefinitionTest {
  private final WeaponDefinition weapon=new WeaponDefinition("test","00000000-0000-0000-0000-000000000001","test.standard","test","Test",WeaponCategory.ASSAULT_RIFLE,
      WeaponSlot.PRIMARY,WeaponFireMode.FULL_AUTO,WeaponReloadType.MAGAZINE,"test",30,90,100,2,0,1,100,0,false,100,300,1000,750,100,
      .01,.005,5,.1,2,.01,.003,5,6,1,.8,20,60,.5);
  @Test void appliesLinearDistanceFalloff(){assertEquals(1,weapon.distanceMultiplier(20),.001);assertEquals(.75,weapon.distanceMultiplier(40),.001);assertEquals(.5,weapon.distanceMultiplier(80),.001);}
  @Test void combinesFalloffAndHeadMultiplier(){assertEquals(150,weapon.damage(40,true));}
}
