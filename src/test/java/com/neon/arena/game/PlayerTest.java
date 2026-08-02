package com.neon.arena.game;

import com.neon.arena.weapon.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class PlayerTest {
  private final WeaponDefinition m4=new WeaponDefinition("m4a1","00000000-0000-0000-0000-000000000001","m4a1.standard","m4a1","M4A1",WeaponCategory.ASSAULT_RIFLE,
      WeaponSlot.PRIMARY,WeaponFireMode.FULL_AUTO,WeaponReloadType.MAGAZINE,"5.56",30,-1,28,1.65,0,90,0,false,120,350,2100,1650,90,
      .018,.006,7,.14,1.3,.006,.0018,7.2,9,2.15,.8,24,72,.72);
  @Test void startsWithOnlyConfiguredWeapon(){Player player=new Player("p1",m4);assertEquals("m4a1",player.currentWeapon);assertEquals(30,player.ammo());assertFalse(player.ownsWeapon("sniper"));}
  @Test void startsAsCombatantRatherThanSpectator(){Player player=new Player("p1",m4);assertFalse(player.spectator);assertTrue(player.alive);}
  @Test void equipsSecondaryWithoutDiscardingPrimary(){
    WeaponDefinition glock=new WeaponDefinition("glock","00000000-0000-0000-0000-000000000002","glock.standard","glock","Glock",WeaponCategory.PISTOL,
        WeaponSlot.SECONDARY,WeaponFireMode.SEMI_AUTO,WeaponReloadType.MAGAZINE,"9mm",17,-1,24,1.8,0,165,0,false,100,260,1550,1160,65,
        .022,.008,5,.2,1.6,.009,.0028,8.5,10,2.4,.9,18,55,.58);
    Player player=new Player("p1",m4);player.addWeapon(glock);player.equipWeapon(glock);
    assertEquals("glock",player.currentWeapon);
    assertEquals("m4a1",player.equippedSlots.get(WeaponSlot.PRIMARY));
    assertEquals("glock",player.equippedSlots.get(WeaponSlot.SECONDARY));
    assertTrue(player.ownsWeapon("m4a1"));
  }
  @Test void formalPickupReplacesOnlyWeaponInSameSlot(){
    WeaponDefinition ak=new WeaponDefinition("ak47","00000000-0000-0000-0000-000000000003","ak47.standard","ak47","AK47",WeaponCategory.ASSAULT_RIFLE,
        WeaponSlot.PRIMARY,WeaponFireMode.FULL_AUTO,WeaponReloadType.MAGAZINE,"7.62",30,-1,34,1.7,0,105,0,false,140,420,2400,1900,95,
        .025,.009,10,.28,2.5,.015,.006,4.6,5.2,1.05,1.25,28,78,.76);
    Player player=new Player("p1",m4);
    assertEquals("m4a1",player.replaceSlotWeapon(ak));
    assertFalse(player.ownsWeapon("m4a1"));assertTrue(player.ownsWeapon("ak47"));
    assertEquals("ak47",player.equippedSlots.get(WeaponSlot.PRIMARY));assertEquals("ak47",player.currentWeapon);
  }
  @Test void respawnAlwaysUsesSafeMapBounds(){Player player=new Player("p1",m4);for(int i=0;i<100;i++){player.respawn();assertTrue(Math.abs(player.x)<47);assertTrue(Math.abs(player.z)<47);assertEquals(1.7,player.y);assertEquals(100,player.hp);}}
  @Test void supplyEffectsRespectCapsAndExtendTemporaryBoosts(){
    Player player=new Player("p1",m4);player.hp=82;player.armor=31;
    assertTrue(player.restoreHealth(25));assertEquals(100,player.hp);assertFalse(player.restoreHealth(25));
    assertTrue(player.restoreArmor(25));assertEquals(50,player.armor);assertFalse(player.restoreArmor(25));
    player.activateSpeedBoost(1_000,5_000);player.activateSpeedBoost(2_000,5_000);assertEquals(11_000,player.speedBoostUntil);
    player.activateInvisibility(1_000,5_000);player.activateInvisibility(2_000,5_000);assertEquals(11_000,player.invisibleUntil);
    player.respawn(new double[]{0,0});assertEquals(0,player.invisibleUntil);
  }
  @Test void skinOwnershipAndEquipmentAreStoredPerWeapon(){
    Player player=new Player("p1",m4);String skinId="4fd1342d-38d7-43aa-a359-69efa825c99b";
    assertThrows(IllegalStateException.class,()->player.equipSkin("m4a1",skinId));
    player.grantSkin(skinId);player.equipSkin("m4a1",skinId);
    assertTrue(player.ownsSkin(skinId));assertEquals(skinId,player.equippedSkinId("m4a1"));
  }
  @Test void formalMatchKeepsThePositionReachedDuringWarmup(){
    Player player=new Player("p1",m4,new double[]{4,6,.7});
    player.x=8.5;player.y=2.9;player.z=-3.25;player.yaw=1.2;player.pitch=.15;

    player.startMatchFromCurrentPosition(SpawnBuff.FEARLESS);

    assertEquals(8.5,player.x);assertEquals(2.9,player.y);assertEquals(-3.25,player.z);
    assertEquals(1.2,player.yaw);assertEquals(.15,player.pitch);
    assertEquals(SpawnBuff.FEARLESS,player.spawnBuff);assertTrue(player.spawnBuffSelected);
  }
}
