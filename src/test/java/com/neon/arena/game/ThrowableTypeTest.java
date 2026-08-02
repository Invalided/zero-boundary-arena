package com.neon.arena.game;

import org.junit.jupiter.api.Test;
import com.neon.arena.weapon.*;

import static org.junit.jupiter.api.Assertions.*;

class ThrowableTypeTest {
  @Test void stableIdsAndFallbackParsing(){
    assertEquals(ThrowableType.FLASH,ThrowableType.parse("flash_grenade",ThrowableType.FRAG));
    assertEquals(ThrowableType.SMOKE,ThrowableType.parse("SMOKE",ThrowableType.FRAG));
    assertEquals(ThrowableType.FRAG,ThrowableType.parse("unknown",ThrowableType.FRAG));
  }

  @Test void playerOwnsAndConsumesEachTypeIndependently(){
    WeaponDefinition rifle=new WeaponDefinition("test","00000000-0000-0000-0000-000000000001","test.standard","test","Test",WeaponCategory.ASSAULT_RIFLE,
        WeaponSlot.PRIMARY,WeaponFireMode.FULL_AUTO,WeaponReloadType.MAGAZINE,"5.56",30,-1,28,1.65,0,90,0,false,120,350,2100,1650,90,
        .018,.006,7,.14,1.3,.006,.0018,7.2,9,2.15,.8,24,72,.72);
    Player player=new Player("test",rifle);
    assertEquals(1,player.throwableCount(ThrowableType.FRAG));
    assertTrue(player.addThrowable(ThrowableType.FRAG,2));
    assertFalse(player.addThrowable(ThrowableType.FRAG,2));
    assertEquals(2,player.throwableCount(ThrowableType.FRAG));
    assertEquals(1,player.throwableCount(ThrowableType.FLASH));
    assertTrue(player.consumeThrowable(ThrowableType.FLASH));
    assertEquals(0,player.throwableCount(ThrowableType.FLASH));
    assertTrue(player.consumeThrowable(ThrowableType.FRAG));
    assertEquals(1,player.throwableCount(ThrowableType.FRAG));
    assertFalse(player.consumeThrowable(ThrowableType.FLASH));
  }
}
