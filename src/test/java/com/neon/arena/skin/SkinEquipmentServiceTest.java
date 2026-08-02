package com.neon.arena.skin;

import com.neon.arena.game.Player;
import com.neon.arena.weapon.WeaponDefinition;
import com.neon.arena.weapon.WeaponRegistry;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class SkinEquipmentServiceTest {
  private static final String AK_TEST="a185a7c1-f7c4-414f-841b-59be27ac26d5";
  private final WeaponRegistry weapons=new WeaponRegistry();
  private final SkinRegistry skins=new SkinRegistry(weapons);
  private final SkinEquipmentService service=new SkinEquipmentService(skins);

  @Test void equipsOwnedCompatibleSkinUsingServerWeapon(){
    Player player=playerWithM4();player.addWeapon(weapons.require("ak47"));player.equipWeapon(weapons.require("ak47"));player.grantSkin(AK_TEST);
    assertEquals(SkinEquipmentService.Result.EQUIPPED,service.equip(player,weapons.require(player.currentWeapon),"ak47",AK_TEST));
    assertEquals(AK_TEST,player.equippedSkinId("ak47"));
  }

  @Test void rejectsUnknownUnownedIncompatibleAndStaleRequests(){
    Player player=playerWithM4();
    assertEquals(SkinEquipmentService.Result.UNKNOWN_SKIN,service.equip(player,weapons.require("m4a1"),"m4a1","00000000-0000-0000-0000-000000000000"));
    assertEquals(SkinEquipmentService.Result.NOT_OWNED,service.equip(player,weapons.require("m4a1"),"m4a1",AK_TEST));
    player.grantSkin(AK_TEST);
    assertEquals(SkinEquipmentService.Result.STALE_WEAPON,service.equip(player,weapons.require("m4a1"),"ak47",AK_TEST));
    assertEquals(SkinEquipmentService.Result.INCOMPATIBLE_WEAPON,service.equip(player,weapons.require("m4a1"),"m4a1",AK_TEST));
    assertNull(player.equippedSkinId("m4a1"));
  }

  private Player playerWithM4(){return new Player("p1",weapons.require("m4a1"));}
}
