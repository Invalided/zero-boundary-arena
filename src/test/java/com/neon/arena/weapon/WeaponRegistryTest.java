package com.neon.arena.weapon;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class WeaponRegistryTest {
  @Test
  void loadsV1WeaponFieldsAndPublishesClientBehavior() {
    WeaponRegistry registry=new WeaponRegistry();
    WeaponDefinition m4=registry.require("m4a1");

    assertEquals(WeaponFireMode.FULL_AUTO,m4.fireMode());
    assertEquals(WeaponSlot.PRIMARY,m4.slot());
    assertEquals(WeaponReloadType.MAGAZINE,m4.reloadType());
    assertEquals("0ba5663e-db51-4c13-a58f-99c1c93c9550",m4.uuid());
    assertEquals("m4a1.standard",m4.code());
    assertEquals("m4a1",m4.familyCode());
    assertEquals(90,m4.reserveAmmo());
    assertTrue(registry.values().stream().filter(weapon->!weapon.melee()).allMatch(weapon->weapon.reserveAmmo()>0));
    assertEquals(.10,m4.armorPenetration(),.0001);
    assertEquals(.96,m4.movementMultiplier(),.0001);
    assertTrue(registry.require("sniper").movementMultiplier()<registry.require("glock").movementMultiplier());
    assertTrue(m4.reloadCommitMs()<m4.reloadMs());

    ArrayNode catalog=registry.clientCatalog(new ObjectMapper());
    assertEquals("FULL_AUTO",catalog.get(0).path("fireMode").asText());
    assertEquals(m4.uuid(),catalog.get(0).path("uuid").asText());
    assertTrue(catalog.get(0).has("verticalRecoil"));
    assertTrue(catalog.get(0).has("reloadCommit"));
    assertEquals(.10,catalog.get(0).path("armorPenetration").asDouble(),.0001);
    assertEquals(.96,catalog.get(0).path("movementMultiplier").asDouble(),.0001);
    assertFalse(registry.require("sniper").retainScopeAfterShot());
    assertTrue(catalog.findValues("retainScopeAfterShot").stream().allMatch(value->!value.asBoolean()));
    assertEquals(WeaponSlot.SECONDARY,registry.require("glock").slot());
  }

  @Test
  void knifeIsAMeleeSlotWeaponWithoutAmmoEconomy() {
    WeaponDefinition knife=new WeaponRegistry().require("knife");
    assertTrue(knife.melee());
    assertEquals(WeaponSlot.MELEE,knife.slot());
    assertEquals(40,knife.damage(1.2,false));
    assertEquals(40,knife.damage(1.2,true));
    assertTrue(knife.maxRange()<=2.5);
  }
}
