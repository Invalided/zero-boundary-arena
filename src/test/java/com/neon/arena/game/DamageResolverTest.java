package com.neon.arena.game;

import com.neon.arena.weapon.WeaponDefinition;
import com.neon.arena.weapon.WeaponRegistry;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class DamageResolverTest {
  private final WeaponRegistry registry=new WeaponRegistry();
  private final DamageResolver resolver=new DamageResolver();

  @Test void appliesWeaponSpecificArmorPenetration(){
    WeaponDefinition m4=registry.require("m4a1");
    DamageResolver.Result result=resolver.resolve(m4,0,false,100,50);
    assertEquals(28,result.rawDamage());assertEquals(12,result.armorDamage());assertEquals(16,result.healthDamage());
    assertEquals(38,result.remainingArmor());assertEquals(84,result.remainingHealth());
    assertEquals(6,resolver.shotsToKill(m4,0,false,100,50));
  }

  @Test void higherPenetrationBypassesMoreArmorWithoutIncreasingRawDamage(){
    WeaponDefinition m4=registry.require("m4a1"),ak=registry.require("ak47");
    DamageResolver.Result m4Hit=resolver.resolve(m4,0,false,100,50);
    DamageResolver.Result akHit=resolver.resolve(ak,0,false,100,50);
    assertEquals(16,m4Hit.healthDamage());
    assertEquals(21,akHit.healthDamage());
    assertTrue(ak.armorPenetration()>m4.armorPenetration());
  }

  @Test void reportsExpectedProvisionalTtkMatrix(){
    WeaponDefinition ak=registry.require("ak47"),awm=registry.require("sniper");
    assertEquals(5,resolver.shotsToKill(ak,0,false,100,50));
    assertEquals(420,resolver.timeToKillMs(ak,5));
    assertEquals(1,resolver.shotsToKill(awm,0,true,100,50));
    assertEquals(0,resolver.timeToKillMs(awm,1));
  }
}
