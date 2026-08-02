package com.neon.arena.game;

import static org.junit.jupiter.api.Assertions.*;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

class WorldItemTypeTest {
  @Test void usesCategorySpecificRespawnWindows(){
    assertEquals(10_000,WorldItemType.WEAPON.defaultRespawnMinMs());
    assertTrue(WorldItemType.ARMOR_VEST.defaultRespawnMinMs()>WorldItemType.MEDKIT_SMALL.defaultRespawnMinMs());
    assertTrue(WorldItemType.AMMO_BOX.defaultRespawnMaxMs()<WorldItemType.MEDKIT_SMALL.defaultRespawnMinMs());
    WorldItem item=new WorldItem("vest","",WorldItemType.ARMOR_VEST,0,0,28_000,38_000);
    long delay=item.nextRespawnDelay(new SplittableRandom(7));
    assertTrue(delay>=28_000&&delay<=38_000);
  }

  @Test void acceptsStableCaseInsensitiveMapCodes(){
    assertEquals(WorldItemType.MEDKIT_SMALL,WorldItemType.parse("medkit_small"));
    assertThrows(IllegalArgumentException.class,()->WorldItemType.parse("mystery"));
  }
}
