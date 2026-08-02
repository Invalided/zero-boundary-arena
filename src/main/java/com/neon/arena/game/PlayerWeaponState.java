package com.neon.arena.game;

import com.neon.arena.weapon.WeaponDefinition;

/**
 * 某个玩家持有的一把武器的可变状态。
 *
 * <p>{@link WeaponDefinition} 是所有玩家共享的只读模板，而弹匣和备用弹药必须
 * 按玩家、按武器分别保存。把两者分开后，未来增加皮肤、配件和掉落武器时不会
 * 修改全局定义，也不会发生两个玩家共享弹药的错误。</p>
 */
public final class PlayerWeaponState {
  /** -1 表示当前娱乐模式使用无限备用弹药。 */
  public static final int INFINITE_RESERVE = -1;

  private int magazineAmmo;
  private int reserveAmmo;
  private double heat;
  private long heatUpdatedAt;

  public PlayerWeaponState(WeaponDefinition definition) {
    this.magazineAmmo = definition.magazineSize();
    this.reserveAmmo = definition.reserveAmmo();
  }

  public int magazineAmmo() { return magazineAmmo; }
  public int reserveAmmo() { return reserveAmmo; }
  public boolean hasInfiniteReserve() { return reserveAmmo == INFINITE_RESERVE; }

  /** 新一局开始时恢复定义中的弹匣和备弹，避免热身或上一局消耗泄漏到正式比赛。 */
  public void reset(WeaponDefinition definition) {
    magazineAmmo = definition.magazineSize();
    reserveAmmo = definition.reserveAmmo();
    heat = 0;
    heatUpdatedAt = 0;
  }

  /**
   * 先按真实经过时间恢复热量，再返回本发射击使用的旧热量，最后累加本发 Bloom。
   * 这样第一发永远使用基础散布，后续连续射击才逐步变散；停止开火后自然恢复。
   */
  public double consumeShotHeat(WeaponDefinition definition,long now){
    if(heatUpdatedAt>0){double elapsedSeconds=Math.max(0,now-heatUpdatedAt)/1000.0;heat=Math.max(0,heat-elapsedSeconds*definition.heatRecovery());}
    double shotHeat=heat;
    heat=Math.min(definition.maxBloom(),heat+definition.bloomPerShot());
    heatUpdatedAt=now;
    return shotHeat;
  }

  public boolean consumeRound() {
    if (magazineAmmo <= 0) return false;
    magazineAmmo--;
    return true;
  }

  public boolean canReload(WeaponDefinition definition) {
    return magazineAmmo < definition.magazineSize() && (hasInfiniteReserve() || reserveAmmo > 0);
  }

  /** Adds reserve ammunition without exceeding this weapon's configured starting reserve. */
  public boolean addReserveAmmo(WeaponDefinition definition,int amount){
    if(amount<=0||hasInfiniteReserve())return false;
    int next=Math.min(definition.reserveAmmo(),reserveAmmo+amount);
    if(next==reserveAmmo)return false;
    reserveAmmo=next;
    return true;
  }

  /**
   * Ammo boxes should not feel useless when the player is completely dry. If the current
   * magazine is empty, load this pickup into the weapon first, then put any remainder into
   * reserve without exceeding the weapon's configured starting reserve.
   */
  public boolean addAmmoBox(WeaponDefinition definition,int amount){
    if(amount<=0||hasInfiniteReserve())return false;
    int remaining=amount;
    boolean changed=false;
    if(magazineAmmo==0&&remaining>0){
      int loaded=Math.min(definition.magazineSize(),remaining);
      magazineAmmo+=loaded;
      remaining-=loaded;
      changed=loaded>0;
    }
    if(remaining>0){
      int next=Math.min(definition.reserveAmmo(),reserveAmmo+remaining);
      if(next!=reserveAmmo){reserveAmmo=next;changed=true;}
    }
    return changed;
  }

  /**
   * 在换弹时间轴的 commit 时刻转移弹药。有限备弹只转移弹匣缺少的数量；无限
   * 备弹直接补满。方法返回实际装入数量，方便以后生成逐发装填事件。
   */
  public int commitReload(WeaponDefinition definition) {
    if (!canReload(definition)) return 0;
    int missing = definition.magazineSize() - magazineAmmo;
    int transferred = hasInfiniteReserve() ? missing : Math.min(missing, reserveAmmo);
    magazineAmmo += transferred;
    if (!hasInfiniteReserve()) reserveAmmo -= transferred;
    return transferred;
  }
}
