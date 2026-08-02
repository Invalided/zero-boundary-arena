package com.neon.arena.skin;

import com.neon.arena.game.Player;
import com.neon.arena.weapon.WeaponDefinition;
import org.springframework.stereotype.Component;

/** 将皮肤装备规则集中在一个无网络依赖的服务中，便于以后接数据库库存后继续复用。 */
@Component
public class SkinEquipmentService {
  public enum Result { EQUIPPED, UNKNOWN_SKIN, NOT_OWNED, STALE_WEAPON, INCOMPATIBLE_WEAPON }

  private final SkinRegistry skins;
  public SkinEquipmentService(SkinRegistry skins){this.skins=skins;}

  /**
   * requestedWeapon 只用于发现客户端界面与房间状态不同步，不能决定装备目标；装备目标始终取 currentWeapon。
   */
  public Result equip(Player player,WeaponDefinition currentWeapon,String requestedWeapon,String skinId){
    SkinDefinition skin=skins.find(skinId).orElse(null);
    if(skin==null)return Result.UNKNOWN_SKIN;
    if(!player.ownsSkin(skinId))return Result.NOT_OWNED;
    if(requestedWeapon!=null&&!requestedWeapon.isBlank()&&!currentWeapon.id().equals(requestedWeapon))return Result.STALE_WEAPON;
    if(!skins.compatible(skin,currentWeapon))return Result.INCOMPATIBLE_WEAPON;
    player.equipSkin(currentWeapon.id(),skinId);
    return Result.EQUIPPED;
  }
}
