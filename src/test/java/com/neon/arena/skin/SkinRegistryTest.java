package com.neon.arena.skin;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.neon.arena.weapon.WeaponRegistry;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class SkinRegistryTest {
  private final WeaponRegistry weapons=new WeaponRegistry();
  private final SkinRegistry skins=new SkinRegistry(weapons);

  @Test void loadsStableCatalogAndDefaultOwnership(){
    String testSkin="a185a7c1-f7c4-414f-841b-59be27ac26d5";
    assertTrue(skins.defaultOwnedSkinIds().contains(testSkin));
    assertEquals("ak47.ember-test",skins.find(testSkin).orElseThrow().code());
    assertEquals(5,skins.clientCatalog(new ObjectMapper()).size());
  }

  @Test void validatesExactWeaponCompatibility(){
    SkinDefinition akSkin=skins.find("a185a7c1-f7c4-414f-841b-59be27ac26d5").orElseThrow();
    assertTrue(skins.compatible(akSkin,weapons.require("ak47")));
    assertFalse(skins.compatible(akSkin,weapons.require("m4a1")));
  }

  @Test void selectsBaseSkinForEachCompatibleWeapon(){
    assertEquals("4fd1342d-38d7-43aa-a359-69efa825c99b",skins.defaultSkinId(weapons.require("m4a1")).orElseThrow());
    assertEquals("055f8b21-3728-444b-a6f8-2e000f383103",skins.defaultSkinId(weapons.require("ak47")).orElseThrow());
  }
}
