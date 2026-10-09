package com.neon.arena.weapon;

/**
 * 一把基础枪械的不可变战斗配置。玩家运行时状态（弹药、换弹）不放在这里，
 * 因此同一个定义可以被所有房间和玩家安全共享。
 */
public record WeaponDefinition(
    String id,String uuid,String code,String familyCode,String displayName,WeaponCategory category,WeaponSlot slot,WeaponFireMode fireMode,WeaponReloadType reloadType,
    String ammoType,int magazineSize,int reserveAmmo,int baseDamage,
    double headMultiplier,double armorPenetration,double movementMultiplier,long fireIntervalMs,long cycleTimeMs,boolean retainScopeAfterShot,long aimInMs,long equipMs,long reloadMs,long reloadCommitMs,double maxRange,
    double hipSpread,double aimedSpread,double recoilKick,double bloomPerShot,double maxBloom,
    double verticalRecoil,double horizontalRecoil,double pitchRecovery,double yawRecovery,double heatRecovery,double viewKickScale,
    double falloffStart,double falloffEnd,double minimumDamageMultiplier) {

  /** Compatibility constructor for tests and internal fixtures created before movement weight existed. */
  public WeaponDefinition(String id,String uuid,String code,String familyCode,String displayName,WeaponCategory category,WeaponSlot slot,WeaponFireMode fireMode,WeaponReloadType reloadType,
                          String ammoType,int magazineSize,int reserveAmmo,int baseDamage,double headMultiplier,double armorPenetration,
                          long fireIntervalMs,long cycleTimeMs,boolean retainScopeAfterShot,long aimInMs,long equipMs,long reloadMs,long reloadCommitMs,double maxRange,
                          double hipSpread,double aimedSpread,double recoilKick,double bloomPerShot,double maxBloom,double verticalRecoil,double horizontalRecoil,
                          double pitchRecovery,double yawRecovery,double heatRecovery,double viewKickScale,double falloffStart,double falloffEnd,double minimumDamageMultiplier){
    this(id,uuid,code,familyCode,displayName,category,slot,fireMode,reloadType,ammoType,magazineSize,reserveAmmo,baseDamage,
        headMultiplier,armorPenetration,1,fireIntervalMs,cycleTimeMs,retainScopeAfterShot,aimInMs,equipMs,reloadMs,reloadCommitMs,maxRange,
        hipSpread,aimedSpread,recoilKick,bloomPerShot,maxBloom,verticalRecoil,horizontalRecoil,pitchRecovery,yawRecovery,heatRecovery,
        viewKickScale,falloffStart,falloffEnd,minimumDamageMultiplier);
  }

  /** 起始距离内不衰减，之后线性下降，到 falloffEnd 后保持最低倍率。 */
  public double distanceMultiplier(double distance){
    if(distance<=falloffStart)return 1;
    if(distance>=falloffEnd)return minimumDamageMultiplier;
    double progress=(distance-falloffStart)/(falloffEnd-falloffStart);
    return 1-progress*(1-minimumDamageMultiplier);
  }

  public int damage(double distance,boolean headshot){
    double hitMultiplier=headshot?headMultiplier:1;
    return Math.max(1,(int)Math.round(baseDamage*distanceMultiplier(distance)*hitMultiplier));
  }
  /** 近战武器不消耗弹药、不产生弹道，由服务端按扇形范围判定命中。 */
  public boolean melee(){return category==WeaponCategory.MELEE;}
  public boolean supportsScope(){return category==WeaponCategory.SNIPER_RIFLE;}
  public boolean automatic(){return fireMode==WeaponFireMode.FULL_AUTO||fireMode==WeaponFireMode.BURST;}
}
